import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
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
import { ensureProfile } from "@/lib/server/ensureProfile";
import { trackProductEvent } from "@/lib/server/trackProductEvent";
import { getActiveFolderIdSet, purgeFileArtifacts, purgeInactiveDuplicateFiles } from "@/lib/server/file-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hold denne i sync med DELETE-route (din /api/files/[id] bruger trainer_uploads)
const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "trainer_uploads";
const MAX_FILE_BYTES = 30 * 1024 * 1024; // hård beskyttelse (ikke quota)
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".mp4", ".mpeg", ".mpga", ".webm", ".ogg", ".oga", ".flac", ".aac"]);

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



async function getPlan(admin: any, ownerId: string): Promise<string> {
  try {
    const r = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const p = String((r.data as any)?.plan ?? "").trim();
    return p || "freemium";
  } catch {
    return "freemium";
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

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);

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

    await ensureProfile(admin, ownerId);

    const folderId = String(form.get("folder_id") ?? form.get("folderId") ?? form.get("folder") ?? "").trim() || null;
    const file = form.get("file") as unknown as File | null;

    if (!folderId) return NextResponse.json({ ok: false, error: "Manglende folder_id.", requestId }, { status: 400 });
    if (!file) return NextResponse.json({ ok: false, error: "Manglende fil.", requestId }, { status: 400 });

    if ((file as any).size != null && Number((file as any).size) > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          code: "FILE_TOO_LARGE",
          error: `Filen er for stor. Maks. ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB pr. fil.`,
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

    const originalName = stripPathy(file.name || "upload");
    const mimeType = String((file as any).type || "application/octet-stream") || "application/octet-stream";
    const uploadKind = detectUploadKind(file, originalName);

    if (uploadKind === "other") {
      return NextResponse.json(
        { ok: false, error: "Filtypen understøttes ikke endnu. Upload PDF eller lydfil.", requestId },
        { status: 400 },
      );
    }

    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const md5 = createHash("md5").update(buf).digest("hex");

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

    let extraction: Awaited<ReturnType<typeof extractPdfWithFallback>> | null = null;
    let transcriptText = "";

    if (uploadKind === "pdf") {
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

    const effectivePages = uploadKind === "audio" ? 1 : extraction!.pageCount;

    const plan = await getPlan(admin, ownerId);
    if (uploadKind === "pdf" && plan === "freemium" && effectivePages > 10) {
      return NextResponse.json(
        {
          ok: false,
          code: "FILE_TOO_LONG",
          message: "Denne fil er for stor til Freemium-planen. Maks. 10 sider pr. fil.",
          pages: effectivePages,
          pageLimit: 10,
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
    const storagePath = `${ownerId}/${folderId}/${fileId}${fileExt || (uploadKind === "pdf" ? ".pdf" : ".bin")}`;

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
        ocr_pages: uploadKind === "pdf" ? extraction!.ocrPages : 0,
        extraction_method: uploadKind === "pdf" ? extraction!.extractionMethod : "text",
        extraction_quality: uploadKind === "pdf" ? extraction!.extractionQuality : "high",
        extraction_meta: {
          ...(uploadKind === "pdf" ? extraction!.extractionMeta : {}),
          input_kind: uploadKind,
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
        ocr_pages: uploadKind === "pdf" ? extraction!.ocrPages : 0,
        extraction_method: uploadKind === "pdf" ? extraction!.extractionMethod : "text",
        extraction_quality: uploadKind === "pdf" ? extraction!.extractionQuality : "high",
        extraction_meta: uploadKind === "pdf" ? extraction!.extractionMeta : { input_kind: uploadKind },
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
        ocr_pages: uploadKind === "pdf" ? extraction!.ocrPages : 0,
        extraction_meta: uploadKind === "pdf" ? extraction!.extractionMeta : { input_kind: uploadKind },
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
      const r =
        uploadKind === "pdf"
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
    } catch (e) {
      console.error("[trainer/upload] rebuildDocChunks error:", errInfo(e));
      await purgeFileArtifacts(admin, { ownerId, fileId, storagePath, fileMd5: md5 });
      return NextResponse.json(
        { ok: false, code: "CHUNK_BUILD_FAILED", error: "Kunne ikke bygge tekstgrundlag for filen.", requestId, fileId },
        { status: 500 },
      );
    }

    if (uploadKind === "pdf") {
      await syncOcrTextsForFile(admin, {
        ownerId,
        fileId,
        fileMd5: md5,
        ocrTexts: extraction!.ocrTexts,
      });
    }

    let generatedNotes: any[] = [];
    if (uploadKind === "audio") {
      try {
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
          input_kind: uploadKind,
          folder_id: folderId,
          file_id: fileId,
          md5,
          pages: effectivePages,
          chunkCount,
          extraction_method: uploadKind === "pdf" ? extraction!.extractionMethod : "text",
          extraction_quality: uploadKind === "pdf" ? extraction!.extractionQuality : "high",
          ocr_pages: uploadKind === "pdf" ? extraction!.ocrPages : 0,
          dominant_page_type: uploadKind === "pdf" ? extraction!.extractionMeta.dominant_page_type : "audio_transcript",
          storage_path: storagePath,
        },
      });
    } catch {}

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
        fileId,
        folderId,
        md5,
        uploadKind,
        pages: effectivePages,
        chunkCount,
        extractionMethod: uploadKind === "pdf" ? extraction!.extractionMethod : "text",
        extractionQuality: uploadKind === "pdf" ? extraction!.extractionQuality : "high",
        ocrPages: uploadKind === "pdf" ? extraction!.ocrPages : 0,
        extractionMeta: uploadKind === "pdf" ? extraction!.extractionMeta : { input_kind: uploadKind },
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
    console.error("[trainer/upload] route error:", errInfo(e));
    return NextResponse.json({ ok: false, error: e?.message ?? "Uventet fejl i upload.", requestId }, { status: 500 });
  }
}
