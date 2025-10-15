import { createClient } from "@supabase/supabase-js";
import { ensureQuotaAndDecrement } from "@/app/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readSecret(req: Request) {
  const h1 = req.headers.get("x-shared-secret");
  if (h1 && h1.trim()) return h1.trim();
  const h2 = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return h2.replace(/^Bearer\s+/i, "").trim();
}

export async function GET() {
  return Response.json({ ok: true, where: "GET /api/import (alive, service-role)" });
}

export async function POST(req: Request) {
  // 1) Shared-secret auth
  const expected = (process.env.IMPORT_SHARED_SECRET || "").trim();
  const incoming = readSecret(req);
  if (!expected || incoming !== expected) {
    return Response.json({ ok:false, error:"unauthorized" }, { status:401 });
  }

  // 2) Parse body
  let body:any=null;
  try { body = await req.json(); }
  catch { return Response.json({ ok:false, error:"invalid json" }, { status:400 }); }

  const email = String(body?.userEmail ?? "").trim();

  // 3) Admin Supabase client (bypasses RLS)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // 4) Resolve owner (FK-safe): by email, else DEV_USER_ID
  let ownerId: string | undefined;
  if (email) {
    const { data: prof0, error: pe } =
      await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
    if (pe) console.warn("profiles lookup error:", pe);
    ownerId = prof0?.id;
  }
  if (!ownerId) {
    const dev = String(process.env.DEV_USER_ID ?? "").trim();
    if (!dev) {
      return Response.json(
        { ok:false, error:"no owner found and DEV_USER_ID not set" },
        { status:400 }
      );
    }
    ownerId = dev;
  }

  // === Phase 4: Quota check + atomic decrement ===
  const cost = Math.max(1, Number(body?.cost ?? 1));
  const q = await ensureQuotaAndDecrement(ownerId, cost);
  if (!q.ok) {
    if (q.code === "OUT_OF_CREDITS") {
      return Response.json(
        { ok:false, error:"Out of credits", remaining: Math.max(0, q.remaining) },
        { status: 402 }
      );
    }
    return Response.json(
      { ok:false, error:"Quota/RPC error", code: q.code },
      { status: 429 }
    );
  }

  // 5) Create job with enum-safe default status ("queued")
  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .insert({ kind:"import", owner_id: ownerId, payload: body, status: "queued" })
    .select("id")
    .single();
  if (jErr || !job) return Response.json({ ok:false, error:"job insert failed", detail:jErr?.message }, { status:500 });

  try {
    let filesInserted = 0, notesInserted = 0;

    // 6) File + OCR (ensure NOT NULL columns)
    if (body?.file?.md5) {
      const f = body.file as { md5:string; fileId?:string; fileName?:string; storagePath?:string };
      const originalName = (f.fileName && String(f.fileName).trim().length > 0) ? String(f.fileName).trim() : "upload";
      const storagePath =
        (typeof f.storagePath === "string" && f.storagePath.length > 0)
          ? f.storagePath
          : `external/drive/${(f.fileId ?? f.md5)}`;

      const { data: fr, error: fErr } = await supabase
        .from("files")
        .upsert(
          {
            owner_id: ownerId,
            md5: f.md5,
            name: originalName,
            original_name: originalName,    // NOT NULL
            storage_path: storagePath       // NOT NULL
          },
          { onConflict: "md5" }
        )
        .select("id")
        .single();
      if (fErr || !fr) throw fErr;
      filesInserted++;

      if (typeof body.ocrText === "string" && body.ocrText.length > 0) {
        const { error: tErr } = await supabase
          .from("ocr_texts")
          .insert({ owner_id: ownerId, file_id: fr.id, text: body.ocrText });
        if (tErr) throw tErr;
      }
    }

    // 7) Notes
    if (Array.isArray(body?.notes)) {
      for (const n of body.notes) {
        if (!n?.title) continue;
        const { error: nErr } = await supabase.from("notes").insert({
          owner_id: ownerId,
          title: String(n.title).slice(0,200),
          content: n.content ? String(n.content) : null,
          course_id: n.course_id ?? null,
        });
        if (nErr) throw nErr;
        notesInserted++;
      }
    }

    // Success → status "succeeded"
    await supabase.from("jobs").update({ status:"succeeded" }).eq("id", job.id);
    return Response.json({ ok:true, jobId: job.id, filesInserted, notesInserted });

  } catch (e:any) {
    // Failure → status "failed"
    await supabase.from("jobs").update({ status:"failed" }).eq("id", job.id);
    return Response.json({ ok:false, error: e?.message ?? "error" }, { status:500 });
  }
}
