import "server-only";

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractPdfWithFallback } from "@/lib/pdf/extractPdfWithFallback";
import { buildChunksFromExtractedPages } from "@/lib/pdf/chunkStructuredPages";
import { requireDevSecret } from "@/lib/dev/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";

function supaService() {
  return createClient(SUPA_URL, SUPA_SERVICE);
}

export async function POST(req: NextRequest) {
  const guard = requireDevSecret(req);
  if (!guard.ok) {
    return new Response(guard.message, { status: guard.status });
  }

  const url = new URL(req.url);
  const fileId = (url.searchParams.get("fileId") || url.searchParams.get("file_id") || "").trim();
  if (!fileId) return new Response("Missing fileId", { status: 400 });

  const sb = supaService();

  const { data: f, error: fErr } = await sb
    .from("files")
    .select("id, owner_id, folder_id, storage_path, original_name, name, md5")
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

  let extraction: Awaited<ReturnType<typeof extractPdfWithFallback>>;
  try {
    extraction = await extractPdfWithFallback(buf, {
      fileName: String((f as any).original_name || (f as any).name || "document.pdf"),
    });
  } catch (e: any) {
    return new Response(`pdf parse failed: ${e?.message ?? "unknown"}`, { status: 400 });
  }

  if (!extraction.pages.length || !extraction.pages.some((p) => p.text.trim().length > 0)) {
    return new Response("Ingen tekst fundet i PDF", { status: 400 });
  }

  const ownerId = String((f as any).owner_id || "");
  const folderId = (f as any).folder_id ? String((f as any).folder_id) : null;
  const source = String((f as any).original_name || (f as any).name || "");

  await sb.from("doc_chunks").delete().eq("owner_id", ownerId).eq("file_id", fileId);

  const rows = buildChunksFromExtractedPages(extraction.pages)
    .map((chunk) => ({
      owner_id: ownerId,
      file_id: fileId,
      folder_id: folderId,
      content: chunk.content || "",
      source,
      source_type: "user_upload",
      allow_in_answer: true,
      page_from: chunk.pageNumber,
      page_to: chunk.pageNumber,
      source_page: chunk.pageNumber,
      extraction_method: chunk.extractionMethod,
      extraction_quality: chunk.extractionQuality,
    }))
    .filter((row) => row.content.trim().length > 0);

  if (!rows.length) return new Response("Kunne ikke danne chunks", { status: 400 });

  const ins = await sb.from("doc_chunks").insert(rows);
  if (ins.error) return new Response(`doc_chunks insert failed: ${ins.error.message}`, { status: 400 });

  await sb
    .from("files")
    .update({
      page_count: extraction.pageCount,
      ocr_pages: extraction.ocrPages,
      extraction_method: extraction.extractionMethod,
      extraction_quality: extraction.extractionQuality,
      extraction_meta: extraction.extractionMeta,
    })
    .eq("id", fileId)
    .eq("owner_id", ownerId);

  await sb.from("ocr_texts").delete().eq("owner_id", ownerId).eq("file_id", fileId);
  if (extraction.ocrTexts.length) {
    await sb.from("ocr_texts").insert(
      extraction.ocrTexts.map((entry) => ({
        owner_id: ownerId,
        file_id: fileId,
        file_md5: String((f as any).md5 || ""),
        page: entry.page,
        text: entry.text,
        engine: entry.engine,
      })),
    );
  }

  return Response.json({
    ok: true,
    fileId,
    chunkCount: rows.length,
    extractionMethod: extraction.extractionMethod,
    extractionQuality: extraction.extractionQuality,
    ocrPages: extraction.ocrPages,
    extractionMeta: extraction.extractionMeta,
    chunkPreview: rows.slice(0, 4).map((row, idx) => ({
      idx,
      page_from: row.page_from,
      extraction_quality: row.extraction_quality,
      extraction_method: row.extraction_method,
      content_preview: String(row.content ?? "").slice(0, 240),
    })),
  });
}
