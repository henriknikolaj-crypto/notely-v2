import "server-only";

import { after, NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import { PDFDocument } from "pdf-lib";
import { extractPdfWithFallback, type ExtractedPdfPage } from "@/lib/pdf/extractPdfWithFallback";
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
const MAX_FILE_BYTES = 50 * 1024 * 1024; // hård beskyttelse (ikke quota)
const FREEMIUM_PDF_PAGE_LIMIT = 15;
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".mp4", ".mpeg", ".mpga", ".webm", ".ogg", ".oga", ".flac", ".aac"]);

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

  // ryd først (idempotent)
  {
    const del = await admin.from("doc_chunks").delete().eq("owner_id", ownerId).eq("file_id", fileId);
    if (del.error) throw del.error;
  }

  const rows = buildChunksFromExtractedPages(pages)
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

  if (!rows.length) throw new Error("Ingen chunks dannet fra PDF.");

  const ins = await admin.from("doc_chunks").insert(rows);
  if (ins.error) throw ins.error;
  return { chunkCount: rows.length };
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

  const attempts: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const pushAttempt = (candidate: Record<string, unknown>) => {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(candidate);
  };
  for (const seed of seedPatches) {
    pushAttempt(seed);
    if ("started_at" in seed || "finished_at" in seed) {
      const withoutTimestamps = { ...seed };
      delete (withoutTimestamps as any).started_at;
      delete (withoutTimestamps as any).finished_at;
      pushAttempt(withoutTimestamps);
    }
  }

  try {
    let lastError: any = null;
    for (const attempt of attempts) {
      const result = await admin.from("jobs").update(attempt).eq("id", jobId);
      if (!result.error) return;
      lastError = result.error;
    }
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
}) {
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
  } = args;
  const admin = supabaseAdmin();

  try {
    logUploadStage(requestId, "processing_started", { jobId, fileId, storagePath });
      await safeUpdateJob(admin, jobId, {
        status: "started",
        file_id: fileId,
        started_at: new Date().toISOString(),
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
        stage: "processing_started",
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
        stage: "processing_started",
      }),
    });

    logUploadStage(requestId, "pdf_extract_started", { jobId, fileName: originalName, fileId });
      await safeUpdateJob(admin, jobId, {
        status: "started",
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
        stage: "pdf_extract_started",
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
        stage: "pdf_extract_started",
      }),
    });

    const extraction = await extractPdfWithFallback(buf, { fileName: originalName });
    logUploadStage(requestId, "pdf_extract_finished", {
      jobId,
      fileId,
      pageCount: extraction.pageCount,
      ocrPages: extraction.ocrPages,
      extractionMethod: extraction.extractionMethod,
    });
    await safeUpdateFileRecord(admin, fileId, {
      page_count: extraction.pageCount,
      ocr_pages: extraction.ocrPages,
      extraction_method: extraction.extractionMethod,
      extraction_quality: extraction.extractionQuality,
      extraction_meta: {
        ...extraction.extractionMeta,
        input_kind: "pdf",
        processing_status: "extract_finished",
        request_id: requestId,
      },
    });
      await safeUpdateJob(admin, jobId, {
        status: "started",
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
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        extractionQuality: extraction.extractionQuality,
        stage: "pdf_extract_finished",
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
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        extractionQuality: extraction.extractionQuality,
        stage: "pdf_extract_finished",
      }),
    });

    logUploadStage(requestId, "chunk_build_started", { jobId, fileId, uploadKind: "pdf" });
      await safeUpdateJob(admin, jobId, {
        status: "started",
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
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        extractionQuality: extraction.extractionQuality,
        stage: "chunk_build_started",
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
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        extractionQuality: extraction.extractionQuality,
        stage: "chunk_build_started",
      }),
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
    logUploadStage(requestId, "chunk_build_finished", { jobId, fileId, chunkCount: chunkBuild.chunkCount });
      await safeUpdateJob(admin, jobId, {
        status: "started",
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
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        extractionQuality: extraction.extractionQuality,
        chunkCount: chunkBuild.chunkCount,
        stage: "chunk_build_finished",
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
        pageCount: extraction.pageCount,
        ocrPages: extraction.ocrPages,
        extractionMethod: extraction.extractionMethod,
        extractionQuality: extraction.extractionQuality,
        chunkCount: chunkBuild.chunkCount,
        stage: "chunk_build_finished",
      }),
    });

    const quotaConsume = await quotaTryConsume({
      admin,
      ownerId,
      feature: "import",
      amount: extraction.pageCount,
      exceededMessage: `Grænse nået. Du kan uploade igen efter nulstilling (${quotaResetAt ? formatDa(quotaResetAt) : "snart"}).`,
    });

    if (!quotaConsume.ok) {
      await purgeFileArtifacts(admin, { ownerId, fileId, storagePath, fileMd5: md5 });
      await safeUpdateJob(admin, jobId, {
        status: "failed",
        file_id: fileId,
        finished_at: new Date().toISOString(),
        error: {
          message:
            quotaConsume.message ??
            "Uploaden kunne ikke færdiggøres, fordi din upload-kvote blev nået under behandlingen.",
        },
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
          pageCount: extraction.pageCount,
          ocrPages: extraction.ocrPages,
          extractionMethod: extraction.extractionMethod,
          extractionQuality: extraction.extractionQuality,
          chunkCount: chunkBuild.chunkCount,
          stage: "failed",
        }),
      });
      return;
    }

    await safeUpdateFileRecord(admin, fileId, {
      page_count: extraction.pageCount,
      ocr_pages: extraction.ocrPages,
      extraction_method: extraction.extractionMethod,
      extraction_quality: extraction.extractionQuality,
      extraction_meta: {
        ...extraction.extractionMeta,
        input_kind: "pdf",
        processing_status: "finished",
        request_id: requestId,
      },
    });
    await safeUpdateJob(admin, jobId, {
      status: "finished",
      file_id: fileId,
      finished_at: new Date().toISOString(),
      payload: {
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
          pageCount: extraction.pageCount,
          ocrPages: extraction.ocrPages,
          extractionMethod: extraction.extractionMethod,
          extractionQuality: extraction.extractionQuality,
          chunkCount: chunkBuild.chunkCount,
          stage: "finished",
        }),
        dominant_page_type: extraction.extractionMeta.dominant_page_type,
        pages: extraction.pageCount,
      },
      result: {
        ok: true,
        requestId,
        fileId,
        folderId,
        uploadKind: "pdf",
        pages: extraction.pageCount,
        chunkCount: chunkBuild.chunkCount,
      },
      error: null,
    });
    logUploadStage(requestId, "response_ready", {
      jobId,
      fileId,
      uploadKind: "pdf",
      pages: extraction.pageCount,
      chunkCount: chunkBuild.chunkCount,
      accepted: true,
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
  } catch (e: any) {
    await purgeFileArtifacts(admin, { ownerId, fileId, storagePath, fileMd5: md5 });
    await safeUpdateJob(admin, jobId, {
      status: "failed",
      file_id: fileId,
      finished_at: new Date().toISOString(),
      error: { message: e?.message ?? "PDF-behandling fejlede." },
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
        stage: "failed",
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
        stage: "failed",
      }),
    });
    console.error("[trainer/upload] accepted pdf processing error:", errInfo(e));
  }
}

export async function POST(req: NextRequest) {
  const fallbackRequestId = randomUUID();
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
  let requestId: string = fallbackRequestId;
  let jobId: string | null = null;

  let ownerId = "";
  try {
    const sb = resolveUploadAuthClient(req);
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

    let getUserError: string | null = null;
    ownerId = sessionUserId ?? "";

    if (!ownerId) {
      const { data: authData, error: authError } = await sb.auth.getUser();
      getUserError = authError?.message ?? null;
      ownerId = authData?.user?.id ? String(authData.user.id) : "";
    }

    if (!ownerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
          requestId,
          ...(process.env.VERCEL_ENV === "preview"
            ? {
                debug: {
                  hasSession: !!sessionData?.session,
                  sessionUserId,
                  sessionError: sessionError?.message ?? null,
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
              ? "Filen er større end 50 MB. Prøv at komprimere PDF’en eller del den i to filer."
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
        size_bytes: typeof (file as any).size === "number" ? Number((file as any).size) : null,
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
      await safeUpdateJob(admin, jobId, {
        status: "queued",
        file_id: fileId,
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
          stage: "storage_upload_finished",
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
          stage: "storage_upload_finished",
        }),
      });

      const uploadedAt = new Date().toISOString();
      const placeholderExtractionMeta = {
        input_kind: uploadKind,
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
            size_bytes: (file as any).size ?? null,
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
            size_bytes: (file as any).size ?? null,
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
          stage: "queued",
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
          stage: "queued",
        }),
      });
      logUploadStage(requestId, "response_ready", {
        jobId,
        fileId,
        uploadKind,
        pages: effectivePages,
        accepted: true,
      });

      after(async () => {
        await processAcceptedPdfUpload({
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
        });
      });

      return NextResponse.json(
        {
          ok: true,
          accepted: true,
          processing: true,
          requestId,
          jobId,
          fileId,
          folderId,
          md5,
          uploadKind,
          pages: effectivePages,
          stage: "queued",
          jobStatus: "queued",
          storage: { bucket: UPLOAD_BUCKET, path: storagePath },
        },
        { status: 202 },
      );
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
        extraction = await extractPdfWithFallback(buf, { fileName: originalName });
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
      status: "finished",
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
