import "server-only";

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";

function supaService() {
  return createClient(SUPA_URL, SUPA_SERVICE);
}

function chunkText(text: string, target = 1400, overlap = 200) {
  const clean = text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!clean) return [];

  const paras = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = "";

  for (const p of paras) {
    const next = cur ? `${cur}\n\n${p}` : p;
    if (next.length <= target) {
      cur = next;
      continue;
    }

    if (cur) chunks.push(cur);

    if (p.length > target) {
      let i = 0;
      while (i < p.length) {
        const end = Math.min(p.length, i + target);
        chunks.push(p.slice(i, end).trim());
        i = Math.max(end - overlap, end);
      }
      cur = "";
    } else {
      cur = p;
    }
  }

  if (cur) chunks.push(cur);
  return chunks.filter((c) => c.trim().length > 0);
}

async function extractTextPdfJs(buf: Buffer) {
  // pdfjs-dist v3 legacy build (du installerede 3.11.174)
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.js");

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const pdf = await loadingTask.promise;

  let out = "";
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const tc = await page.getTextContent();
      const strings = (tc.items || [])
        .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
        .filter(Boolean);
      out += strings.join(" ") + "\n\n";
    }
  } finally {
    try {
      await pdf.cleanup?.();
      await pdf.destroy?.();
    } catch {}
  }

  return out.trim();
}

export async function POST(req: NextRequest) {
  // auth (dev)
  const hdr = req.headers.get("x-shared-secret") || "";
  if (process.env.IMPORT_SHARED_SECRET && hdr !== process.env.IMPORT_SHARED_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const fileId = (url.searchParams.get("fileId") || url.searchParams.get("file_id") || "").trim();
  if (!fileId) return new Response("Missing fileId", { status: 400 });

  const sb = supaService();

  const { data: f, error: fErr } = await sb
    .from("files")
    .select("id, owner_id, folder_id, storage_path, original_name, name")
    .eq("id", fileId)
    .maybeSingle();

  if (fErr) return new Response(`DB error: ${fErr.message}`, { status: 400 });
  if (!f) return new Response("File not found", { status: 404 });

  const storagePath = String((f as any).storage_path || "");
  if (!storagePath) return new Response("files.storage_path mangler", { status: 400 });

  const dl = await sb.storage.from(BUCKET).download(storagePath);
  if (dl.error || !dl.data) {
    return new Response(`Storage download failed: ${dl.error?.message ?? "unknown"}`, { status: 400 });
  }

  const buf = Buffer.from(await dl.data.arrayBuffer());

  let text = "";
  try {
    text = await extractTextPdfJs(buf);
  } catch (e: any) {
    return new Response(`pdf parse failed: ${e?.message ?? "unknown"}`, { status: 400 });
  }

  if (!text) return new Response("Ingen tekst fundet i PDF", { status: 400 });

  const chunks = chunkText(text, 1400, 200);
  if (!chunks.length) return new Response("Kunne ikke danne chunks", { status: 400 });

  const ownerId = String((f as any).owner_id || "");
  const folderId = (f as any).folder_id ? String((f as any).folder_id) : null;
  const source = String((f as any).original_name || (f as any).name || "");

  // delete eksisterende chunks for filen
  await sb.from("doc_chunks").delete().eq("owner_id", ownerId).eq("file_id", fileId);

  // VIGTIGT: INGEN token_count i insert (ellers får du "non-DEFAULT value")
  const rows = chunks.map((content) => ({
    owner_id: ownerId,
    file_id: fileId,
    folder_id: folderId,
    content,
    source,
    source_type: "user_upload",
    allow_in_answer: true,
  }));

  const ins = await sb.from("doc_chunks").insert(rows);
  if (ins.error) return new Response(`doc_chunks insert failed: ${ins.error.message}`, { status: 400 });

  return Response.json({ ok: true, fileId, chunkCount: chunks.length });
}
