import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const secret = process.env.IMPORT_SHARED_SECRET;
  const hdr = req.headers.get("x-shared-secret");
  if (!secret || hdr !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = await createServerClient();

  // forventet payload (eksempel):
  // {
  //   "ownerEmail": "user@example.com",
  //   "files": [{ "md5": "abc", "name": "doc.pdf", "text": "..." }],
  //   "notes": [{ "title": "...", "content": "..." }]
  // }
  let payload: any;
  try { payload = await req.json(); } catch { return NextResponse.json({ ok:false, error:"invalid json" }, { status:400 }); }

  // slå owner op i profiles (antager profiles.har(email))
  const email = payload?.ownerEmail;
  if (!email) return NextResponse.json({ ok:false, error:"ownerEmail missing" }, { status:400 });

  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();

  if (pErr || !prof) {
    return NextResponse.json({ ok:false, error:"owner not found" }, { status:404 });
  }
  const ownerId = prof.id;

  // log job started
  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .insert({ kind: "import", status: "started", owner_id: ownerId, payload })
    .select("id")
    .single();

  if (jErr || !job) return NextResponse.json({ ok:false, error:"job insert failed" }, { status:500 });

  try {
    // Upsert files + ocr_texts
    if (Array.isArray(payload?.files)) {
      for (const f of payload.files) {
        const { data: fileRow, error: fErr } = await supabase
          .from("files")
          .upsert({ owner_id: ownerId, md5: f.md5, name: f.name }, { onConflict: "md5" })
          .select("id")
          .single();
        if (fErr || !fileRow) throw fErr;

        if (typeof f.text === "string" && f.text.length > 0) {
          const { error: tErr } = await supabase
            .from("ocr_texts")
            .insert({ owner_id: ownerId, file_id: fileRow.id, text: f.text });
          if (tErr) throw tErr;
        }
      }
    }

    // Indsæt notes (simple)
    if (Array.isArray(payload?.notes)) {
      for (const n of payload.notes) {
        if (!n?.title) continue;
        await supabase.from("notes").insert({
          owner_id: ownerId,
          title: String(n.title).slice(0,200),
          content: n.content ? String(n.content) : null,
          course_id: n.course_id ?? null
        });
      }
    }

    await supabase.from("jobs").update({ status: "succeeded" }).eq("id", job.id);
    return NextResponse.json({ ok:true, jobId: job.id });
  } catch (e:any) {
    await supabase.from("jobs").update({ status: "failed", error: e?.message ?? "error" }).eq("id", job.id);
    return NextResponse.json({ ok:false, error: e?.message ?? "error" }, { status:500 });
  }
}