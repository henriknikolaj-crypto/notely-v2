import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createHash, randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hold denne i sync med DELETE-route (din /api/files/[id] bruger trainer_uploads)
const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "trainer_uploads";
const MAX_FILE_BYTES = 30 * 1024 * 1024; // hård beskyttelse (ikke quota)

function errInfo(e: any) {
  if (!e) return { message: "Unknown error" };
  if (typeof e === "string") return { message: e };
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  return {
    message: e.message ?? e.error_description ?? e.error ?? e.msg ?? "Unknown error",
    code: e.code,
    details: e.details,
    hint: e.hint,
    status: e.status,
  };
}

function stripPathy(name: string) {
  const n = String(name ?? "").trim();
  const base = n.split(/[\\/]/g).pop() || n || "upload.pdf";
  return base.replace(/[\u0000-\u001F]/g, "").slice(0, 180) || "upload.pdf";
}

function formatDa(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getOwnerId(req: NextRequest): Promise<{ ownerId: string; isDev: boolean }> {
  const devHeader = (req.headers.get("x-dev-secret") || "").trim();
  const devSecret =
    (process.env.NOTELY_DEV_SECRET || process.env.X_DEV_SECRET || process.env.DEV_BYPASS_SECRET || "").trim();
  const devUserId = (process.env.DEV_USER_ID || "").trim();

  if (devHeader && devSecret && devUserId && devHeader === devSecret) {
    return { ownerId: devUserId, isDev: true };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ownerId: "", isDev: false };

  const cookieStore = await cookies();
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) cookieStore.set(c.name, c.value, c.options);
      },
    },
  });

  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user?.id) return { ownerId: "", isDev: false };
  return { ownerId: data.user.id, isDev: false };
}

async function getPlan(admin: any, ownerId: string): Promise<string> {
  try {
    const r = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const p = String((r.data as any)?.plan ?? "").trim();
    return p || "freemium";
  } catch {
    return "freemium";
  }
}

async function tryInsertFile(admin: any, rows: any[]) {
  let lastErr: any = null;
  for (const obj of rows) {
    const r = await admin.from("files").insert(obj).select("id").maybeSingle();
    if (!r.error) return { ok: true as const, id: (r.data as any)?.id ?? obj.id };
    lastErr = r.error;
  }
  return { ok: false as const, error: lastErr };
}

// pdfjs-dist extractor (samme “familie” som rebuild-chunks)
async function extractPdfPagesText(buf: Buffer): Promise<{ pages: number; pageTexts: string[] }> {
  // ✅ ESM-safe import (ingen require)
  const mod: any = await import("pdfjs-dist/legacy/build/pdf.js");
  const pdfjs: any = mod?.default ?? mod;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableWorker: true, // node-friendly
  });

  const pdf = await loadingTask.promise;

  const pages = Number(pdf?.numPages ?? 0) || 0;
  const pageTexts: string[] = [];

  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = Array.isArray(tc?.items) ? tc.items : [];
    const s = items
      .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pageTexts.push(s);
  }

  return { pages, pageTexts };
}

async function rebuildDocChunksForFile(
  admin: any,
  args: {
    ownerId: string;
    fileId: string;
    folderId: string;
    originalName: string;
    pageTexts: string[];
  },
) {
  const { ownerId, fileId, folderId, originalName, pageTexts } = args;

  // ryd først (idempotent)
  {
    const del = await admin.from("doc_chunks").delete().eq("owner_id", ownerId).eq("file_id", fileId);
    if (del.error) throw del.error;
  }

  // lav 1 chunk pr side (matcher dine counts 12/7/6 osv.)
  const base = pageTexts.map((text, idx) => ({
    id: randomUUID(),
    owner_id: ownerId,
    file_id: fileId,
    folder_id: folderId,
    chunk_index: idx,
    page: idx + 1,
    content: text || "",
    source_title: originalName,
    source_url: null,
  }));

  // prøv nogle skema-variationer (så vi ikke “overskriver” andre installationer)
  const variants: any[][] = [
    base.map((r) => ({
      id: r.id,
      owner_id: r.owner_id,
      file_id: r.file_id,
      folder_id: r.folder_id,
      chunk_index: r.chunk_index,
      page: r.page,
      content: r.content,
      source_title: r.source_title,
      source_url: r.source_url,
    })),
    base.map((r) => ({
      id: r.id,
      owner_id: r.owner_id,
      file_id: r.file_id,
      folder_id: r.folder_id,
      chunk_index: r.chunk_index,
      page: r.page,
      text: r.content,
      source_title: r.source_title,
      source_url: r.source_url,
    })),
    base.map((r) => ({
      id: r.id,
      owner_id: r.owner_id,
      file_id: r.file_id,
      folder_id: r.folder_id,
      idx: r.chunk_index,
      page: r.page,
      content: r.content,
    })),
    base.map((r) => ({
      owner_id: r.owner_id,
      file_id: r.file_id,
      folder_id: r.folder_id,
      content: r.content,
    })),
  ];

  let lastErr: any = null;
  for (const rows of variants) {
    const ins = await admin.from("doc_chunks").insert(rows);
    if (!ins.error) return { chunkCount: rows.length };
    lastErr = ins.error;
  }

  throw lastErr ?? new Error("doc_chunks insert failed");
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  const { ownerId } = await getOwnerId(req);
  if (!ownerId) return NextResponse.json({ ok: false, error: "Unauthorized", requestId }, { status: 401 });

  let admin: any;
  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Server config mangler.", requestId }, { status: 500 });
  }

  try {
    const form = await req.formData();

    const folderId = String(form.get("folder_id") ?? form.get("folderId") ?? form.get("folder") ?? "").trim() || null;
    const file = form.get("file") as unknown as File | null;

    if (!folderId) return NextResponse.json({ ok: false, error: "Manglende folder_id.", requestId }, { status: 400 });
    if (!file) return NextResponse.json({ ok: false, error: "Manglende fil.", requestId }, { status: 400 });

    if ((file as any).size != null && Number((file as any).size) > MAX_FILE_BYTES) {
      return NextResponse.json(
        { ok: false, error: `Filen er for stor (maks ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`, requestId },
        { status: 413 },
      );
    }

    // folder ownership (samme tabel som /api/folders typisk bruger)
    const { data: folderRow, error: folderErr } = await admin
      .from("folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("id", folderId)
      .maybeSingle();

    if (folderErr) console.error("[trainer/upload] folder lookup error:", errInfo(folderErr));
    if (!folderRow)
      return NextResponse.json({ ok: false, error: "Ugyldig mappe (folder_id).", requestId }, { status: 400 });

    const originalName = stripPathy(file.name || "upload.pdf");
    const mimeType = String((file as any).type || "application/pdf") || "application/pdf";

    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const md5 = createHash("md5").update(buf).digest("hex");

    // duplicate check (før quota)
    const { data: existing, error: existingErr } = await admin
      .from("files")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("md5", md5)
      .maybeSingle();

    if (existingErr) console.error("[trainer/upload] duplicate lookup error:", errInfo(existingErr));
    if (existing?.id) {
      return NextResponse.json(
        {
          ok: false,
          code: "DUPLICATE_FILE",
          message: "Denne fil er allerede uploadet. Du kan ikke uploade den samme fil to gange.",
          existingFileId: existing.id,
          requestId,
        },
        { status: 409 },
      );
    }

    // ✅ pdfjs-dist: side-tekster + side-tal
    let pages = 0;
    let pageTexts: string[] = [];
    try {
      const r = await extractPdfPagesText(buf);
      pages = r.pages;
      pageTexts = r.pageTexts;
    } catch (e) {
      console.error("[trainer/upload] pdfjs extract error:", errInfo(e));
      return NextResponse.json(
        { ok: false, code: "PDF_UNREADABLE", error: "PDF kunne ikke læses (pdfjs-dist).", requestId },
        { status: 400 },
      );
    }

    if (!pages || pages < 1) {
      return NextResponse.json({ ok: false, code: "PDF_NO_PAGES", error: "PDF har ingen sider.", requestId }, { status: 400 });
    }

    // Freemium: max 10 sider pr PDF
    const plan = await getPlan(admin, ownerId);
    if (plan === "freemium" && pages > 10) {
      return NextResponse.json(
        { ok: false, code: "FILE_TOO_LONG", message: "Freemium: maks 10 sider pr PDF.", pages, requestId },
        { status: 413 },
      );
    }

    // ✅ quota: forbrug = sider
    const quota = await admin.rpc("quota_try_consume", {
      p_owner_id: ownerId,
      p_feature: "import",
      p_amount: pages,
    });

    if (quota.error) {
      console.error("[trainer/upload] quota_try_consume error:", errInfo(quota.error));
      return NextResponse.json(
        {
          ok: false,
          code: "QUOTA_CHECK_FAILED",
          message: "Kunne ikke tjekke din grænse lige nu. Prøv igen om lidt.",
          requestId,
        },
        { status: 503 },
      );
    }

    const row = Array.isArray(quota.data) ? quota.data[0] : quota.data;
    const ok = !!row?.ok;

    if (!ok) {
      const used = Number(row?.out_used ?? 0);
      const lim = row?.out_limit_per_month == null ? null : Number(row?.out_limit_per_month);
      const resetAt = row?.out_reset_at ? String(row.out_reset_at) : "";

      return NextResponse.json(
        {
          ok: false,
          code: "QUOTA_EXCEEDED",
          feature: "import",
          usedThisMonth: used,
          monthlyLimit: lim,
          resetAt,
          pages,
          message: `Grænse nået. Du kan uploade igen efter nulstilling (${resetAt ? formatDa(resetAt) : "snart"}).`,
          requestId,
        },
        { status: 429 },
      );
    }

    // storage
    const fileId = randomUUID();
    const storagePath = `${ownerId}/${folderId}/${fileId}.pdf`;

    const up = await admin.storage.from(UPLOAD_BUCKET).upload(storagePath, buf, {
      contentType: mimeType || "application/pdf",
      upsert: false,
    });

    if (up.error) {
      console.error("[trainer/upload] storage upload error:", errInfo(up.error));
      return NextResponse.json({ ok: false, error: "Kunne ikke uploade filen til storage.", requestId }, { status: 500 });
    }

    const uploadedAt = new Date().toISOString();

    // insert files (robust fallback)
    const insertAttempts = [
      {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        original_name: originalName,
        mime_type: mimeType,
        size_bytes: (file as any).size ?? null,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
      },
      {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        mime_type: mimeType,
        size_bytes: (file as any).size ?? null,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
      },
      {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
      },
      {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        uploaded_at: uploadedAt,
      },
    ];

    const ins = await tryInsertFile(admin, insertAttempts);
    if (!ins.ok) {
      console.error("[trainer/upload] files insert error:", errInfo(ins.error));

      // rollback storage (best-effort)
      try {
        await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
      } catch {}

      return NextResponse.json({ ok: false, error: "Kunne ikke gemme fil i databasen.", requestId }, { status: 500 });
    }

    // ✅ lav chunks nu (så du ikke ender i 0-chunks igen)
    let chunkCount = 0;
    try {
      const r = await rebuildDocChunksForFile(admin, {
        ownerId,
        fileId,
        folderId,
        originalName,
        pageTexts,
      });
      chunkCount = r.chunkCount;
    } catch (e) {
      console.error("[trainer/upload] rebuildDocChunks error:", errInfo(e));
      return NextResponse.json(
        { ok: false, code: "CHUNK_BUILD_FAILED", error: "Kunne ikke bygge doc_chunks (pdfjs-dist).", requestId, fileId },
        { status: 500 },
      );
    }

    // valgfri job-log (best-effort)
    try {
      await admin.from("jobs").insert({
        id: randomUUID(),
        owner_id: ownerId,
        kind: "import",
        status: "finished",
        queued_at: uploadedAt,
        started_at: uploadedAt,
        finished_at: new Date().toISOString(),
        payload: {
          source: "trainer_upload",
          folder_id: folderId,
          file_id: fileId,
          md5,
          pages,
          chunkCount,
          storage_path: storagePath,
        },
      });
    } catch {}

    return NextResponse.json(
      {
        ok: true,
        requestId,
        fileId,
        folderId,
        md5,
        pages,
        chunkCount,
        storage: { bucket: UPLOAD_BUCKET, path: storagePath },
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("[trainer/upload] route error:", errInfo(e));
    return NextResponse.json({ ok: false, error: e?.message ?? "Uventet fejl i upload.", requestId }, { status: 500 });
  }
}
