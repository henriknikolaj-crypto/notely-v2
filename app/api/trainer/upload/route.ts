import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import { PDFDocument } from "pdf-lib";
import {
  extractPdfWithFallback,
  type ExtractedPdfDocument,
  type ExtractedPdfPage,
  type PdfExtractionTimings,
  type PdfExtractionProgress,
} from "@/lib/pdf/extractPdfWithFallback";
import { buildChunksFromExtractedPages } from "@/lib/pdf/chunkStructuredPages";
import { getImportQuotaSnapshot } from "@/lib/quota/importUsage";
import { quotaTryConsume } from "@/lib/quota/rpc";
import { resolveModelForFeature } from "@/lib/openai/model";
import {
  assertCanGenerateNoteType,
  FREEMIUM_FOCUS_MONTHLY_LIMIT_MESSAGE,
  FREEMIUM_NOTES_LIMIT_MESSAGE,
  FREEMIUM_SUMMARY_MONTHLY_LIMIT_MESSAGE,
  getNoteEntitlement,
} from "@/lib/notes/entitlements";
import { generateNotesForFile } from "@/lib/notes/generateFromFile";
import { normalizePlanCode } from "@/lib/plan/limits";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { trackProductEvent } from "@/lib/server/trackProductEvent";
import { getActiveFolderIdSet, purgeFileArtifacts, purgeInactiveDuplicateFiles } from "@/lib/server/file-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hold denne i sync med DELETE-route (din /api/files/[id] bruger trainer_uploads)
const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "trainer_uploads";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // hård beskyttelse (ikke quota)
const MAX_PDF_PAGES = 100;
const FREEMIUM_PDF_PAGE_LIMIT = 15;
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".mp4", ".mpeg", ".mpga", ".webm", ".ogg", ".oga", ".flac", ".aac"]);
const SCAN_PDF_TEXT_UNREADABLE_MESSAGE =
  "PDF’en kunne åbnes, men teksten ligger som billeder, og OCR-prøven gav ikke nok læsbar tekst til sikker behandling.";
const SCAN_HEAVY_PDF_REJECTED_MESSAGE =
  "PDF’en kunne åbnes, men den indeholder for meget scan-/billedindhold til sikker behandling. Del filen op eller brug en mere tekstbaseret PDF.";
const PDF_TOO_MANY_PAGES_MESSAGE =
  "PDF’en har for mange sider til hurtig og sikker behandling. Del den op i mindre filer på højst 100 sider.";
const DOC_CHUNKS_DB_TIMEOUT_MS = (() => {
  const fallback = process.env.NODE_ENV === "production" ? 60_000 : 15_000;
  const value = Number(process.env.DOC_CHUNKS_DB_TIMEOUT_MS ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
})();

function logUploadStage(requestId: string, stage: string, meta?: Record<string, unknown>) {
  console.info("[trainer/upload] stage", {
    requestId,
    stage,
    ...(meta ?? {}),
  });
}

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

async function withOperationTimeout<T>(label: string, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const error: any = new Error(`${label} timed out after ${timeoutMs}ms`);
          error.code = "OPERATION_TIMEOUT";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function stripPathy(name: string) {
  const n = String(name ?? "").trim();
  const base = n.split(/[\\/]/g).pop() || n || "upload.pdf";
  return base.replace(/[\u0000-\u001F]/g, "").slice(0, 180) || "upload.pdf";
}

function getFileExtension(name: string) {
  const safeName = stripPathy(name);
  const idx = safeName.lastIndexOf(".");
  if (idx < 0) return "";
  return safeName.slice(idx).toLowerCase();
}

function detectUploadKind(file: File, originalName: string): "pdf" | "audio" | "other" {
  const mime = String((file as any)?.type ?? "").trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";

  const ext = getFileExtension(originalName);
  if (ext === ".pdf") return "pdf";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "other";
}

function getPdfExtractionStats(extraction: ExtractedPdfDocument) {
  return extraction.pages.reduce(
    (acc, page) => {
      acc.totalChars += page.textCharCount;
      acc.totalWords += page.wordCount;
      if (page.textCharCount > 0) acc.nonEmptyPages += 1;
      if (page.extractionQuality !== "low" || page.wordCount >= 20) acc.usablePages += 1;
      return acc;
    },
    { totalChars: 0, totalWords: 0, nonEmptyPages: 0, usablePages: 0 },
  );
}

function isScanLikeExtraction(extraction: ExtractedPdfDocument) {
  const scanPages = Number(extraction.extractionMeta.page_type_counts?.scan ?? 0);
  return (
    extraction.pageCount > 0 &&
    (extraction.ocrPages > 0 ||
      extraction.extractionMethod !== "text" ||
      extraction.extractionMeta.dominant_page_type === "scan" ||
      scanPages >= Math.max(1, Math.ceil(extraction.pageCount / 2)))
  );
}

function getPdfDocumentClass(extraction: ExtractedPdfDocument) {
  return String(extraction.extractionMeta.document_class ?? "").trim().toLowerCase();
}

function isImageOnlyPdfExtraction(extraction: ExtractedPdfDocument) {
  return getPdfDocumentClass(extraction) === "image_only_pdf";
}

function isPdfTextInsufficientAfterExtraction(extraction: ExtractedPdfDocument) {
  if (extraction.extractionMeta.failure_reason) return true;
  const stats = getPdfExtractionStats(extraction);
  return (
    isScanLikeExtraction(extraction) &&
    extraction.extractionQuality === "low" &&
    stats.usablePages === 0 &&
    stats.totalChars < 120 &&
    stats.totalWords < 24
  );
}

function getPdfUnreadableFailureReason(extraction: ExtractedPdfDocument) {
  return extraction.extractionMeta.failure_reason ?? "text_unreadable_after_ocr";
}

function getPdfUnreadableMessage(extraction: ExtractedPdfDocument) {
  return getPdfUnreadableFailureReason(extraction) === "scan_heavy_pdf_rejected"
    ? SCAN_HEAVY_PDF_REJECTED_MESSAGE
    : SCAN_PDF_TEXT_UNREADABLE_MESSAGE;
}

function buildPdfExtractionMeta(
  extraction: ExtractedPdfDocument,
  requestId: string,
  processingStatus: string,
  extra?: Record<string, unknown>,
) {
  return {
    ...extraction.extractionMeta,
    input_kind: "pdf",
    processing_status: processingStatus,
    request_id: requestId,
    ...(extra ?? {}),
  };
}

type PdfUploadPhaseTimings = {
  storage_download_ms?: number;
  classify_ms?: number;
  pdf_open_ms?: number;
  render_ms?: number;
  ocr_ms?: number;
  chunk_ms?: number;
  finalize_ms?: number;
  total_ms?: number;
  page_count?: number;
  ocr_page_count?: number;
  document_class?: string | null;
  processing_route?: string | null;
  final_status?: string | null;
};

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, nowMs() - startedAt);
}

function addTimingMs(
  timings: PdfUploadPhaseTimings,
  key: "pdf_open_ms" | "render_ms" | "ocr_ms" | "chunk_ms" | "finalize_ms",
  value: number | null | undefined,
) {
  if (!Number.isFinite(value)) return;
  timings[key] = Math.max(0, Math.round((timings[key] ?? 0) + Number(value)));
}

function mergeExtractionTimings(timings: PdfUploadPhaseTimings, extraction: ExtractedPdfDocument | null | undefined) {
  if (!extraction) return;
  const extractionTimings = extraction.timings as PdfExtractionTimings | undefined;
  addTimingMs(timings, "pdf_open_ms", extractionTimings?.pdf_open_ms);
  addTimingMs(timings, "render_ms", extractionTimings?.render_ms);
  addTimingMs(timings, "ocr_ms", extractionTimings?.ocr_ms);
  timings.page_count = extraction.pageCount;
  timings.ocr_page_count = Math.max(0, Math.round((timings.ocr_page_count ?? 0) + Number(extractionTimings?.ocr_page_count ?? 0)));
  const documentClass = String(extraction.extractionMeta.document_class ?? "").trim();
  const processingRoute = String(extraction.extractionMeta.extraction_route ?? "").trim();
  timings.document_class = documentClass || (timings.document_class ?? null);
  timings.processing_route = processingRoute || (timings.processing_route ?? null);
}

function buildPdfPhaseTimingsPayload(timings: PdfUploadPhaseTimings) {
  const payload: Record<string, unknown> = {};
  const numericKeys: Array<keyof PdfUploadPhaseTimings> = [
    "storage_download_ms",
    "classify_ms",
    "pdf_open_ms",
    "render_ms",
    "ocr_ms",
    "chunk_ms",
    "finalize_ms",
    "total_ms",
    "page_count",
    "ocr_page_count",
  ];
  for (const key of numericKeys) {
    const value = timings[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      payload[key] = Math.max(0, Math.round(value));
    }
  }
  if (timings.document_class) payload.document_class = timings.document_class;
  if (timings.processing_route) payload.processing_route = timings.processing_route;
  if (timings.final_status) payload.final_status = timings.final_status;
  return payload;
}

function isPdfFastPathCandidate(extraction: ExtractedPdfDocument) {
  if (extraction.extractionMeta.failure_reason) return false;
  if (isImageOnlyPdfExtraction(extraction)) return false;
  if (isPdfTextInsufficientAfterExtraction(extraction)) return false;

  const stats = getPdfExtractionStats(extraction);
  const pageCount = Math.max(1, extraction.pageCount);
  const goodTextPages = Math.max(0, Number(extraction.extractionMeta.pages_with_good_text ?? 0));
  const ocrCandidatePages = Math.max(0, Number(extraction.extractionMeta.ocr_candidate_pages ?? 0));
  const scanPages = Math.max(0, Number(extraction.extractionMeta.page_type_counts?.scan ?? 0));

  const hasEnoughReadableText =
    stats.usablePages >= Math.max(1, Math.min(3, Math.ceil(pageCount * 0.2))) ||
    stats.totalWords >= Math.max(40, pageCount * 10) ||
    stats.totalChars >= Math.max(250, pageCount * 120);
  const textCoverageLooksHealthy =
    goodTextPages >= Math.max(1, Math.ceil(pageCount * 0.35)) &&
    ocrCandidatePages <= Math.max(2, Math.ceil(pageCount * 0.45)) &&
    scanPages <= Math.max(1, Math.ceil(pageCount * 0.35));

  return hasEnoughReadableText && textCoverageLooksHealthy;
}

function shouldRunPdfDeepProcessing(extraction: ExtractedPdfDocument) {
  if (extraction.extractionMeta.failure_reason) return false;
  if (isImageOnlyPdfExtraction(extraction)) return true;
  const ocrCandidatePages = Math.max(0, Number(extraction.extractionMeta.ocr_candidate_pages ?? 0));
  return ocrCandidatePages > 0;
}

function buildPdfTooManyPagesResponse(args: { requestId: string; pages: number }) {
  return NextResponse.json(
    {
      ok: false,
      code: "FILE_TOO_LONG",
      message: PDF_TOO_MANY_PAGES_MESSAGE,
      pages: args.pages,
      pageLimit: MAX_PDF_PAGES,
      failureReason: "pdf_too_many_pages",
      requestId: args.requestId,
    },
    { status: 413 },
  );
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

function resolveUploadAuthClient(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll() {
        // Do not mutate auth cookies from this multipart route in preview.
      },
    },
  });
}



async function getUploadPlan(admin: any, ownerId: string): Promise<{
  plan: string;
  rawPlan: string | null;
  resolved: boolean;
}> {
  try {
    const r = await admin.from("profiles").select("id, plan").eq("id", ownerId).maybeSingle();
    if (r.error) {
      console.warn("[trainer/upload] plan lookup failed", {
        ownerId,
        error: errInfo(r.error),
      });
      return { plan: "freemium", rawPlan: null, resolved: false };
    }

    const profileId = String((r.data as any)?.id ?? "").trim();
    const rawPlanValue = (r.data as any)?.plan;
    const rawPlan = rawPlanValue == null ? null : String(rawPlanValue).trim();
    if (!profileId) {
      console.warn("[trainer/upload] plan lookup missing profile", {
        ownerId,
        rawPlan,
      });
      return { plan: normalizePlanCode(rawPlan), rawPlan, resolved: false };
    }

    return {
      plan: normalizePlanCode(rawPlan),
      rawPlan,
      resolved: true,
    };
  } catch (error) {
    console.warn("[trainer/upload] plan lookup exception", {
      ownerId,
      error: errInfo(error),
    });
    return { plan: "freemium", rawPlan: null, resolved: false };
  }
}

async function tryInsertFile(admin: any, rows: Array<{ label: string; row: Record<string, unknown> }>) {
  let lastErr: any = null;
  for (const attempt of rows) {
    const r = await admin.from("files").insert(attempt.row).select("id").maybeSingle();
    if (!r.error) return { ok: true as const, id: (r.data as any)?.id ?? attempt.row.id };
    console.error("[trainer/upload] files insert attempt failed:", {
      label: attempt.label,
      keys: Object.keys(attempt.row),
      error: errInfo(r.error),
    });
    lastErr = r.error;
  }
  return { ok: false as const, error: lastErr };
}

async function tryInsertJob(admin: any, rows: Array<{ label: string; row: Record<string, unknown> }>) {
  let lastErr: any = null;
  for (const attempt of rows) {
    const r = await admin.from("jobs").insert(attempt.row).select("id");
    const data = r.data as any;
    const insertId =
      Array.isArray(data)
        ? ((data[0] as any)?.id ? String((data[0] as any).id) : null)
        : data && typeof data === "object" && "id" in data
          ? String((data as any).id)
          : null;
    if (!r.error) {
      const fallbackId = typeof attempt.row.id === "string" ? attempt.row.id : null;
      return { ok: true as const, id: insertId ?? fallbackId, label: attempt.label };
    }
    console.warn("[trainer/upload] jobs insert attempt failed:", {
      label: attempt.label,
      keys: Object.keys(attempt.row),
      error: errInfo(r.error),
    });
    lastErr = r.error;
  }
  return { ok: false as const, error: lastErr };
}

async function rebuildDocChunksForFile(
  admin: any,
  args: {
    ownerId: string;
    fileId: string;
    folderId: string;
    originalName: string;
    pages: ExtractedPdfPage[];
  },
) {
  const { ownerId, fileId, folderId, originalName, pages } = args;
  let rowCount = 0;

  console.info("[trainer/upload] rebuildDocChunksForFile enter", {
    fileId,
    ownerId,
    folderId,
    pageCount: pages.length,
    timeoutMs: DOC_CHUNKS_DB_TIMEOUT_MS,
  });

  try {
    console.info("[trainer/upload] rebuildDocChunksForFile before_delete", {
      fileId,
      ownerId,
    });
    const del: any = await withOperationTimeout("doc_chunks delete", DOC_CHUNKS_DB_TIMEOUT_MS, () =>
      admin.from("doc_chunks").delete().eq("owner_id", ownerId).eq("file_id", fileId),
    );
    if (del.error) {
      console.error("[trainer/upload] rebuildDocChunksForFile delete error", {
        fileId,
        ownerId,
        error: errInfo(del.error),
      });
      throw del.error;
    }
    console.info("[trainer/upload] rebuildDocChunksForFile after_delete", {
      fileId,
      ownerId,
    });

    const chunkCandidates = buildChunksFromExtractedPages(pages);
    const rows = chunkCandidates
      .map((chunk) => ({
        owner_id: ownerId,
        file_id: fileId,
        folder_id: folderId,
        content: chunk.content || "",
        source: originalName,
        source_type: "user_upload",
        allow_in_answer: true,
        page_from: chunk.pageNumber,
        page_to: chunk.pageNumber,
        source_page: chunk.pageNumber,
        extraction_method: chunk.extractionMethod,
        extraction_quality: chunk.extractionQuality,
      }))
      .filter((row) => row.content.trim().length > 0);
    rowCount = rows.length;

    console.info("[trainer/upload] rebuildDocChunksForFile rows_built", {
      fileId,
      ownerId,
      pageCount: pages.length,
      chunkCandidateCount: chunkCandidates.length,
      rowCount,
    });

    if (!rows.length) throw new Error("Ingen chunks dannet fra PDF.");

    console.info("[trainer/upload] rebuildDocChunksForFile before_insert", {
      fileId,
      ownerId,
      rowCount,
    });
    const ins: any = await withOperationTimeout("doc_chunks insert", DOC_CHUNKS_DB_TIMEOUT_MS, () =>
      admin.from("doc_chunks").insert(rows),
    );
    if (ins.error) {
      console.error("[trainer/upload] rebuildDocChunksForFile insert error", {
        fileId,
        ownerId,
        rowCount,
        error: errInfo(ins.error),
      });
      throw ins.error;
    }
    console.info("[trainer/upload] rebuildDocChunksForFile after_insert", {
      fileId,
      ownerId,
      rowCount,
    });
    console.info("[trainer/upload] rebuildDocChunksForFile exit", {
      fileId,
      ownerId,
      rowCount,
    });
    return { chunkCount: rows.length };
  } catch (error) {
    console.error("[trainer/upload] rebuildDocChunksForFile failed", {
      fileId,
      ownerId,
      folderId,
      pageCount: pages.length,
      rowCount,
      error: errInfo(error),
    });
    throw error;
  }
}

async function syncOcrTextsForFile(
  admin: any,
  args: {
    ownerId: string;
    fileId: string;
    fileMd5: string;
    ocrTexts: Array<{ page: number; text: string; engine: string }>;
  },
) {
  const { ownerId, fileId, fileMd5, ocrTexts } = args;
  await admin.from("ocr_texts").delete().eq("owner_id", ownerId).eq("file_md5", fileMd5);
  if (!ocrTexts.length) return;

  const rows = ocrTexts.map((entry) => ({
    owner_id: ownerId,
    file_id: fileId,
    file_md5: fileMd5,
    page: entry.page,
    text: entry.text,
    engine: entry.engine,
  }));

  const ins = await admin.from("ocr_texts").insert(rows);
  if (ins.error) {
    console.warn("[trainer/upload] ocr_texts insert warning:", errInfo(ins.error));
  }
}

function parseRequestedNoteModes(raw: FormDataEntryValue | null): Array<"resume" | "golden"> {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "focus") return ["golden"];
  if (value === "both") return ["resume", "golden"];
  return ["resume"];
}

function chunkTranscriptText(text: string, targetLength = 1400) {
  const cleaned = String(text ?? "").replace(/\r/g, "").trim();
  if (!cleaned) return [];

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const parts = paragraphs.length > 0 ? paragraphs : [cleaned];
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    if (!current) {
      current = part;
      continue;
    }
    if ((current.length + 2 + part.length) <= targetLength) {
      current = `${current}\n\n${part}`;
      continue;
    }
    chunks.push(current);
    current = part;
  }

  if (current) chunks.push(current);
  return chunks;
}

async function rebuildDocChunksForAudio(
  admin: any,
  args: {
    ownerId: string;
    fileId: string;
    folderId: string;
    originalName: string;
    transcriptText: string;
  },
) {
  const { ownerId, fileId, folderId, originalName, transcriptText } = args;

  const del = await admin.from("doc_chunks").delete().eq("owner_id", ownerId).eq("file_id", fileId);
  if (del.error) throw del.error;

  const contentChunks = chunkTranscriptText(transcriptText);
  if (contentChunks.length === 0) throw new Error("Tom transskription.");

  const rows = contentChunks
    .map((content) => ({
    owner_id: ownerId,
    file_id: fileId,
    folder_id: folderId,
    source: originalName,
    source_type: "user_upload",
    allow_in_answer: true,
    page_from: 1,
    page_to: 1,
    source_page: 1,
    content,
    extraction_method: "text",
    extraction_quality: "high",
  }))
    .filter((row) => row.content.trim().length > 0);

  const ins = await admin.from("doc_chunks").insert(rows);
  if (ins.error) throw ins.error;
  return { chunkCount: rows.length };
}

function buildQuotaExceededResponse(args: {
  requestId: string;
  pages: number;
  usedThisMonth: number;
  monthlyLimit: number | null;
  resetAt: string;
}) {
  const { requestId, pages, usedThisMonth, monthlyLimit, resetAt } = args;
  const remainingThisMonth =
    typeof monthlyLimit === "number" ? Math.max(0, monthlyLimit - usedThisMonth) : null;
  const message =
    typeof remainingThisMonth === "number"
      ? remainingThisMonth > 0
        ? `Du har kun ${remainingThisMonth} ${remainingThisMonth === 1 ? "side" : "sider"} tilbage denne måned, men filen kræver ${pages} ${pages === 1 ? "side" : "sider"}.`
        : `Du har brugt din månedlige upload-kvote. Filen kræver ${pages} ${pages === 1 ? "side" : "sider"}.`
      : `Du har nået din månedlige upload-kvote. Filen kræver ${pages} ${pages === 1 ? "side" : "sider"}.`;
  return NextResponse.json(
    {
      ok: false,
      code: "QUOTA_EXCEEDED",
      feature: "import",
      usedThisMonth,
      monthlyLimit,
      remainingThisMonth,
      resetAt,
      pages,
      message,
      requestId,
    },
    { status: 429 },
  );
}

async function uploadStorageObjectExists(admin: any, storagePath: string) {
  const safePath = String(storagePath ?? "").trim();
  if (!safePath) return false;
  try {
    const result = await admin.storage.from(UPLOAD_BUCKET).download(safePath);
    return !result.error;
  } catch {
    return false;
  }
}

async function findActiveDuplicateUpload(admin: any, args: { ownerId: string; md5: string }) {
  const { ownerId, md5 } = args;
  const { data, error } = await admin
    .from("files")
    .select("id,folder_id,storage_path")
    .eq("owner_id", ownerId)
    .eq("md5", md5)
    .limit(20);

  if (error) return { duplicate: null as null | { id: string; storage_path: string }, error };

  const rows = Array.isArray(data)
    ? (data as Array<{ id?: string | null; folder_id?: string | null; storage_path?: string | null }>)
    : [];
  const folderIds = Array.from(
    new Set(
      rows
        .map((row) => String(row?.folder_id ?? "").trim())
        .filter(Boolean),
    ),
  );

  let activeFolderIds = new Set<string>();
  try {
    activeFolderIds = await getActiveFolderIdSet(admin, { ownerId, folderIds });
  } catch (foldersError) {
    return { duplicate: null as null | { id: string; storage_path: string }, error: foldersError };
  }

  for (const row of rows) {
    const id = String(row?.id ?? "").trim();
    const folderId = String(row?.folder_id ?? "").trim();
    const storagePath = String(row?.storage_path ?? "").trim();
    if (!id || !folderId || !storagePath) continue;
    if (!activeFolderIds.has(folderId)) continue;
    return { duplicate: { id, storage_path: storagePath }, error: null };
  }

  return { duplicate: null as null | { id: string; storage_path: string }, error: null };
}

async function safeUpdateJob(admin: any, jobId: string | null, patch: Record<string, unknown>) {
  if (!jobId) return;
  const payload = (patch as any).payload;
  const meta = (patch as any).meta;
  const errorValue = (patch as any).error;
  const basePatch = { ...patch };
  const bookkeepingPatch: Record<string, unknown> = {};
  for (const key of ["status", "file_id", "started_at", "finished_at"]) {
    if (key in basePatch) bookkeepingPatch[key] = (basePatch as any)[key];
  }

  const seen = new Set<string>();
  const pushAttempt = (list: Record<string, unknown>[], candidate: Record<string, unknown>) => {
    if (!candidate || Object.keys(candidate).length === 0) return;
    const key = JSON.stringify(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    list.push(candidate);
  };

  const bookkeepingAttempts: Record<string, unknown>[] = [];
  const payloadAttempts: Record<string, unknown>[] = [];

  if (Object.keys(bookkeepingPatch).length > 0) {
    pushAttempt(bookkeepingAttempts, bookkeepingPatch);
    if ("file_id" in bookkeepingPatch) {
      const withoutFileId = { ...bookkeepingPatch };
      delete (withoutFileId as any).file_id;
      pushAttempt(bookkeepingAttempts, withoutFileId);
    }
    if ("started_at" in bookkeepingPatch || "finished_at" in bookkeepingPatch) {
      const withoutTimestamps = { ...bookkeepingPatch };
      delete (withoutTimestamps as any).started_at;
      delete (withoutTimestamps as any).finished_at;
      pushAttempt(bookkeepingAttempts, withoutTimestamps);
      if ("file_id" in withoutTimestamps) {
        const withoutFileIdAndTimestamps = { ...withoutTimestamps };
        delete (withoutFileIdAndTimestamps as any).file_id;
        pushAttempt(bookkeepingAttempts, withoutFileIdAndTimestamps);
      }
    }
  }

  const seedPatches: Record<string, unknown>[] = [basePatch];
  if (payload && meta) {
    const next = { ...basePatch };
    delete (next as any).meta;
    seedPatches.push(next);
  }
  if (payload && !meta) {
    const next = { ...basePatch };
    delete (next as any).payload;
    (next as any).meta = payload;
    seedPatches.push(next);
  }
  if (typeof errorValue === "object" && errorValue !== null) {
    seedPatches.push({
      ...basePatch,
      error: JSON.stringify(errorValue),
    });
  }
  if (payload) {
    const next = { ...basePatch };
    delete (next as any).payload;
    delete (next as any).result;
    (next as any).meta = payload;
    if (typeof errorValue === "object" && errorValue !== null) {
      (next as any).error = JSON.stringify(errorValue);
    }
    seedPatches.push(next);
  }

  for (const seed of seedPatches) {
    pushAttempt(payloadAttempts, seed);
    if ("started_at" in seed || "finished_at" in seed) {
      const withoutTimestamps = { ...seed };
      delete (withoutTimestamps as any).started_at;
      delete (withoutTimestamps as any).finished_at;
      pushAttempt(payloadAttempts, withoutTimestamps);
    }
  }

  try {
    let lastError: any = null;
    const tryAttempts = async (attempts: Record<string, unknown>[], mode: "bookkeeping" | "payload") => {
      let succeeded = false;
      for (const attempt of attempts) {
        const result = await admin.from("jobs").update(attempt).eq("id", jobId);
        if (!result.error) {
          const status = typeof (attempt as any).status === "string" ? String((attempt as any).status) : null;
          const stage =
            typeof (attempt as any).payload?.stage === "string"
              ? String((attempt as any).payload.stage)
              : typeof (attempt as any).meta?.stage === "string"
                ? String((attempt as any).meta.stage)
                : null;
          if (status === "queued" || status === "finished" || status === "succeeded" || status === "failed") {
            console.info("[trainer/upload] job update committed", {
              jobId,
              mode,
              status,
              stage,
              fileId:
                typeof (attempt as any).file_id === "string"
                  ? String((attempt as any).file_id)
                  : typeof (attempt as any).payload?.file_id === "string"
                    ? String((attempt as any).payload.file_id)
                    : typeof (attempt as any).meta?.file_id === "string"
                      ? String((attempt as any).meta.file_id)
                      : typeof (attempt as any).result?.fileId === "string"
                        ? String((attempt as any).result.fileId)
                        : null,
              patchKeys: Object.keys(attempt),
            });
          }
          succeeded = true;
          break;
        }
        lastError = result.error;
      }
      return succeeded;
    };

    const bookkeepingSucceeded = await tryAttempts(bookkeepingAttempts, "bookkeeping");
    const payloadSucceeded =
      payloadAttempts.length > 0 ? await tryAttempts(payloadAttempts, "payload") : bookkeepingSucceeded;

    if (bookkeepingSucceeded || payloadSucceeded) return;

    console.warn("[trainer/upload] job update warning:", {
      jobId,
      error: errInfo(lastError),
      patchKeys: Object.keys(patch),
    });
  } catch (error) {
    console.warn("[trainer/upload] job update warning:", { jobId, error: errInfo(error), patchKeys: Object.keys(patch) });
  }
}

function buildJobTrackingPayload(args: {
  requestId: string;
  folderId: string | null;
  fileName: string;
  mimeType: string;
  uploadKind: "pdf" | "audio" | "other";
  sizeBytes: number | null;
  stage: string;
  md5?: string;
  fileId?: string;
  storagePath?: string;
  pageCount?: number;
  ocrPages?: number;
  extractionMethod?: string;
  extractionQuality?: string;
  chunkCount?: number;
}) {
  const payload: Record<string, unknown> = {
    source: "trainer_upload",
    request_id: args.requestId,
    folder_id: args.folderId,
    file_name: args.fileName,
    mime_type: args.mimeType,
    upload_kind: args.uploadKind,
    size_bytes: args.sizeBytes,
    stage: args.stage,
  };
  if (args.md5) payload.md5 = args.md5;
  if (args.fileId) payload.file_id = args.fileId;
  if (args.storagePath) payload.storage_path = args.storagePath;
  if (typeof args.pageCount === "number") payload.page_count = args.pageCount;
  if (typeof args.ocrPages === "number") payload.ocr_pages = args.ocrPages;
  if (args.extractionMethod) payload.extraction_method = args.extractionMethod;
  if (args.extractionQuality) payload.extraction_quality = args.extractionQuality;
  if (typeof args.chunkCount === "number") payload.chunkCount = args.chunkCount;
  return payload;
}

async function updatePdfJobStage(args: {
  admin: any;
  jobId: string | null;
  requestId: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  md5: string;
  stage: string;
  fileId?: string;
  storagePath?: string;
  pageCount?: number;
  ocrPages?: number;
  extractionMethod?: string;
  extractionQuality?: string;
  chunkCount?: number;
  extraPayload?: Record<string, unknown>;
}) {
  const {
    admin,
    jobId,
    requestId,
    folderId,
    fileName,
    mimeType,
    sizeBytes,
    md5,
    stage,
    fileId,
    storagePath,
    pageCount,
    ocrPages,
    extractionMethod,
    extractionQuality,
    chunkCount,
    extraPayload,
  } = args;
  const trackingPayload = {
    ...buildJobTrackingPayload({
      requestId,
      folderId,
      fileName,
      mimeType,
      uploadKind: "pdf",
      sizeBytes,
      md5,
      fileId,
      storagePath,
      pageCount,
      ocrPages,
      extractionMethod,
      extractionQuality,
      chunkCount,
      stage,
    }),
    ...(extraPayload ?? {}),
  };

  await safeUpdateJob(admin, jobId, {
    ...(fileId ? { file_id: fileId } : {}),
    payload: trackingPayload,
    meta: trackingPayload,
  });
}

async function countPdfPagesQuick(buf: Buffer) {
  const doc = await PDFDocument.load(buf);
  return Number(doc.getPageCount() ?? 0) || 0;
}

async function safeUpdateFileRecord(admin: any, fileId: string, patch: Record<string, unknown>) {
  try {
    const result = await admin.from("files").update(patch).eq("id", fileId);
    if (result.error) {
      console.warn("[trainer/upload] files update warning:", {
        fileId,
        error: errInfo(result.error),
        patchKeys: Object.keys(patch),
      });
    }
  } catch (error) {
    console.warn("[trainer/upload] files update warning:", {
      fileId,
      error: errInfo(error),
      patchKeys: Object.keys(patch),
    });
  }
}

type AcceptedPdfProcessResult = {
  ok: boolean;
  stage: string;
  jobStatus: string;
  processing: boolean;
  ready: boolean;
  failureMessage: string | null;
  pageCount: number;
  chunkCount: number | null;
};

async function processAcceptedPdfUpload(args: {
  requestId: string;
  jobId: string | null;
  ownerId: string;
  folderId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number | null;
  md5: string;
  buf: Buffer;
  fileId: string;
  storagePath: string;
  effectivePages: number;
  quotaResetAt: string;
  requestStartedAtMs: number;
  initialTimings?: PdfUploadPhaseTimings;
}): Promise<AcceptedPdfProcessResult> {
  const {
    requestId,
    jobId,
    ownerId,
    folderId,
    originalName,
    mimeType,
    sizeBytes,
    md5,
    buf,
    fileId,
    storagePath,
    effectivePages,
    quotaResetAt,
    requestStartedAtMs,
    initialTimings,
  } = args;
  const admin = supabaseAdmin();
  const phaseTimings: PdfUploadPhaseTimings = {
    ...(initialTimings ?? {}),
    page_count: initialTimings?.page_count ?? effectivePages,
  };

  try {
    const buildStageTrackingPayload = (
      stage: string,
      extraction?: ExtractedPdfDocument | null,
      chunkCount?: number | null,
      extraPayload?: Record<string, unknown>,
    ) => ({
      ...buildJobTrackingPayload({
        requestId,
        folderId,
        fileName: originalName,
        mimeType,
        uploadKind: "pdf",
        sizeBytes,
        md5,
        fileId,
        storagePath,
        pageCount: extraction?.pageCount ?? effectivePages,
        ocrPages: extraction?.ocrPages,
        extractionMethod: extraction?.extractionMethod,
        extractionQuality: extraction?.extractionQuality,
        chunkCount: typeof chunkCount === "number" ? chunkCount : undefined,
        stage,
      }),
      ...(extraPayload ?? {}),
    });

    const persistExtraction = async (
      extraction: ExtractedPdfDocument,
      processingStatus: string,
      extraMeta?: Record<string, unknown>,
    ) => {
      await safeUpdateFileRecord(admin, fileId, {
        page_count: extraction.pageCount,
        ocr_pages: extraction.ocrPages,
        extraction_method: extraction.extractionMethod,
        extraction_quality: extraction.extractionQuality,
        extraction_meta: buildPdfExtractionMeta(extraction, requestId, processingStatus, extraMeta),
      });
    };

    const buildPhaseTimingExtraMeta = (extraMeta?: Record<string, unknown>) => ({
      ...(extraMeta ?? {}),
      phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
    });

    const persistPhaseTimingSnapshot = async (args: {
      stage: string;
      processingStatus: string;
      jobStatus: "succeeded" | "failed";
      extraction?: ExtractedPdfDocument | null;
      chunkCount?: number | null;
      extraMeta?: Record<string, unknown>;
      finishedAt?: string;
      errorMessage?: string | null;
      result?: Record<string, unknown> | null;
    }) => {
      const timingExtraMeta = buildPhaseTimingExtraMeta(args.extraMeta);
      if (args.extraction) {
        await safeUpdateFileRecord(admin, fileId, {
          page_count: args.extraction.pageCount,
          ocr_pages: args.extraction.ocrPages,
          extraction_method: args.extraction.extractionMethod,
          extraction_quality: args.extraction.extractionQuality,
          extraction_meta: buildPdfExtractionMeta(args.extraction, requestId, args.processingStatus, timingExtraMeta),
        });
      } else {
        await safeUpdateFileRecord(admin, fileId, {
          extraction_meta: {
            input_kind: "pdf",
            processing_status: args.processingStatus,
            request_id: requestId,
            ...timingExtraMeta,
          },
        });
      }

      const trackingPayload = buildStageTrackingPayload(args.stage, args.extraction, args.chunkCount ?? null, timingExtraMeta);
      await safeUpdateJob(admin, jobId, {
        status: args.jobStatus,
        file_id: fileId,
        ...(args.finishedAt ? { finished_at: args.finishedAt } : {}),
        payload: trackingPayload,
        meta: trackingPayload,
        ...(args.result ? { result: args.result } : {}),
        ...(args.jobStatus === "succeeded" ? { error: null } : {}),
        ...(args.jobStatus === "failed"
          ? {
              error: { message: args.errorMessage ?? "PDF-behandling fejlede." },
            }
          : {}),
      });
    };

    const finalizePhaseTimings = async (args: {
      stage: string;
      processingStatus: string;
      jobStatus: "succeeded" | "failed";
      extraction?: ExtractedPdfDocument | null;
      chunkCount?: number | null;
      extraMeta?: Record<string, unknown>;
      finishedAt?: string;
      errorMessage?: string | null;
      finalStatus: string;
      result?: Record<string, unknown> | null;
    }) => {
      const finalizeStartedAt = nowMs();
      await persistPhaseTimingSnapshot(args);
      addTimingMs(phaseTimings, "finalize_ms", elapsedMs(finalizeStartedAt));
      phaseTimings.total_ms = elapsedMs(requestStartedAtMs);
      phaseTimings.final_status = args.finalStatus;
      await persistPhaseTimingSnapshot(args);
      console.info("[trainer/upload] pdf phase timings", {
        requestId,
        jobId,
        fileId,
        ...buildPdfPhaseTimingsPayload(phaseTimings),
      });
    };

    const failBeforeReady = async (
      message: string,
      failureReason: string,
      extraction?: ExtractedPdfDocument | null,
      extraPayload?: Record<string, unknown>,
    ): Promise<AcceptedPdfProcessResult> => {
      const finishedAt = new Date().toISOString();
      phaseTimings.final_status = "failed";
      phaseTimings.total_ms = elapsedMs(requestStartedAtMs);
      await finalizePhaseTimings({
        stage: "failed",
        processingStatus: "failed",
        jobStatus: "failed",
        extraction,
        finishedAt,
        errorMessage: message,
        finalStatus: "failed",
        extraMeta: {
          failure_reason: failureReason,
          ...(extraPayload ?? {}),
        },
      });
      return {
        ok: false,
        stage: "failed",
        jobStatus: "failed",
        processing: false,
        ready: false,
        failureMessage: message,
        pageCount: extraction?.pageCount ?? effectivePages,
        chunkCount: typeof extraPayload?.chunk_count === "number" ? Number(extraPayload.chunk_count) : null,
      };
    };

    const finalizeSuccess = async (args: {
      extraction: ExtractedPdfDocument;
      chunkCount: number;
      jobStage?: string;
      processingStatus?: string;
      extraMeta?: Record<string, unknown>;
    }): Promise<AcceptedPdfProcessResult> => {
      const { extraction, chunkCount, jobStage = "finished", processingStatus = "finished", extraMeta } = args;
      const finishedAt = new Date().toISOString();
      phaseTimings.final_status = processingStatus;
      phaseTimings.total_ms = elapsedMs(requestStartedAtMs);
      await finalizePhaseTimings({
        stage: jobStage,
        processingStatus,
        jobStatus: "succeeded",
        extraction,
        chunkCount,
        finishedAt,
        finalStatus: processingStatus,
        result: {
          ok: true,
          requestId,
          fileId,
          folderId,
          uploadKind: "pdf",
          pages: extraction.pageCount,
          chunkCount,
        },
        extraMeta: {
          dominant_page_type: extraction.extractionMeta.dominant_page_type,
          pages: extraction.pageCount,
          ...(extraMeta ?? {}),
        },
      });
      logUploadStage(requestId, "response_ready", {
        jobId,
        fileId,
        uploadKind: "pdf",
        pages: extraction.pageCount,
        chunkCount,
        accepted: true,
        processingStatus,
      });

      await trackProductEvent({
        admin,
        ownerId,
        eventName: "upload_completed",
        metadata: {
          source: "own",
          folder_id: folderId,
          file_id: fileId,
          feature: "trainer_upload",
          upload_kind: "pdf",
        },
      });
      return {
        ok: true,
        stage: jobStage,
        jobStatus: "succeeded",
        processing: false,
        ready: true,
        failureMessage: null,
        pageCount: extraction.pageCount,
        chunkCount,
      };
    };

    const buildChunksAndSync = async (
      extraction: ExtractedPdfDocument,
      extraPayload?: Record<string, unknown>,
    ) => {
      const chunkStartedAt = nowMs();
      logUploadStage(requestId, "chunk_build_started", {
        jobId,
        fileId,
        uploadKind: "pdf",
        pageCount: extraction.pages.length,
      });
      await updatePdfJobStage({
        admin,
        jobId,
        requestId,
        folderId,
        fileName: originalName,
        mimeType,
        sizeBytes,
        md5,
        fileId,
        storagePath,
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        extractionQuality: extraction.extractionQuality,
        stage: "chunk_build_started",
        extraPayload: buildPhaseTimingExtraMeta(extraPayload),
      });
      const chunkBuild = await rebuildDocChunksForFile(admin, {
        ownerId,
        fileId,
        folderId,
        originalName,
        pages: extraction.pages,
      });
      await syncOcrTextsForFile(admin, {
        ownerId,
        fileId,
        fileMd5: md5,
        ocrTexts: extraction.ocrTexts,
      });
      addTimingMs(phaseTimings, "chunk_ms", elapsedMs(chunkStartedAt));
      logUploadStage(requestId, "chunk_build_finished", {
        jobId,
        fileId,
        chunkCount: chunkBuild.chunkCount,
      });
      await updatePdfJobStage({
        admin,
        jobId,
        requestId,
        folderId,
        fileName: originalName,
        mimeType,
        sizeBytes,
        md5,
        fileId,
        storagePath,
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        extractionQuality: extraction.extractionQuality,
        chunkCount: chunkBuild.chunkCount,
        stage: "chunk_build_finished",
        extraPayload: buildPhaseTimingExtraMeta(extraPayload),
      });
      return chunkBuild;
    };

    const ensureQuota = async (pageCount: number, chunkCount: number, extraction: ExtractedPdfDocument) => {
      const quotaConsume = await quotaTryConsume({
        admin,
        ownerId,
        feature: "import",
        amount: pageCount,
        exceededMessage: `Grænse nået. Du kan uploade igen efter nulstilling (${quotaResetAt ? formatDa(quotaResetAt) : "snart"}).`,
      });

      if (quotaConsume.ok) return { ok: true as const, failure: null };

      await purgeFileArtifacts(admin, { ownerId, fileId, storagePath, fileMd5: md5 });
      const failure = await failBeforeReady(
        quotaConsume.message ??
          "Uploaden kunne ikke færdiggøres, fordi din upload-kvote blev nået under behandlingen.",
        "quota_reached_during_processing",
        extraction,
        { chunk_count: chunkCount },
      );
      return { ok: false as const, failure };
    };

    logUploadStage(requestId, "processing_started", { jobId, fileId, storagePath });
    const startedAt = new Date().toISOString();
    const firstProcessingPayload = buildStageTrackingPayload("first_processing", null, null, buildPhaseTimingExtraMeta());
    await safeUpdateJob(admin, jobId, {
      status: "queued",
      file_id: fileId,
      started_at: startedAt,
      payload: firstProcessingPayload,
      meta: firstProcessingPayload,
    });
    await safeUpdateFileRecord(admin, fileId, {
      extraction_meta: {
        input_kind: "pdf",
        processing_status: "first_processing",
        request_id: requestId,
        phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
      },
    });

    logUploadStage(requestId, "pdf_extract_started", { jobId, fileName: originalName, fileId, phase: "fast" });
    const classifyStartedAt = nowMs();
    const fastExtraction = await extractPdfWithFallback(buf, {
      fileName: originalName,
      fileSizeBytes: sizeBytes ?? buf.length,
      allowOcr: false,
    });
    phaseTimings.classify_ms = elapsedMs(classifyStartedAt);
    mergeExtractionTimings(phaseTimings, fastExtraction);
    const documentClass = getPdfDocumentClass(fastExtraction);
    const processingRoute =
      documentClass !== "text_layer_pdf" || shouldRunPdfDeepProcessing(fastExtraction)
        ? "ocr_first_path"
        : "text_fast_path";
    phaseTimings.document_class = documentClass;
    phaseTimings.processing_route = processingRoute;
    const fastPathCandidate = processingRoute === "text_fast_path" && isPdfFastPathCandidate(fastExtraction);
    logUploadStage(requestId, "pdf_extract_finished", {
      jobId,
      fileId,
      pageCount: fastExtraction.pageCount,
      ocrPages: fastExtraction.ocrPages,
      extractionMethod: fastExtraction.extractionMethod,
      fastPathCandidate,
      documentClass,
      processingRoute,
      phase: "fast",
    });
    await persistExtraction(fastExtraction, "first_processing", {
      fast_path_candidate: fastPathCandidate,
      deep_processing_needed: shouldRunPdfDeepProcessing(fastExtraction),
      document_class: fastExtraction.extractionMeta.document_class,
      processing_route: processingRoute,
      phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
    });
    await updatePdfJobStage({
      admin,
      jobId,
      requestId,
      folderId,
      fileName: originalName,
      mimeType,
      sizeBytes,
      md5,
      fileId,
      storagePath,
      pageCount: fastExtraction.pageCount,
      ocrPages: fastExtraction.ocrPages,
      extractionMethod: fastExtraction.extractionMethod,
      extractionQuality: fastExtraction.extractionQuality,
      stage: "first_processing",
      extraPayload: {
        fast_path_candidate: fastPathCandidate,
        deep_processing_needed: shouldRunPdfDeepProcessing(fastExtraction),
        document_class: fastExtraction.extractionMeta.document_class,
        processing_route: processingRoute,
        phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
      },
    });

    if (!fastPathCandidate) {
      logUploadStage(requestId, "deep_processing_started", { jobId, fileId });
      const ocrRoute = "ocr_first_path";
      const extraction = await extractPdfWithFallback(buf, {
        fileName: originalName,
        fileSizeBytes: sizeBytes ?? buf.length,
        allowOcr: true,
        ocrStrategy: "ocr_first",
        onProgress: async (progress: PdfExtractionProgress) => {
          if (progress.stage === "ocr_started") {
            logUploadStage(requestId, "ocr_started", {
              jobId,
              fileId,
              pageCount: progress.totalPages,
              ocrCandidatePages: progress.ocrCandidatePages,
              scanLikeDocument: progress.scanLikeDocument,
              documentClass: progress.documentClass,
              processingRoute: progress.ocrStrategy,
            });
            await updatePdfJobStage({
              admin,
              jobId,
              requestId,
              folderId,
              fileName: originalName,
              mimeType,
              sizeBytes,
              md5,
              fileId,
              storagePath,
              pageCount: progress.totalPages,
                stage: "ocr_started",
                extraPayload: {
                  ocr_candidate_pages: progress.ocrCandidatePages,
                  scan_like_document: progress.scanLikeDocument,
                  document_class: progress.documentClass,
                  processing_route: progress.ocrStrategy,
                  phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
                },
              });
          }

          if (progress.stage === "ocr_finished") {
            logUploadStage(requestId, "ocr_finished", {
              jobId,
              fileId,
              pageCount: progress.totalPages,
              ocrCandidatePages: progress.ocrCandidatePages,
              documentClass: progress.documentClass,
              processingRoute: progress.ocrStrategy,
            });
            await updatePdfJobStage({
              admin,
              jobId,
              requestId,
              folderId,
              fileName: originalName,
              mimeType,
              sizeBytes,
              md5,
              fileId,
              storagePath,
              pageCount: progress.totalPages,
                stage: "ocr_finished",
                extraPayload: {
                  ocr_candidate_pages: progress.ocrCandidatePages,
                  scan_like_document: progress.scanLikeDocument,
                  document_class: progress.documentClass,
                  processing_route: progress.ocrStrategy,
                  phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
                },
              });
          }
        },
      });
      mergeExtractionTimings(phaseTimings, extraction);
      phaseTimings.document_class = String(extraction.extractionMeta.document_class ?? "").trim() || phaseTimings.document_class;
      phaseTimings.processing_route =
        String(extraction.extractionMeta.extraction_route ?? "").trim() || phaseTimings.processing_route;
      logUploadStage(requestId, "pdf_extract_finished", {
        jobId,
        fileId,
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        documentClass: extraction.extractionMeta.document_class,
        processingRoute: extraction.extractionMeta.extraction_route,
        phase: ocrRoute,
      });
      await persistExtraction(extraction, "first_processing", {
        fast_path_candidate: false,
        deep_processing_needed: false,
        document_class: extraction.extractionMeta.document_class,
        processing_route: extraction.extractionMeta.extraction_route,
        phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
      });

      if (isPdfTextInsufficientAfterExtraction(extraction)) {
        const failureReason = getPdfUnreadableFailureReason(extraction);
        const failureMessage = getPdfUnreadableMessage(extraction);
        logUploadStage(requestId, "pdf_text_unreadable", {
          jobId,
          fileId,
          pageCount: extraction.pageCount,
          ocrPages: extraction.ocrPages,
          extractionMethod: extraction.extractionMethod,
          failureReason,
        });
        return await failBeforeReady(failureMessage, failureReason, extraction);
      }

      const chunkBuild = await buildChunksAndSync(extraction, {
        document_class: extraction.extractionMeta.document_class,
        processing_route: extraction.extractionMeta.extraction_route,
      });
      const quotaResult = await ensureQuota(extraction.pageCount, chunkBuild.chunkCount, extraction);
      if (!quotaResult.ok) return quotaResult.failure;

      return await finalizeSuccess({
        extraction,
        chunkCount: chunkBuild.chunkCount,
        extraMeta: {
          fast_path: false,
          deep_path_completed: true,
          document_class: extraction.extractionMeta.document_class,
          processing_route: extraction.extractionMeta.extraction_route,
        },
      });
    }

    const fastChunkBuild = await buildChunksAndSync(fastExtraction, {
      document_class: fastExtraction.extractionMeta.document_class,
      processing_route: fastExtraction.extractionMeta.extraction_route,
    });
    const quotaResult = await ensureQuota(fastExtraction.pageCount, fastChunkBuild.chunkCount, fastExtraction);
    if (!quotaResult.ok) return quotaResult.failure;

    const firstReadyAt = new Date().toISOString();
    const deepProcessingNeeded = shouldRunPdfDeepProcessing(fastExtraction);
    await persistExtraction(fastExtraction, "first_ready", {
      fast_path: true,
      first_ready_at: firstReadyAt,
      deep_processing_needed: deepProcessingNeeded,
      document_class: fastExtraction.extractionMeta.document_class,
      processing_route: fastExtraction.extractionMeta.extraction_route,
      phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
    });
    await updatePdfJobStage({
      admin,
      jobId,
      requestId,
      folderId,
      fileName: originalName,
      mimeType,
      sizeBytes,
      md5,
      fileId,
      storagePath,
      pageCount: fastExtraction.pageCount,
      ocrPages: fastExtraction.ocrPages,
      extractionMethod: fastExtraction.extractionMethod,
      extractionQuality: fastExtraction.extractionQuality,
      chunkCount: fastChunkBuild.chunkCount,
      stage: "first_ready",
      extraPayload: {
        fast_path: true,
        first_ready_at: firstReadyAt,
        deep_processing_needed: deepProcessingNeeded,
        document_class: fastExtraction.extractionMeta.document_class,
        processing_route: fastExtraction.extractionMeta.extraction_route,
        phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
      },
    });
    logUploadStage(requestId, "first_ready", {
      jobId,
      fileId,
      pageCount: fastExtraction.pageCount,
      chunkCount: fastChunkBuild.chunkCount,
    });

    return await finalizeSuccess({
      extraction: fastExtraction,
      chunkCount: fastChunkBuild.chunkCount,
      jobStage: "first_ready",
      processingStatus: "first_ready",
      extraMeta: {
        fast_path: true,
        first_ready_at: firstReadyAt,
        deep_processing_needed: deepProcessingNeeded,
        deep_path_completed: false,
        document_class: fastExtraction.extractionMeta.document_class,
        processing_route: fastExtraction.extractionMeta.extraction_route,
      },
    });
  } catch (e: any) {
    phaseTimings.final_status = "failed";
    phaseTimings.total_ms = elapsedMs(requestStartedAtMs);
    const failurePayload = {
      ...buildJobTrackingPayload({
        requestId,
        folderId,
        fileName: originalName,
        mimeType,
        uploadKind: "pdf",
        sizeBytes,
        md5,
        fileId,
        storagePath,
        pageCount: effectivePages,
        stage: "failed",
      }),
      failure_reason: String(e?.code ?? "processing_failed"),
      phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
    };
    await safeUpdateFileRecord(admin, fileId, {
      extraction_meta: {
        input_kind: "pdf",
        processing_status: "failed",
        request_id: requestId,
        failure_reason: String(e?.code ?? "processing_failed"),
        phase_timings: buildPdfPhaseTimingsPayload(phaseTimings),
      },
    });
    await safeUpdateJob(admin, jobId, {
      status: "failed",
      file_id: fileId,
      finished_at: new Date().toISOString(),
      error: { message: e?.message ?? "PDF-behandling fejlede." },
      payload: failurePayload,
      meta: failurePayload,
    });
    console.info("[trainer/upload] pdf phase timings", {
      requestId,
      jobId,
      fileId,
      ...buildPdfPhaseTimingsPayload(phaseTimings),
    });
    try {
      await purgeFileArtifacts(admin, { ownerId, fileId, storagePath, fileMd5: md5 });
    } catch (purgeError) {
      console.warn("[trainer/upload] purge after accepted pdf failure warning:", {
        fileId,
        ownerId,
        error: errInfo(purgeError),
      });
    }
    console.error("[trainer/upload] accepted pdf processing error:", errInfo(e));
    return {
      ok: false,
      stage: "failed",
      jobStatus: "failed",
      processing: false,
      ready: false,
      failureMessage: e?.message ?? "PDF-behandling fejlede.",
      pageCount: effectivePages,
      chunkCount: null,
    };
  }
}

async function ensureTrainerImportJob(args: {
  admin: any;
  ownerId: string;
  requestId: string;
  folderId: string;
  originalName: string;
  mimeType: string;
  uploadKind: "pdf" | "audio" | "other";
  sizeBytes: number | null;
}) {
  const { admin, ownerId, requestId, folderId, originalName, mimeType, uploadKind, sizeBytes } = args;
  let jobId: string | null = null;

  try {
    const jobQueuedAt = new Date().toISOString();
    const jobRowId = randomUUID();
    const jobTracking = {
      source: "trainer_upload",
      request_id: requestId,
      folder_id: folderId,
      file_name: originalName,
      mime_type: mimeType,
      upload_kind: uploadKind,
      size_bytes: sizeBytes,
      stage: "queued",
    };
    console.info("[trainer/upload] job create payload", {
      requestId,
      ownerId,
      kind: "import",
      status: "queued",
      payload: jobTracking,
      meta: jobTracking,
    });
    const jobInsert = await tryInsertJob(admin, [
      {
        label: "full_payload_meta_result_error",
        row: {
          id: jobRowId,
          owner_id: ownerId,
          kind: "import",
          status: "queued",
          queued_at: jobQueuedAt,
          payload: jobTracking,
          meta: jobTracking,
          result: null,
          error: null,
        },
      },
      {
        label: "payload_meta_only",
        row: {
          id: jobRowId,
          owner_id: ownerId,
          kind: "import",
          status: "queued",
          queued_at: jobQueuedAt,
          payload: jobTracking,
          meta: jobTracking,
        },
      },
      {
        label: "payload_only",
        row: {
          id: jobRowId,
          owner_id: ownerId,
          kind: "import",
          status: "queued",
          queued_at: jobQueuedAt,
          payload: jobTracking,
        },
      },
      {
        label: "meta_only",
        row: {
          id: jobRowId,
          owner_id: ownerId,
          kind: "import",
          status: "queued",
          queued_at: jobQueuedAt,
          meta: jobTracking,
        },
      },
      {
        label: "minimal_without_payload",
        row: {
          id: jobRowId,
          owner_id: ownerId,
          kind: "import",
          status: "queued",
          queued_at: jobQueuedAt,
        },
      },
    ]);

    if (jobInsert.ok && jobInsert.id) {
      jobId = String(jobInsert.id);
      logUploadStage(requestId, "job_created", { jobId, strategy: jobInsert.label });
    } else {
      const lookup = await admin
        .from("jobs")
        .select("id,payload,meta,queued_at")
        .eq("owner_id", ownerId)
        .eq("kind", "import")
        .gte("queued_at", new Date(new Date(jobQueuedAt).getTime() - 5000).toISOString())
        .lte("queued_at", new Date(new Date(jobQueuedAt).getTime() + 5000).toISOString())
        .order("queued_at", { ascending: false, nullsFirst: false })
        .limit(25);

      if (!lookup.error && Array.isArray(lookup.data)) {
        const matched = lookup.data.find((row: any) => {
          const payloadRequestId = String(row?.payload?.request_id ?? "").trim();
          const metaRequestId = String(row?.meta?.request_id ?? "").trim();
          return payloadRequestId === requestId || metaRequestId === requestId;
        });
        if (matched?.id) {
          jobId = String(matched.id);
          logUploadStage(requestId, "job_linked_from_lookup", { jobId });
        } else if (lookup.data.length === 1 && (lookup.data[0] as any)?.id) {
          jobId = String((lookup.data[0] as any).id);
          logUploadStage(requestId, "job_linked_from_time_window", { jobId });
          await safeUpdateJob(admin, jobId, {
            payload: jobTracking,
            meta: jobTracking,
          });
        }
      }

      if (!jobId) {
        console.warn("[trainer/upload] job create warning:", errInfo(jobInsert.error));
      }
    }
    await safeUpdateJob(admin, jobId, {
      status: "queued",
      payload: jobTracking,
      meta: jobTracking,
    });
  } catch (jobCreateError) {
    console.warn("[trainer/upload] job create warning:", errInfo(jobCreateError));
  }

  return jobId;
}

async function finalizeAcceptedPdfUpload(args: {
  admin: any;
  requestId: string;
  jobId: string | null;
  ownerId: string;
  folderId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number | null;
  md5: string;
  buf: Buffer;
  fileId: string;
  storagePath: string;
  effectivePages: number;
  quotaResetAt: string;
  requestStartedAtMs: number;
  initialTimings?: PdfUploadPhaseTimings;
}) {
  const {
    admin,
    requestId,
    jobId,
    ownerId,
    folderId,
    originalName,
    mimeType,
    sizeBytes,
    md5,
    buf,
    fileId,
    storagePath,
    effectivePages,
    quotaResetAt,
    requestStartedAtMs,
    initialTimings,
  } = args;

  const uploadedAt = new Date().toISOString();
  const placeholderExtractionMeta = {
    input_kind: "pdf",
    processing_status: "queued",
    request_id: requestId,
  };
  const insertAttempts = [
    {
      label: "pdf_processing_full",
      row: {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        original_name: originalName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
        page_count: effectivePages,
        ocr_pages: 0,
        extraction_method: null,
        extraction_quality: null,
        extraction_meta: placeholderExtractionMeta,
      },
    },
    {
      label: "pdf_processing_compact",
      row: {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        original_name: originalName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
        page_count: effectivePages,
        extraction_meta: placeholderExtractionMeta,
      },
    },
    {
      label: "pdf_processing_legacy",
      row: {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        original_name: originalName,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
      },
    },
  ];

  const ins = await tryInsertFile(admin, insertAttempts);
  if (!ins.ok) {
    console.error("[trainer/upload] files insert error:", errInfo(ins.error));
    try {
      await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    } catch {}
    return NextResponse.json({ ok: false, error: "Kunne ikke gemme fil i databasen.", requestId }, { status: 500 });
  }

  await safeUpdateJob(admin, jobId, {
    status: "queued",
    file_id: fileId,
    payload: buildJobTrackingPayload({
      requestId,
      folderId,
      fileName: originalName,
      mimeType,
      uploadKind: "pdf",
      sizeBytes,
      md5,
      fileId,
      storagePath,
      pageCount: effectivePages,
      stage: "storage_upload_finished",
    }),
    meta: buildJobTrackingPayload({
      requestId,
      folderId,
      fileName: originalName,
      mimeType,
      uploadKind: "pdf",
      sizeBytes,
      md5,
      fileId,
      storagePath,
      pageCount: effectivePages,
      stage: "storage_upload_finished",
    }),
  });
  logUploadStage(requestId, "response_ready", {
    jobId,
    fileId,
    uploadKind: "pdf",
    pages: effectivePages,
    accepted: true,
  });
  const processingResult = await processAcceptedPdfUpload({
    requestId,
    jobId,
    ownerId,
    folderId,
    originalName,
    mimeType,
    sizeBytes,
    md5,
    buf,
    fileId,
    storagePath,
    effectivePages,
    quotaResetAt,
    requestStartedAtMs,
    initialTimings,
  });

  if (!processingResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        accepted: false,
        processing: false,
        requestId,
        jobId,
        fileId,
        folderId,
        uploadKind: "pdf",
        pages: processingResult.pageCount || effectivePages,
        chunkCount: processingResult.chunkCount,
        stage: processingResult.stage,
        jobStatus: processingResult.jobStatus,
        message: processingResult.failureMessage ?? "PDF-behandling fejlede.",
        error: processingResult.failureMessage ?? "PDF-behandling fejlede.",
        storage: { bucket: UPLOAD_BUCKET, path: storagePath },
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      accepted: true,
      processing: processingResult.processing,
      requestId,
      jobId,
      fileId,
      folderId,
      uploadKind: "pdf",
      pages: processingResult.pageCount || effectivePages,
      chunkCount: processingResult.chunkCount,
      stage: processingResult.stage,
      jobStatus: processingResult.jobStatus,
      storage: { bucket: UPLOAD_BUCKET, path: storagePath },
    },
    { status: processingResult.processing ? 202 : 200 },
  );
}

async function handleDirectPdfUploadComplete(args: {
  admin: any;
  ownerId: string;
  requestId: string;
  body: any;
}) {
  const { admin, ownerId, requestId, body } = args;
  const requestStartedAtMs = nowMs();

  const folderId = String(body?.folder_id ?? body?.folderId ?? "").trim() || null;
  const originalName = stripPathy(String(body?.file_name ?? body?.fileName ?? "upload.pdf"));
  const mimeType = String(body?.mime_type ?? body?.mimeType ?? "application/pdf").trim() || "application/pdf";
  const sizeBytes = typeof body?.size_bytes === "number" ? Number(body.size_bytes) : typeof body?.sizeBytes === "number" ? Number(body.sizeBytes) : null;
  const storagePath = String(body?.storage_path ?? body?.storagePath ?? "").trim();
  const fileId = String(body?.file_id ?? body?.fileId ?? "").trim();
  const uploadKind = detectUploadKind({ name: originalName, type: mimeType } as File, originalName);

  if (!folderId) return NextResponse.json({ ok: false, error: "Manglende folder_id.", requestId }, { status: 400 });
  if (!storagePath || !fileId) {
    return NextResponse.json({ ok: false, error: "Manglende storage-reference.", requestId }, { status: 400 });
  }
  if (uploadKind !== "pdf") {
    return NextResponse.json({ ok: false, error: "Direct upload understøtter kun PDF lige nu.", requestId }, { status: 400 });
  }
  if (sizeBytes != null && sizeBytes > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: "FILE_TOO_LARGE",
          error: "Filen er større end 25 MB. Prøv at komprimere PDF’en eller del den i to filer.",
        requestId,
      },
      { status: 413 },
    );
  }

  const expectedPrefix = `${ownerId}/${folderId}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    return NextResponse.json({ ok: false, error: "Ugyldig storage_path for valgt mappe.", requestId }, { status: 400 });
  }
  if (!storagePath.includes(fileId)) {
    return NextResponse.json({ ok: false, error: "Ugyldig file_id for storage_path.", requestId }, { status: 400 });
  }

  const { data: folderRow, error: folderErr } = await admin
    .from("folders")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("id", folderId)
    .is("archived_at", null)
    .maybeSingle();

  if (folderErr) console.error("[trainer/upload] folder lookup error:", errInfo(folderErr));
  if (!folderRow) return NextResponse.json({ ok: false, error: "Ugyldig mappe (folder_id).", requestId }, { status: 400 });

  const storageDownloadStartedAt = nowMs();
  const dl = await admin.storage.from(UPLOAD_BUCKET).download(storagePath);
  const storageDownloadMs = elapsedMs(storageDownloadStartedAt);
  if (dl.error || !dl.data) {
    console.error("[trainer/upload] direct storage download error:", errInfo(dl.error));
    return NextResponse.json({ ok: false, error: "Kunne ikke læse den uploadede fil fra storage.", requestId }, { status: 500 });
  }

  const buf = Buffer.from(await dl.data.arrayBuffer());
  const md5 = createHash("md5").update(buf).digest("hex");
  const { removedIds: orphanedDuplicateIds } = await purgeInactiveDuplicateFiles(admin, { ownerId, md5 });
  if (orphanedDuplicateIds.length > 0) {
    console.warn("[trainer/upload] purged inactive duplicate rows before insert:", {
      ownerId,
      md5,
      removedIds: orphanedDuplicateIds,
    });
  }

  const { duplicate: existing, error: existingErr } = await findActiveDuplicateUpload(admin, { ownerId, md5 });
  if (existingErr) console.error("[trainer/upload] duplicate lookup error:", errInfo(existingErr));
  if (existing?.id) {
    const existingStoragePath = String(existing.storage_path ?? "").trim();
    const storageStillExists = existingStoragePath ? await uploadStorageObjectExists(admin, existingStoragePath) : false;
    if (storageStillExists) {
      try {
        await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
      } catch {}
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

    await purgeFileArtifacts(admin, {
      ownerId,
      fileId: String(existing.id),
      storagePath: existingStoragePath,
      fileMd5: md5,
    });
  }

  let effectivePages = 0;
  try {
    effectivePages = await countPdfPagesQuick(buf);
  } catch (e) {
    const extractionError = errInfo(e);
    console.error("[trainer/upload] pdf page count error", {
      requestId,
      filename: originalName,
      contentType: mimeType || null,
      size: sizeBytes ?? buf.length,
      errorMessage: extractionError.message ?? "Unknown error",
    });
    try {
      await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    } catch {}
    return NextResponse.json(
      {
        ok: false,
        code: "PDF_UNREADABLE",
        error: "PDF kunne ikke læses.",
        requestId,
      },
      { status: 400 },
    );
  }

  if (!effectivePages || effectivePages < 1) {
    try {
      await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    } catch {}
    return NextResponse.json(
      { ok: false, code: "PDF_NO_PAGES", error: "PDF har ingen sider.", requestId },
      { status: 400 },
    );
  }

  if (effectivePages > MAX_PDF_PAGES) {
    try {
      await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    } catch {}
    return buildPdfTooManyPagesResponse({ requestId, pages: effectivePages });
  }

  const planInfo = await getUploadPlan(admin, ownerId);
  if (!planInfo.resolved) {
    console.warn("[trainer/upload] skipping freemium page gate because plan lookup was not resolved", {
      ownerId,
      requestId,
      rawPlan: planInfo.rawPlan,
      normalizedPlan: planInfo.plan,
      effectivePages,
    });
  }
  if (planInfo.resolved && planInfo.plan === "freemium" && effectivePages > FREEMIUM_PDF_PAGE_LIMIT) {
    try {
      await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    } catch {}
    return NextResponse.json(
      {
        ok: false,
        code: "FILE_TOO_LONG",
        message: `Denne PDF har ${effectivePages} sider, men Freemium-planen tillader maks. ${FREEMIUM_PDF_PAGE_LIMIT} sider pr. fil.`,
        pages: effectivePages,
        pageLimit: FREEMIUM_PDF_PAGE_LIMIT,
        plan: planInfo.plan,
        requestId,
      },
      { status: 413 },
    );
  }

  let quotaBefore;
  try {
    quotaBefore = await getImportQuotaSnapshot({ admin, ownerId });
  } catch (e) {
    console.error("[trainer/upload] import quota snapshot error:", errInfo(e));
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

  if (quotaBefore.monthlyLimit != null && quotaBefore.usedThisMonth + effectivePages > quotaBefore.monthlyLimit) {
    try {
      await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    } catch {}
    return buildQuotaExceededResponse({
      requestId,
      pages: effectivePages,
      usedThisMonth: quotaBefore.usedThisMonth,
      monthlyLimit: quotaBefore.monthlyLimit,
      resetAt: quotaBefore.resetAt,
    });
  }

  const jobId = await ensureTrainerImportJob({
    admin,
    ownerId,
    requestId,
    folderId,
    originalName,
    mimeType,
    uploadKind: "pdf",
    sizeBytes: sizeBytes ?? buf.length,
  });

  logUploadStage(requestId, "file_buffered", { jobId, bytes: buf.length, md5, storagePath, directUpload: true });
  await safeUpdateJob(admin, jobId, {
    payload: {
      source: "trainer_upload",
      request_id: requestId,
      folder_id: folderId,
      file_name: originalName,
      mime_type: mimeType,
      upload_kind: "pdf",
      size_bytes: sizeBytes ?? buf.length,
      md5,
      file_id: fileId,
      storage_path: storagePath,
      stage: "file_buffered",
    },
  });

  logUploadStage(requestId, "storage_upload_finished", { jobId, fileId, storagePath, directUpload: true });
  return finalizeAcceptedPdfUpload({
    admin,
    requestId,
    jobId,
    ownerId,
    folderId,
    originalName,
    mimeType,
    sizeBytes: sizeBytes ?? buf.length,
    md5,
    buf,
    fileId,
    storagePath,
    effectivePages,
    quotaResetAt: quotaBefore.resetAt,
    requestStartedAtMs,
    initialTimings: {
      storage_download_ms: storageDownloadMs,
      page_count: effectivePages,
    },
  });
}

export async function POST(req: NextRequest) {
  const fallbackRequestId = randomUUID();
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
  const requestStartedAtMs = nowMs();
  let requestId: string = fallbackRequestId;
  let jobId: string | null = null;

  let ownerId = "";
  try {
    const sb = resolveUploadAuthClient(req);
    const { data: authData, error: authError } = await sb.auth.getUser();
    const getUserError = authError?.message ?? null;
    ownerId = authData?.user?.id ? String(authData.user.id) : "";

    if (!ownerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
          requestId,
          ...(process.env.VERCEL_ENV === "preview"
            ? {
                debug: {
                  hasSession: null,
                  sessionUserId: null,
                  sessionError: null,
                  getUserError,
                  cookieNames,
                },
              }
            : {}),
        },
        { status: 401 },
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
        requestId,
        ...(process.env.VERCEL_ENV === "preview"
          ? {
              debug: {
                hasSession: null,
                sessionUserId: null,
                sessionError: error?.message ?? null,
                getUserError: null,
                cookieNames,
              },
            }
          : {}),
      },
      { status: 401 },
    );
  }

  let admin: any;
  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Server config mangler.", requestId }, { status: 500 });
  }

  try {
    const contentType = String(req.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);
      requestId = String(body?.request_id ?? body?.requestId ?? fallbackRequestId).trim() || fallbackRequestId;
      logUploadStage(requestId, "upload_started", { cookieCount: cookieNames.length, mode: "storage_complete" });
      await ensureProfile(admin, ownerId);
      return await handleDirectPdfUploadComplete({ admin, ownerId, requestId, body });
    }

    const form = await req.formData();

    requestId = String(form.get("request_id") ?? form.get("requestId") ?? fallbackRequestId).trim() || fallbackRequestId;
    logUploadStage(requestId, "upload_started", { cookieCount: cookieNames.length });

    await ensureProfile(admin, ownerId);

    const folderId = String(form.get("folder_id") ?? form.get("folderId") ?? form.get("folder") ?? "").trim() || null;
    const file = form.get("file") as unknown as File | null;

    if (!folderId) return NextResponse.json({ ok: false, error: "Manglende folder_id.", requestId }, { status: 400 });
    if (!file) return NextResponse.json({ ok: false, error: "Manglende fil.", requestId }, { status: 400 });

    const originalName = stripPathy(file.name || "upload");
    const mimeType = String((file as any).type || "application/octet-stream") || "application/octet-stream";
    const uploadKind = detectUploadKind(file, originalName);

    if ((file as any).size != null && Number((file as any).size) > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          code: "FILE_TOO_LARGE",
          error:
            uploadKind === "pdf"
              ? "Filen er større end 25 MB. Prøv at komprimere PDF’en eller del den i to filer."
              : `Filen er for stor. Maks. ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB pr. fil.`,
          requestId,
        },
        { status: 413 },
      );
    }

    // folder ownership (samme tabel som /api/folders typisk bruger)
    const { data: folderRow, error: folderErr } = await admin
      .from("folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("id", folderId)
      .is("archived_at", null)
      .maybeSingle();

    if (folderErr) console.error("[trainer/upload] folder lookup error:", errInfo(folderErr));
    if (!folderRow)
      return NextResponse.json({ ok: false, error: "Ugyldig mappe (folder_id).", requestId }, { status: 400 });

    if (uploadKind === "other") {
      return NextResponse.json(
        { ok: false, error: "Filtypen understøttes ikke endnu. Upload PDF eller lydfil.", requestId },
        { status: 400 },
      );
    }

    logUploadStage(requestId, "validation_passed", {
      ownerId,
      folderId,
      fileName: originalName,
      uploadKind,
      sizeBytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
    });

    jobId = await ensureTrainerImportJob({
      admin,
      ownerId,
      requestId,
      folderId,
      originalName,
      mimeType,
      uploadKind,
      sizeBytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
    });

    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const md5 = createHash("md5").update(buf).digest("hex");
    logUploadStage(requestId, "file_buffered", { jobId, bytes: buf.length, md5 });
    await safeUpdateJob(admin, jobId, {
      payload: {
        source: "trainer_upload",
        request_id: requestId,
        folder_id: folderId,
        file_name: originalName,
        mime_type: mimeType,
        upload_kind: uploadKind,
        size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
        md5,
        stage: "file_buffered",
      },
    });

    const { removedIds: orphanedDuplicateIds } = await purgeInactiveDuplicateFiles(admin, { ownerId, md5 });
    if (orphanedDuplicateIds.length > 0) {
      console.warn("[trainer/upload] purged inactive duplicate rows before insert:", {
        ownerId,
        md5,
        removedIds: orphanedDuplicateIds,
      });
    }

    // duplicate check (før quota)
    const { duplicate: existing, error: existingErr } = await findActiveDuplicateUpload(admin, { ownerId, md5 });
    if (existingErr) console.error("[trainer/upload] duplicate lookup error:", errInfo(existingErr));
    if (existing?.id) {
      const existingStoragePath = String(existing.storage_path ?? "").trim();
      const storageStillExists = existingStoragePath
        ? await uploadStorageObjectExists(admin, existingStoragePath)
        : false;

      if (storageStillExists) {
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

      console.warn("[trainer/upload] removing stale duplicate row before re-upload:", {
        ownerId,
        existingFileId: existing.id,
        storagePath: existingStoragePath || null,
      });
      await purgeFileArtifacts(admin, {
        ownerId,
        fileId: String(existing.id),
        storagePath: existingStoragePath,
        fileMd5: md5,
      });
    }

    const processingUploadKind = uploadKind;

    if (uploadKind === "pdf") {
      let effectivePages = 0;
      try {
        effectivePages = await countPdfPagesQuick(buf);
      } catch (e) {
        const extractionError = errInfo(e);
        console.error("[trainer/upload] pdf page count error", {
          requestId,
          filename: originalName,
          contentType: mimeType || null,
          size: typeof file.size === "number" ? file.size : buf.length,
          errorMessage: extractionError.message ?? "Unknown error",
        });
        return NextResponse.json(
          {
            ok: false,
            code: "PDF_UNREADABLE",
            error: "PDF kunne ikke læses.",
            requestId,
          },
          { status: 400 },
        );
      }

      if (!effectivePages || effectivePages < 1) {
        return NextResponse.json(
          { ok: false, code: "PDF_NO_PAGES", error: "PDF har ingen sider.", requestId },
          { status: 400 },
        );
      }

      if (effectivePages > MAX_PDF_PAGES) {
        return buildPdfTooManyPagesResponse({ requestId, pages: effectivePages });
      }

      const planInfo = await getUploadPlan(admin, ownerId);
      if (!planInfo.resolved) {
        console.warn("[trainer/upload] skipping freemium page gate because plan lookup was not resolved", {
          ownerId,
          requestId,
          rawPlan: planInfo.rawPlan,
          normalizedPlan: planInfo.plan,
          effectivePages,
        });
      }
      if (planInfo.resolved && planInfo.plan === "freemium" && effectivePages > FREEMIUM_PDF_PAGE_LIMIT) {
        return NextResponse.json(
          {
            ok: false,
            code: "FILE_TOO_LONG",
            message: `Denne PDF har ${effectivePages} sider, men Freemium-planen tillader maks. ${FREEMIUM_PDF_PAGE_LIMIT} sider pr. fil.`,
            pages: effectivePages,
            pageLimit: FREEMIUM_PDF_PAGE_LIMIT,
            plan: planInfo.plan,
            requestId,
          },
          { status: 413 },
        );
      }

      let quotaBefore;
      try {
        quotaBefore = await getImportQuotaSnapshot({ admin, ownerId });
      } catch (e) {
        console.error("[trainer/upload] import quota snapshot error:", errInfo(e));
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

      if (quotaBefore.monthlyLimit != null && quotaBefore.usedThisMonth + effectivePages > quotaBefore.monthlyLimit) {
        return buildQuotaExceededResponse({
          requestId,
          pages: effectivePages,
          usedThisMonth: quotaBefore.usedThisMonth,
          monthlyLimit: quotaBefore.monthlyLimit,
          resetAt: quotaBefore.resetAt,
        });
      }

      const fileId = randomUUID();
      const fileExt = getFileExtension(originalName);
      const storagePath = `${ownerId}/${folderId}/${fileId}${fileExt || ".pdf"}`;

      logUploadStage(requestId, "storage_upload_started", { jobId, fileId, storagePath });
      await safeUpdateJob(admin, jobId, {
        payload: buildJobTrackingPayload({
          requestId,
          folderId,
          fileName: originalName,
          mimeType,
          uploadKind,
          sizeBytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
          md5,
          fileId,
          storagePath,
          pageCount: effectivePages,
          stage: "storage_upload_started",
        }),
        meta: buildJobTrackingPayload({
          requestId,
          folderId,
          fileName: originalName,
          mimeType,
          uploadKind,
          sizeBytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
          md5,
          fileId,
          storagePath,
          pageCount: effectivePages,
          stage: "storage_upload_started",
        }),
      });

      const up = await admin.storage.from(UPLOAD_BUCKET).upload(storagePath, buf, {
        contentType: mimeType || "application/pdf",
        upsert: false,
      });

      if (up.error) {
        console.error("[trainer/upload] storage upload error:", errInfo(up.error));
        return NextResponse.json({ ok: false, error: "Kunne ikke uploade filen til storage.", requestId }, { status: 500 });
      }

      logUploadStage(requestId, "storage_upload_finished", { jobId, fileId, storagePath });
      return finalizeAcceptedPdfUpload({
        admin,
        requestId,
        jobId,
        ownerId,
        folderId,
        originalName,
        mimeType,
        sizeBytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
        md5,
        buf,
        fileId,
        storagePath,
        effectivePages,
        quotaResetAt: quotaBefore.resetAt,
        requestStartedAtMs,
      });
    }

    let extraction: Awaited<ReturnType<typeof extractPdfWithFallback>> | null = null;
    let transcriptText = "";

    if (processingUploadKind === "pdf") {
      logUploadStage(requestId, "pdf_extract_started", { jobId, fileName: originalName });
      await safeUpdateJob(admin, jobId, {
        payload: {
          source: "trainer_upload",
          request_id: requestId,
          folder_id: folderId,
          file_name: originalName,
          mime_type: mimeType,
          upload_kind: processingUploadKind,
          size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
          md5,
          stage: "pdf_extract_started",
        },
      });
      try {
        extraction = await extractPdfWithFallback(buf, {
          fileName: originalName,
          fileSizeBytes: typeof (file as any).size === "number" ? Number((file as any).size) : buf.length,
          onProgress: async (progress: PdfExtractionProgress) => {
            if (progress.stage === "ocr_started") {
              logUploadStage(requestId, "ocr_started", {
                jobId,
                pageCount: progress.totalPages,
                ocrCandidatePages: progress.ocrCandidatePages,
                scanLikeDocument: progress.scanLikeDocument,
                documentClass: progress.documentClass,
                processingRoute: progress.ocrStrategy,
              });
              await safeUpdateJob(admin, jobId, {
                payload: {
                  source: "trainer_upload",
                  request_id: requestId,
                  folder_id: folderId,
                  file_name: originalName,
                  mime_type: mimeType,
                  upload_kind: processingUploadKind,
                  size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
                  md5,
                  stage: "ocr_started",
                  scan_like_document: progress.scanLikeDocument,
                  ocr_candidate_pages: progress.ocrCandidatePages,
                  document_class: progress.documentClass,
                  processing_route: progress.ocrStrategy,
                },
              });
            }

            if (progress.stage === "ocr_finished") {
              logUploadStage(requestId, "ocr_finished", {
                jobId,
                pageCount: progress.totalPages,
                ocrCandidatePages: progress.ocrCandidatePages,
                documentClass: progress.documentClass,
                processingRoute: progress.ocrStrategy,
              });
              await safeUpdateJob(admin, jobId, {
                payload: {
                  source: "trainer_upload",
                  request_id: requestId,
                  folder_id: folderId,
                  file_name: originalName,
                  mime_type: mimeType,
                  upload_kind: processingUploadKind,
                  size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
                  md5,
                  stage: "ocr_finished",
                  scan_like_document: progress.scanLikeDocument,
                  ocr_candidate_pages: progress.ocrCandidatePages,
                  document_class: progress.documentClass,
                  processing_route: progress.ocrStrategy,
                },
              });
            }
          },
        });
      } catch (e) {
        const extractionError = errInfo(e);
        const pdfDebug = {
          requestId,
          filename: originalName,
          contentType: mimeType || null,
          size: typeof file.size === "number" ? file.size : buf.length,
          errorMessage: extractionError.message ?? "Unknown error",
          errorCode: extractionError.code ?? null,
          stage: "pdf_extract" as const,
        };
        console.error("[trainer/upload] pdf extract error", pdfDebug, extractionError);
        return NextResponse.json(
          {
            ok: false,
            code: "PDF_UNREADABLE",
            error: "PDF kunne ikke læses.",
            requestId,
            ...(process.env.VERCEL_ENV ? { debug: pdfDebug } : {}),
          },
          { status: 400 },
        );
      }

      logUploadStage(requestId, "pdf_extract_finished", {
        jobId,
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
      });
      await safeUpdateJob(admin, jobId, {
        payload: {
          source: "trainer_upload",
          request_id: requestId,
          folder_id: folderId,
          file_name: originalName,
          mime_type: mimeType,
          upload_kind: processingUploadKind,
          size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
          md5,
          stage: "pdf_extract_finished",
          page_count: extraction.pageCount,
          ocr_pages: extraction.ocrPages,
          extraction_method: extraction.extractionMethod,
        },
      });

      if (isPdfTextInsufficientAfterExtraction(extraction)) {
        const failureReason = getPdfUnreadableFailureReason(extraction);
        const failureMessage = getPdfUnreadableMessage(extraction);
        logUploadStage(requestId, "pdf_text_unreadable", {
          jobId,
          pageCount: extraction.pageCount,
          ocrPages: extraction.ocrPages,
          extractionMethod: extraction.extractionMethod,
          failureReason,
        });
        await safeUpdateJob(admin, jobId, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: { message: failureMessage },
          payload: {
            source: "trainer_upload",
            request_id: requestId,
            folder_id: folderId,
            file_name: originalName,
            mime_type: mimeType,
            upload_kind: processingUploadKind,
            size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
            md5,
            stage: "failed",
            page_count: extraction.pageCount,
            ocr_pages: extraction.ocrPages,
            extraction_method: extraction.extractionMethod,
            extraction_quality: extraction.extractionQuality,
            failure_reason: failureReason,
          },
        });
        return NextResponse.json(
          {
            ok: false,
            code: "PDF_TEXT_UNREADABLE",
            error: failureMessage,
            requestId,
          },
          { status: 422 },
        );
      }

      if (!extraction.pageCount || extraction.pageCount < 1) {
        return NextResponse.json(
          { ok: false, code: "PDF_NO_PAGES", error: "PDF har ingen sider.", requestId },
          { status: 400 },
        );
      }
    } else {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
          { ok: false, error: "OPENAI_API_KEY mangler i .env.local.", requestId },
          { status: 500 },
        );
      }

      const transcribeModel = resolveModelForFeature("transcribe");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const transcript = await openai.audio.transcriptions.create({
        file,
        model: transcribeModel,
        language: "da",
      });
      transcriptText = String((transcript as any)?.text ?? "").trim();

      if (!transcriptText) {
        return NextResponse.json(
          { ok: false, error: "Kunne ikke udtrække afskrift fra lydfilen.", requestId },
          { status: 422 },
        );
      }
    }

    const effectivePages = processingUploadKind === "audio" ? 1 : extraction!.pageCount;

    const planInfo = await getUploadPlan(admin, ownerId);
    if (!planInfo.resolved) {
      console.warn("[trainer/upload] skipping freemium page gate because plan lookup was not resolved", {
        ownerId,
        requestId,
        rawPlan: planInfo.rawPlan,
        normalizedPlan: planInfo.plan,
        effectivePages,
      });
    }
    if (processingUploadKind === "pdf" && planInfo.resolved && planInfo.plan === "freemium" && effectivePages > FREEMIUM_PDF_PAGE_LIMIT) {
      return NextResponse.json(
        {
          ok: false,
          code: "FILE_TOO_LONG",
          message: `Denne PDF har ${effectivePages} sider, men Freemium-planen tillader maks. ${FREEMIUM_PDF_PAGE_LIMIT} sider pr. fil.`,
          pages: effectivePages,
          pageLimit: FREEMIUM_PDF_PAGE_LIMIT,
          plan: planInfo.plan,
          requestId,
        },
        { status: 413 },
      );
    }

    let quotaBefore;
    try {
      quotaBefore = await getImportQuotaSnapshot({ admin, ownerId });
    } catch (e) {
      console.error("[trainer/upload] import quota snapshot error:", errInfo(e));
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

    if (quotaBefore.monthlyLimit != null && quotaBefore.usedThisMonth + effectivePages > quotaBefore.monthlyLimit) {
      return buildQuotaExceededResponse({
        requestId,
        pages: effectivePages,
        usedThisMonth: quotaBefore.usedThisMonth,
        monthlyLimit: quotaBefore.monthlyLimit,
        resetAt: quotaBefore.resetAt,
      });
    }

    // storage
    const fileId = randomUUID();
    const fileExt = getFileExtension(originalName);
    const storagePath = `${ownerId}/${folderId}/${fileId}${fileExt || (processingUploadKind === "pdf" ? ".pdf" : ".bin")}`;

    logUploadStage(requestId, "storage_upload_started", { jobId, fileId, storagePath });
    await safeUpdateJob(admin, jobId, {
      file_id: fileId,
      payload: {
        source: "trainer_upload",
        request_id: requestId,
        folder_id: folderId,
        file_name: originalName,
        mime_type: mimeType,
        upload_kind: processingUploadKind,
        size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
        md5,
        file_id: fileId,
        storage_path: storagePath,
        stage: "storage_upload_started",
      },
    });

    const up = await admin.storage.from(UPLOAD_BUCKET).upload(storagePath, buf, {
      contentType: mimeType || "application/pdf",
      upsert: false,
    });

    if (up.error) {
      console.error("[trainer/upload] storage upload error:", errInfo(up.error));
      return NextResponse.json({ ok: false, error: "Kunne ikke uploade filen til storage.", requestId }, { status: 500 });
    }

    logUploadStage(requestId, "storage_upload_finished", { jobId, fileId, storagePath });

    const uploadedAt = new Date().toISOString();

    // insert files (robust fallback)
    const insertAttempts = [
      {
        label: "full_with_metadata",
        row: {
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
        page_count: effectivePages,
        ocr_pages: processingUploadKind === "pdf" ? extraction!.ocrPages : 0,
        extraction_method: processingUploadKind === "pdf" ? extraction!.extractionMethod : "text",
        extraction_quality: processingUploadKind === "pdf" ? extraction!.extractionQuality : "high",
        extraction_meta: {
          ...(processingUploadKind === "pdf" ? extraction!.extractionMeta : {}),
          input_kind: processingUploadKind,
        },
      },
      },
      {
        label: "full_with_metadata_compact",
        row: {
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
        page_count: effectivePages,
        ocr_pages: processingUploadKind === "pdf" ? extraction!.ocrPages : 0,
        extraction_method: processingUploadKind === "pdf" ? extraction!.extractionMethod : "text",
        extraction_quality: processingUploadKind === "pdf" ? extraction!.extractionQuality : "high",
        extraction_meta: processingUploadKind === "pdf" ? extraction!.extractionMeta : { input_kind: processingUploadKind },
      },
      },
      {
        label: "core_with_page_counts",
        row: {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        original_name: originalName,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
        page_count: effectivePages,
        ocr_pages: processingUploadKind === "pdf" ? extraction!.ocrPages : 0,
        extraction_meta: processingUploadKind === "pdf" ? extraction!.extractionMeta : { input_kind: processingUploadKind },
      },
      },
      {
        label: "legacy_core_without_extraction_metadata",
        row: {
          id: fileId,
          owner_id: ownerId,
          folder_id: folderId,
          name: originalName,
          original_name: originalName,
          storage_path: storagePath,
          md5,
          uploaded_at: uploadedAt,
        },
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
	      logUploadStage(requestId, "chunk_build_started", { jobId, fileId, uploadKind });
	      if (processingUploadKind === "pdf") {
	        console.info("[trainer/upload] rebuildDocChunksForFile call", {
	          requestId,
	          jobId,
	          fileId,
	          ownerId,
	          folderId,
	          pageCount: extraction!.pages.length,
	        });
	      }
	      const r =
	        processingUploadKind === "pdf"
	          ? await rebuildDocChunksForFile(admin, {
              ownerId,
              fileId,
              folderId,
              originalName,
              pages: extraction!.pages,
            })
          : await rebuildDocChunksForAudio(admin, {
              ownerId,
              fileId,
              folderId,
              originalName,
              transcriptText,
            });
	      chunkCount = r.chunkCount;
	      logUploadStage(requestId, "chunk_build_finished", { jobId, fileId, chunkCount });
	    } catch (e) {
	      console.error("[trainer/upload] rebuildDocChunks error:", errInfo(e));
	      await safeUpdateJob(admin, jobId, {
	        status: "failed",
	        file_id: fileId,
	        finished_at: new Date().toISOString(),
	        error: { message: (e as any)?.message ?? "Kunne ikke bygge tekstgrundlag for filen." },
	        payload: {
	          source: "trainer_upload",
	          request_id: requestId,
	          folder_id: folderId,
	          file_name: originalName,
	          mime_type: mimeType,
	          upload_kind: processingUploadKind,
	          size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
	          md5,
	          file_id: fileId,
	          storage_path: storagePath,
	          page_count: processingUploadKind === "pdf" ? extraction!.pageCount : 1,
	          ocr_pages: processingUploadKind === "pdf" ? extraction!.ocrPages : 0,
	          extraction_method: processingUploadKind === "pdf" ? extraction!.extractionMethod : "text",
	          extraction_quality: processingUploadKind === "pdf" ? extraction!.extractionQuality : "high",
	          stage: "failed",
	        },
	      });
	      await purgeFileArtifacts(admin, { ownerId, fileId, storagePath, fileMd5: md5 });
	      return NextResponse.json(
	        { ok: false, code: "CHUNK_BUILD_FAILED", error: "Kunne ikke bygge tekstgrundlag for filen.", requestId, fileId },
        { status: 500 },
      );
    }

    if (processingUploadKind === "pdf") {
      await syncOcrTextsForFile(admin, {
        ownerId,
        fileId,
        fileMd5: md5,
        ocrTexts: extraction!.ocrTexts,
      });
    }

    let generatedNotes: any[] = [];
    if (processingUploadKind === "audio") {
      try {
        logUploadStage(requestId, "audio_notes_started", { jobId, fileId });
        const requestedModes = parseRequestedNoteModes(form.get("audio_note_mode"));
        for (const mode of requestedModes) {
          await assertCanGenerateNoteType(admin, ownerId, mode === "golden" ? "focus" : "resume");
        }
        const noteEntitlement = await getNoteEntitlement(admin, ownerId);
        if (
          noteEntitlement.maxStoredNotes != null &&
          noteEntitlement.totalNotes + requestedModes.length > noteEntitlement.maxStoredNotes
        ) {
          const err: any = new Error(FREEMIUM_NOTES_LIMIT_MESSAGE);
          err.code = "NOTES_LIMIT_REACHED";
          throw err;
        }
        generatedNotes = await generateNotesForFile({
          sb: admin,
          ownerId,
          fileId,
          modes: requestedModes,
        });
        logUploadStage(requestId, "audio_notes_finished", { jobId, fileId, generatedNotes: generatedNotes.length });
      } catch (e: any) {
        console.error("[trainer/upload] audio note generation error:", errInfo(e));
        await purgeFileArtifacts(admin, { ownerId, fileId, storagePath, fileMd5: md5 });

        if (String(e?.code ?? "") === "NOTES_LIMIT_REACHED") {
          return NextResponse.json(
            { ok: false, code: "NOTES_LIMIT_REACHED", error: FREEMIUM_NOTES_LIMIT_MESSAGE, requestId },
            { status: 403 },
          );
        }
        if (String(e?.code ?? "") === "NOTES_SUMMARY_MONTHLY_LIMIT_REACHED") {
          return NextResponse.json(
            { ok: false, code: "NOTES_SUMMARY_MONTHLY_LIMIT_REACHED", error: FREEMIUM_SUMMARY_MONTHLY_LIMIT_MESSAGE, requestId },
            { status: 403 },
          );
        }
        if (String(e?.code ?? "") === "NOTES_FOCUS_MONTHLY_LIMIT_REACHED") {
          return NextResponse.json(
            { ok: false, code: "NOTES_FOCUS_MONTHLY_LIMIT_REACHED", error: FREEMIUM_FOCUS_MONTHLY_LIMIT_MESSAGE, requestId },
            { status: 403 },
          );
        }

        return NextResponse.json(
          { ok: false, code: "AUDIO_NOTES_FAILED", error: e?.message ?? "Kunne ikke generere noter fra lydfilen.", requestId },
          { status: 500 },
        );
      }
    }

    const quotaConsume = await quotaTryConsume({
      admin,
      ownerId,
      feature: "import",
      amount: effectivePages,
      exceededMessage: `Grænse nået. Du kan uploade igen efter nulstilling (${quotaBefore.resetAt ? formatDa(quotaBefore.resetAt) : "snart"}).`,
    });

    if (!quotaConsume.ok) {
      await purgeFileArtifacts(admin, { ownerId, fileId, storagePath, fileMd5: md5 });
      if (quotaConsume.status === 429) {
        return buildQuotaExceededResponse({
          requestId,
          pages: effectivePages,
          usedThisMonth: quotaConsume.used,
          monthlyLimit: quotaConsume.limitPerMonth,
          resetAt: quotaConsume.resetAt ?? quotaBefore.resetAt,
        });
      }
      return NextResponse.json(
        {
          ok: false,
          code: "QUOTA_CHECK_FAILED",
          message: quotaConsume.message,
          requestId,
        },
        { status: quotaConsume.status },
      );
    }

    await safeUpdateJob(admin, jobId, {
      status: "succeeded",
      file_id: fileId,
      finished_at: new Date().toISOString(),
      payload: {
        source: "trainer_upload",
        request_id: requestId,
        input_kind: uploadKind,
        folder_id: folderId,
        file_id: fileId,
        md5,
        pages: effectivePages,
        chunkCount,
        extraction_method: processingUploadKind === "pdf" ? extraction!.extractionMethod : "text",
        extraction_quality: processingUploadKind === "pdf" ? extraction!.extractionQuality : "high",
        ocr_pages: processingUploadKind === "pdf" ? extraction!.ocrPages : 0,
        dominant_page_type: processingUploadKind === "pdf" ? extraction!.extractionMeta.dominant_page_type : "audio_transcript",
        storage_path: storagePath,
        stage: "finished",
      },
      result: {
        ok: true,
        requestId,
        fileId,
        folderId,
        uploadKind,
        pages: effectivePages,
        chunkCount,
      },
      error: null,
    });
    logUploadStage(requestId, "response_ready", { jobId, fileId, uploadKind, pages: effectivePages, chunkCount });

    await trackProductEvent({
      admin,
      ownerId,
      eventName: "upload_completed",
      metadata: {
        source: "own",
        folder_id: folderId,
        file_id: fileId,
        feature: "trainer_upload",
        upload_kind: uploadKind,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        requestId,
        jobId,
        fileId,
        folderId,
        md5,
        uploadKind,
        pages: effectivePages,
        chunkCount,
      extractionMethod: processingUploadKind === "pdf" ? extraction!.extractionMethod : "text",
      extractionQuality: processingUploadKind === "pdf" ? extraction!.extractionQuality : "high",
      ocrPages: processingUploadKind === "pdf" ? extraction!.ocrPages : 0,
      extractionMeta: processingUploadKind === "pdf" ? extraction!.extractionMeta : { input_kind: processingUploadKind },
        generatedNotes: generatedNotes.map((note) => ({
          id: note.id,
          title: note.title,
          note_type: note.note_type,
        })),
        storage: { bucket: UPLOAD_BUCKET, path: storagePath },
      },
      { status: 200 },
    );
  } catch (e: any) {
    await safeUpdateJob(admin, jobId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: { message: e?.message ?? "Uventet fejl i upload." },
      payload: {
        source: "trainer_upload",
        request_id: requestId,
        stage: "failed",
      },
    });
    console.error("[trainer/upload] route error:", errInfo(e));
    return NextResponse.json({ ok: false, error: e?.message ?? "Uventet fejl i upload.", requestId }, { status: 500 });
  }
}
