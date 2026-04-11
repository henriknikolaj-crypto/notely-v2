// app/traener/upload/UploadClient.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LimitNotice from "@/app/traener/_ui/LimitNotice";
import { fetchQuotaCurrent } from "@/lib/quota/current-client";
import { createBrowserClient } from "@/lib/supabase/client";

type Folder = {
  id: string;
  name: string;
};

type FileRow = {
  id: string;
  name: string;
  folderId: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
};

type FileReadiness = {
  id: string;
  readiness: "ready" | "processing" | "background" | "failed";
  readinessLabel: string;
  readinessDetail: string | null;
  ready: boolean;
  chunkCount: number;
  jobStatus: string | null;
  jobStage: string | null;
};

type UserFileStatusKind = "uploaded" | "preparing" | "enhancing" | "ready" | "failed";

type LocalFileStatus = {
  fileId: string;
  fileName: string;
  folderId: string;
  sizeBytes: number | null;
  uploadedAt: string | null;
  status: UserFileStatusKind;
  error: string | null;
  updatedAt: number;
};

type UserFileStatus = {
  kind: UserFileStatusKind;
  label: string;
  detail: string | null;
};

type UploadResult = {
  kind: "pdf" | "audio";
  fileName: string;
  message: string;
  noteCount?: number;
  audioNoteMode?: "resume" | "focus" | "both";
};

type ActiveUpload = {
  requestId: string;
  startedAt: number;
  fileName: string;
  folderId: string;
  jobId: string | null;
  fileId: string | null;
  responseSettled: boolean;
  kind: "pdf" | "audio";
  status: string | null;
  stage: string | null;
};

type ImportStatusPayload = {
  ok?: boolean;
  error?: string | null;
  activeJob?: {
    id?: string | null;
    status?: string | null;
    stage?: string | null;
    error?: string | null;
    requestId?: string | null;
    fileId?: string | null;
    folderId?: string | null;
    uploadKind?: string | null;
  } | null;
  folderFiles?: FileReadiness[] | null;
};

type GeneratedUploadNote = {
  id: string;
  title?: string | null;
  note_type?: string | null;
};

type Props = {
  folders: Folder[];
  initialFolderId: string | null;
  ownerId: string;
  onFoldersChange?: (folders: Folder[]) => void;
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PDF_TOO_LARGE_ERROR = "Filen er større end 25 MB. Prøv at komprimere PDF’en eller del den i to filer.";
const PDF_TOO_MANY_PAGES_ERROR =
  "PDF’en har for mange sider til hurtig og sikker behandling. Del den op i mindre filer på højst 100 sider.";
const MONTHLY_IMPORT_QUOTA_ERROR = "Du har nået din månedlige importkvote.";
const WEBUPLOAD_PAYLOAD_TOO_LARGE_ERROR =
  "Filen er for stor til at blive sendt gennem webupload lige nu. Prøv en mindre fil eller komprimer PDF’en.";
const UPLOAD_STATUS_POLL_INITIAL_MS = 2_000;
const UPLOAD_STATUS_POLL_MS = 5_000;
const UPLOAD_STATUS_POLL_SLOW_MS = 10_000;
const UPLOAD_STATUS_BACKOFF_MS = 15_000;
const UPLOAD_JOB_BOOT_TIMEOUT_MS = 45_000;
const DEFAULT_UPLOAD_REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const PDF_UPLOAD_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVE_UPLOAD_REFRESH_MS = 15_000;
const UPLOAD_READY_FOLLOWUP_REFRESH_MS = 1_500;
const PREPARING_STATUS_TOKENS = new Set([
  "started",
  "preparing",
  "processing",
  "queued",
  "first_processing",
  "ocr_started",
  "ocr_finished",
  "processing_started",
  "pdf_extract_started",
  "pdf_extract_finished",
  "chunk_build_started",
  "chunk_build_finished",
  "payload_stage",
  "file_buffered",
  "storage_upload_finished",
]);
const READY_STATUS_TOKENS = new Set(["ready", "succeeded", "finished", "completed", "first_ready"]);
const BACKGROUND_STATUS_TOKENS = new Set(["deep_processing"]);

function createClientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `upload_${Date.now()}`;
}

function asString(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function asNumber(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFolderRow(x: any): Folder | null {
  const id = asString(x?.id);
  const name = asString(x?.name) ?? asString(x?.title);
  if (!id || !name) return null;
  return { id, name };
}

function normalizeFileRow(x: any): FileRow | null {
  const id = asString(x?.id);
  const name = asString(x?.name) ?? asString(x?.original_name) ?? asString(x?.originalName);
  if (!id || !name) return null;

  return {
    id,
    name,
    folderId: asString(x?.folder_id) ?? asString(x?.folderId),
    sizeBytes: asNumber(x?.size_bytes) ?? asNumber(x?.sizeBytes),
    uploadedAt: asString(x?.uploaded_at) ?? asString(x?.uploadedAt) ?? asString(x?.created_at),
  };
}

function fmtDa(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function humanBytes(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "";
  const kb = 1024;
  const mb = kb * 1024;
  if (n >= mb) return `${(n / mb).toFixed(1).replace(".", ",")} MB`;
  if (n >= kb) return `${Math.round(n / kb)} KB`;
  return `${n} B`;
}

function safeJson(text: string) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function isVercelPayloadTooLarge(status: number, res: Response | null, responseText: string, data: any) {
  if (status !== 413) return false;
  const headerSignal = String(res?.headers.get("x-vercel-error") ?? "")
    .trim()
    .toUpperCase();
  if (headerSignal === "FUNCTION_PAYLOAD_TOO_LARGE") return true;

  const codeSignal = String(data?.code ?? "").trim().toUpperCase();
  if (codeSignal === "FUNCTION_PAYLOAD_TOO_LARGE") return true;

  const textSignal = String(responseText ?? "").trim().toUpperCase();
  return textSignal.includes("FUNCTION_PAYLOAD_TOO_LARGE");
}

function resolveUploadErrorMessage(
  status: number,
  data: any,
  file: File | null,
  options?: { res?: Response | null; responseText?: string | null },
) {
  const res = options?.res ?? null;
  const responseText = String(options?.responseText ?? "");
  const serverMessage = asString(data?.message) ?? asString(data?.error);
  if (serverMessage) return serverMessage;

  const code = String(data?.code ?? "").trim().toUpperCase();

  if (status === 402 || status === 429) {
    return MONTHLY_IMPORT_QUOTA_ERROR;
  }

  if (status === 413) {
    if (isVercelPayloadTooLarge(status, res, responseText, data)) {
      return WEBUPLOAD_PAYLOAD_TOO_LARGE_ERROR;
    }
    if (code === "FILE_TOO_LARGE") {
      if (isPdfFile(file)) return PDF_TOO_LARGE_ERROR;
      return `Filen er for stor. Maks. ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB pr. fil.`;
    }
    if (code === "FILE_TOO_LONG") {
      return PDF_TOO_MANY_PAGES_ERROR;
    }
    if (isPdfFile(file) && typeof file?.size === "number" && file.size > MAX_FILE_BYTES) {
      return PDF_TOO_LARGE_ERROR;
    }
    if (isPdfFile(file)) {
      return PDF_TOO_MANY_PAGES_ERROR;
    }
  }

  if (status >= 400) {
    if (isVercelPayloadTooLarge(status, res, responseText, data)) {
      return WEBUPLOAD_PAYLOAD_TOO_LARGE_ERROR;
    }
    return `Ukendt uploadfejl (${status}). Prøv igen.`;
  }

  return "Ukendt uploadfejl. Prøv igen.";
}

function buildReadinessMap(rows: FileReadiness[]) {
  return rows.reduce<Record<string, FileReadiness>>((acc, row) => {
    if (!row?.id) return acc;
    acc[String(row.id)] = row;
    return acc;
  }, {});
}

function normalizeStatusToken(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function buildUserFileStatus(kind: UserFileStatusKind, error?: string | null): UserFileStatus {
  if (kind === "uploaded") {
    return { kind, label: "Uploadet", detail: null };
  }
  if (kind === "preparing") {
    return { kind, label: "Klargøres", detail: null };
  }
  if (kind === "enhancing") {
    return { kind, label: "Forbedres", detail: error ?? "Materialet er klar og forbedres i baggrunden" };
  }
  if (kind === "ready") {
    return { kind, label: "Klar", detail: null };
  }
  return { kind, label: "Fejl", detail: error ?? "Klargøring fejlede" };
}

function statusPriority(kind: UserFileStatusKind) {
  if (kind === "uploaded") return 1;
  if (kind === "preparing") return 2;
  if (kind === "ready") return 3;
  if (kind === "enhancing") return 4;
  return 0;
}

function mergeLocalFileStatus(current: LocalFileStatus | null, next: LocalFileStatus) {
  if (!current) return next;
  if (next.status === "enhancing") return { ...current, ...next };
  if (current.status === "enhancing" && next.status !== "failed") return current;
  if (next.status === "ready") return { ...current, ...next };
  if (current.status === "ready") return current;
  if (next.status === "failed") return { ...current, ...next };
  if (current.status === "failed") return current;
  if (statusPriority(next.status) >= statusPriority(current.status)) {
    return { ...current, ...next };
  }
  return {
    ...current,
    ...next,
    status: current.status,
    error: current.error,
    updatedAt: current.updatedAt,
  };
}

function mapReadinessToUserStatus(readiness: FileReadiness | null): UserFileStatus | null {
  if (!readiness) return null;

  const jobStatus = normalizeStatusToken(readiness.jobStatus);
  const jobStage = normalizeStatusToken(readiness.jobStage);

  if (readiness.readiness === "failed") {
    return buildUserFileStatus("failed", readiness.readinessDetail);
  }

  if (
    readiness.readiness === "background" ||
    BACKGROUND_STATUS_TOKENS.has(jobStatus) ||
    BACKGROUND_STATUS_TOKENS.has(jobStage)
  ) {
    return buildUserFileStatus("enhancing", readiness.readinessDetail);
  }

  if (
    readiness.ready ||
    readiness.readiness === "ready" ||
    READY_STATUS_TOKENS.has(jobStatus) ||
    READY_STATUS_TOKENS.has(jobStage)
  ) {
    return buildUserFileStatus("ready");
  }

  if (jobStatus === "failed" || jobStage === "failed") {
    return buildUserFileStatus("failed", readiness.readinessDetail);
  }

  if (
    readiness.readiness === "processing" ||
    PREPARING_STATUS_TOKENS.has(jobStatus) ||
    PREPARING_STATUS_TOKENS.has(jobStage)
  ) {
    return buildUserFileStatus("preparing");
  }

  return buildUserFileStatus("preparing");
}

function pickDisplayStatus(localStatus: UserFileStatus | null, serverStatus: UserFileStatus | null) {
  if (!localStatus) return serverStatus;
  if (!serverStatus) return localStatus;
  if (serverStatus.kind === "enhancing" || localStatus.kind === "enhancing") {
    return serverStatus.kind === "enhancing" ? serverStatus : localStatus;
  }
  if (serverStatus.kind === "ready" || localStatus.kind === "ready") {
    return serverStatus.kind === "ready" ? serverStatus : localStatus;
  }
  if (serverStatus.kind === "failed" || localStatus.kind === "failed") {
    return serverStatus.kind === "failed" ? serverStatus : localStatus;
  }
  return statusPriority(localStatus.kind) >= statusPriority(serverStatus.kind) ? localStatus : serverStatus;
}

function omitSuppressedFiles(rows: FileRow[], suppressedFileIds: Record<string, true>) {
  const suppressedIds = Object.keys(suppressedFileIds);
  if (suppressedIds.length === 0) return rows;
  return rows.filter((row) => !suppressedFileIds[row.id]);
}

function mergeVisibleFileRows(
  serverRows: FileRow[],
  folderId: string | null,
  localStatusesById: Record<string, LocalFileStatus>,
  suppressedFileIds: Record<string, true>,
) {
  const visibleServerRows = omitSuppressedFiles(serverRows, suppressedFileIds);
  const merged = [...visibleServerRows];
  const seen = new Set(visibleServerRows.map((row) => row.id));

  for (const status of Object.values(localStatusesById)) {
    if (
      !folderId ||
      status.folderId !== folderId ||
      seen.has(status.fileId) ||
      status.status === "ready" ||
      suppressedFileIds[status.fileId]
    ) {
      continue;
    }

    merged.unshift({
      id: status.fileId,
      name: status.fileName,
      folderId: status.folderId,
      sizeBytes: status.sizeBytes,
      uploadedAt: status.uploadedAt,
    });
  }

  return merged;
}

function findMatchingUploadFile(upload: ActiveUpload | null, rows: FileRow[]) {
  if (!upload) return null;
  return (
    rows.find((file) => {
      if (upload.fileId && file.id === upload.fileId) return true;
      return file.name === upload.fileName;
    }) ?? null
  );
}

function isUploadReadyFromSnapshot(
  upload: ActiveUpload | null,
  rows: FileRow[],
  readinessById: Record<string, FileReadiness>,
) {
  const matchedFile = findMatchingUploadFile(upload, rows);
  if (!matchedFile) return false;
  return readinessById[matchedFile.id]?.ready === true;
}

function isAudioFile(file: File | null) {
  if (!file) return false;
  const mime = String(file.type ?? "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  return /\.(mp3|m4a|wav|mp4|mpeg|mpga|webm|ogg|oga|flac|aac)$/i.test(file.name ?? "");
}

function isPdfFile(file: File | null) {
  if (!file) return false;
  const mime = String(file.type ?? "").toLowerCase();
  if (mime === "application/pdf") return true;
  return /\.pdf$/i.test(file.name ?? "");
}

function pickImportQuota(json: any): { used: number; limit: number | null } {
  const used =
    (typeof json?.import?.usedThisMonth === "number" ? json.import.usedThisMonth : null) ??
    (typeof json?.usedThisMonth === "number" ? json.usedThisMonth : 0);

  const limit =
    (typeof json?.import?.limitPerMonth === "number" ? json.import.limitPerMonth : null) ??
    (typeof json?.monthlyLimit === "number" ? json.monthlyLimit : null);

  return { used: Number.isFinite(used) ? used : 0, limit: typeof limit === "number" ? limit : null };
}

function describeProcessingStage(activeUpload: ActiveUpload | null) {
  if (!activeUpload || activeUpload.kind !== "pdf" || !activeUpload.responseSettled) return null;

  const status = normalizeStatusToken(activeUpload.status);
  const stage = normalizeStatusToken(activeUpload.stage);
  if (status === "failed" || stage === "failed") return null;
  if (BACKGROUND_STATUS_TOKENS.has(status) || BACKGROUND_STATUS_TOKENS.has(stage)) {
    return "Status: Materialet er klar og forbedres i baggrunden";
  }
  if (READY_STATUS_TOKENS.has(status) || READY_STATUS_TOKENS.has(stage)) return null;
  return "Status: Klargøres";
}

function getUploadPollDelayMs(elapsedMs: number) {
  if (elapsedMs < 15_000) return UPLOAD_STATUS_POLL_INITIAL_MS;
  if (elapsedMs < 60_000) return UPLOAD_STATUS_POLL_MS;
  return UPLOAD_STATUS_POLL_SLOW_MS;
}

function mergeActiveUploadState(current: ActiveUpload | null, patch: Partial<ActiveUpload>) {
  if (!current) return current;
  return {
    ...current,
    requestId: patch.requestId ?? current.requestId,
    startedAt: patch.startedAt ?? current.startedAt,
    fileName: patch.fileName ?? current.fileName,
    folderId: patch.folderId ?? current.folderId,
    jobId: patch.jobId ?? current.jobId,
    fileId: patch.fileId ?? current.fileId,
    responseSettled: patch.responseSettled ?? current.responseSettled,
    kind: patch.kind ?? current.kind,
    status: patch.status ?? current.status,
    stage: patch.stage ?? current.stage,
  };
}

export default function UploadClient({ folders: initialFolders, initialFolderId, ownerId, onFoldersChange }: Props) {
  // NOTE: props bruges primært til at fixe typecheck + give hurtig initial state
  void ownerId;
  const router = useRouter();

  // folders
  const [folders, setFolders] = useState<Folder[]>(() => (Array.isArray(initialFolders) ? initialFolders : []));
  const [foldersLoading, setFoldersLoading] = useState(() => (Array.isArray(initialFolders) ? false : true));
  const [foldersError, setFoldersError] = useState<string | null>(null);

  // selection
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(() => initialFolderId ?? null);
  const [listFolderId, setListFolderId] = useState<string | null>(() => initialFolderId ?? null);

  // keep latest listFolderId for async flows
  const listFolderIdRef = useRef<string | null>(null);
  useEffect(() => {
    listFolderIdRef.current = listFolderId;
  }, [listFolderId]);

  // files list
  const [files, setFiles] = useState<FileRow[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [fileReadinessById, setFileReadinessById] = useState<Record<string, FileReadiness>>({});
  const [localFileStatusesById, setLocalFileStatusesById] = useState<Record<string, LocalFileStatus>>({});
  const [suppressedFileIds, setSuppressedFileIds] = useState<Record<string, true>>({});
  const suppressedFileIdsRef = useRef<Record<string, true>>({});

  // upload
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<string | null>(null);
  const [audioNoteMode, setAudioNoteMode] = useState<"resume" | "focus" | "both">("both");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [activeUpload, setActiveUpload] = useState<ActiveUpload | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadAbortReasonRef = useRef<string | null>(null);
  const lastActiveUploadRefreshRef = useRef(0);
  const uploadReadyRefreshTimeoutRef = useRef<number | null>(null);
  const loadFoldersRequestRef = useRef(0);
  const loadFilesRequestRef = useRef(0);

  // delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrorsById, setDeleteErrorsById] = useState<Record<string, string>>({});

  // move
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);

  useEffect(() => {
    suppressedFileIdsRef.current = suppressedFileIds;
  }, [suppressedFileIds]);

  const dispatchQuotaChanged = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("notely-quota-changed"));
    window.dispatchEvent(new Event("notely:import-status-refresh"));
  }, []);

  const dispatchImportStatusRefresh = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("notely:import-status-refresh"));
  }, []);

  const dispatchUploadActivity = useCallback((active: boolean) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("notely:upload-activity", {
        detail: { active },
      }),
    );
  }, []);

  const folderOptions = useMemo(() => folders, [folders]);

  const clearPickedFileSelection = useCallback((targetFileName?: string | null) => {
    if (targetFileName && pickedFile && pickedFile.name !== targetFileName) return;
    setPickedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [pickedFile]);

  useEffect(() => {
    const nextFolders = Array.isArray(initialFolders) ? initialFolders : [];
    setFolders(nextFolders);
    setFoldersLoading(false);

    if (nextFolders.length === 0) {
      setUploadFolderId(null);
      setListFolderId(null);
      return;
    }

    const fallback = nextFolders[0].id;
    setUploadFolderId((prev) => {
      if (prev && nextFolders.some((f) => f.id === prev)) return prev;
      if (initialFolderId && nextFolders.some((f) => f.id === initialFolderId)) return initialFolderId;
      return fallback;
    });
    setListFolderId((prev) => {
      if (prev && nextFolders.some((f) => f.id === prev)) return prev;
      if (initialFolderId && nextFolders.some((f) => f.id === initialFolderId)) return initialFolderId;
      return fallback;
    });
  }, [initialFolders, initialFolderId]);

  useEffect(() => {
    setDeleteErrorsById({});
  }, [listFolderId]);

  const loadFolders = useCallback(async () => {
    const requestSeq = ++loadFoldersRequestRef.current;
    setFoldersLoading(true);
    setFoldersError(null);

    try {
      const res = await fetch("/api/folders", {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const text = await res.text();
      const json = safeJson(text);

      if (res.status === 401) {
        if (requestSeq !== loadFoldersRequestRef.current) return;
        setFoldersError("Mapper opdateres lige nu.");
        return;
      }

      if (!res.ok) {
        if (requestSeq !== loadFoldersRequestRef.current) return;
        setFoldersError("Mapper opdateres lige nu.");
        return;
      }

      if (!json || json.ok === false) {
        if (requestSeq !== loadFoldersRequestRef.current) return;
        setFoldersError("Mapper opdateres lige nu.");
        return;
      }

      const raw = Array.isArray(json.folders)
        ? json.folders
        : Array.isArray(json.items)
          ? json.items
          : Array.isArray(json.data)
            ? json.data
            : [];

      const normalized = raw.map(normalizeFolderRow).filter(Boolean) as Folder[];
      if (requestSeq !== loadFoldersRequestRef.current) return;
      setFolders(normalized);
      onFoldersChange?.(normalized);

      if (normalized.length > 0) {
        setFoldersError(null);

        const fallback = normalized[0].id;

        setUploadFolderId((prev) => {
          if (prev && normalized.some((f) => f.id === prev)) return prev;
          if (initialFolderId && normalized.some((f) => f.id === initialFolderId)) return initialFolderId;
          return fallback;
        });

        setListFolderId((prev) => {
          if (prev && normalized.some((f) => f.id === prev)) return prev;
          if (initialFolderId && normalized.some((f) => f.id === initialFolderId)) return initialFolderId;
          return fallback;
        });
      } else {
        setUploadFolderId(null);
        setListFolderId(null);
        setFoldersError("Ingen mapper fundet endnu (opret en mappe længere nede).");
      }
    } catch (e) {
      console.error("[UploadClient] loadFolders error", e);
      if (requestSeq !== loadFoldersRequestRef.current) return;
      setFoldersError("Mapper opdateres lige nu.");
    } finally {
      if (requestSeq === loadFoldersRequestRef.current) {
        setFoldersLoading(false);
      }
    }
  }, [initialFolderId, onFoldersChange]);

  const loadFiles = useCallback(async (folderId: string | null) => {
    const requestSeq = ++loadFilesRequestRef.current;
    if (!folderId) {
      setFiles([]);
      setFileReadinessById({});
      setFilesLoading(false);
      setFilesError(null);
      return { files: [] as FileRow[], readinessById: {} as Record<string, FileReadiness> };
    }

    setFilesLoading(true);
    setFilesError(null);

    try {
      const filesUrl = `/api/files?folder_id=${encodeURIComponent(folderId)}`;
      const [res, readinessRes] = await Promise.all([
        fetch(filesUrl, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } }),
        fetch(`/api/import-status?folder_id=${encodeURIComponent(folderId)}`, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
      ]);
      const text = await res.text();
      const json = safeJson(text);
      const readinessText = await readinessRes.text();
      const readinessJson = (safeJson(readinessText) ?? {}) as ImportStatusPayload;

      if (res.status === 401) {
        if (requestSeq !== loadFilesRequestRef.current) return null;
        setFilesError("Filer opdateres lige nu.");
        return null;
      }

      if (!res.ok) {
        if (requestSeq !== loadFilesRequestRef.current) return null;
        setFilesError("Filer opdateres lige nu.");
        return null;
      }

      if (!json || json.ok === false) {
        if (requestSeq !== loadFilesRequestRef.current) return null;
        setFilesError("Filer opdateres lige nu.");
        return null;
      }

      const raw = Array.isArray(json.files) ? json.files : Array.isArray(json.items) ? json.items : [];
      const normalized = raw.map(normalizeFileRow).filter(Boolean) as FileRow[];
      const visibleRows = omitSuppressedFiles(normalized, suppressedFileIdsRef.current);
      const readinessRows = Array.isArray(readinessJson.folderFiles) ? readinessJson.folderFiles : [];
      const readinessById = buildReadinessMap(
        readinessRows.filter((row) => row?.id && !suppressedFileIdsRef.current[String(row.id)]),
      );
      if (requestSeq !== loadFilesRequestRef.current) {
        return { files: visibleRows, readinessById };
      }
      setFiles(visibleRows);
      setFileReadinessById(readinessById);
      return { files: visibleRows, readinessById };
    } catch (e) {
      console.error("[UploadClient] loadFiles error", e);
      if (requestSeq !== loadFilesRequestRef.current) return null;
      setFilesError("Filer opdateres lige nu.");
      return null;
    } finally {
      if (requestSeq === loadFilesRequestRef.current) {
        setFilesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadFiles(listFolderId);
  }, [listFolderId, loadFiles]);

  useEffect(() => {
    lastActiveUploadRefreshRef.current = 0;
  }, [activeUpload?.requestId]);

  useEffect(() => {
    return () => {
      if (uploadReadyRefreshTimeoutRef.current != null) {
        window.clearTimeout(uploadReadyRefreshTimeoutRef.current);
      }
    };
  }, []);

  function onPickFile(f: File | null) {
    setUploadError(null);
    setUploadNotice(null);
    setUploadResult(null);
    setDeleteErrorsById({});

    if (f && isPdfFile(f) && typeof f.size === "number" && f.size > MAX_FILE_BYTES) {
      setPickedFile(null);
      setUploadError(PDF_TOO_LARGE_ERROR);
      return;
    }

    setPickedFile(f);
  }

  const precheckQuota = useCallback(async (force = false) => {
    try {
      const json = await fetchQuotaCurrent({ force });
      if (!json?.ok) return false;

      const { used, limit } = pickImportQuota(json);
      if (typeof limit === "number" && limit > 0) {
        const remaining = Math.max(0, limit - used);
        if (remaining <= 0) {
          setQuotaBlocked(MONTHLY_IMPORT_QUOTA_ERROR);
          setUploadError(null);
          return true;
        }
      }

      setQuotaBlocked(null);
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    void precheckQuota();

    const onQuota = () => void precheckQuota(true);
    window.addEventListener("notely-quota-changed", onQuota);
    return () => window.removeEventListener("notely-quota-changed", onQuota);
  }, [precheckQuota]);

  const hasValidUploadFolder = !!uploadFolderId && folderOptions.some((folder) => folder.id === uploadFolderId);
  const canUpload = !!pickedFile && hasValidUploadFolder && !uploading && !quotaBlocked && !foldersLoading;
  const processingStatusText = describeProcessingStage(activeUpload);
  const visibleFiles = useMemo(
    () => mergeVisibleFileRows(files, listFolderId, localFileStatusesById, suppressedFileIds),
    [files, listFolderId, localFileStatusesById, suppressedFileIds],
  );

  const upsertLocalFileStatus = useCallback((nextStatus: LocalFileStatus) => {
    setLocalFileStatusesById((prev) => {
      const current = prev[nextStatus.fileId] ?? null;
      return {
        ...prev,
        [nextStatus.fileId]: mergeLocalFileStatus(current, nextStatus),
      };
    });
  }, []);

  const removeLocalFileStatus = useCallback((fileId: string | null | undefined) => {
    if (!fileId) return;
    setLocalFileStatusesById((prev) => {
      if (!(fileId in prev)) return prev;
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  }, []);

  const setRowDeleteError = useCallback((fileId: string | null | undefined, message: string) => {
    if (!fileId) return;
    setDeleteErrorsById((prev) => ({ ...prev, [fileId]: message }));
  }, []);

  const clearRowDeleteError = useCallback((fileId: string | null | undefined) => {
    if (!fileId) return;
    setDeleteErrorsById((prev) => {
      if (!(fileId in prev)) return prev;
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  }, []);

  const removeFileReadiness = useCallback((fileId: string | null | undefined) => {
    if (!fileId) return;
    setFileReadinessById((prev) => {
      if (!(fileId in prev)) return prev;
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  }, []);

  const suppressFile = useCallback((fileId: string | null | undefined) => {
    if (!fileId) return;
    setSuppressedFileIds((prev) => {
      if (prev[fileId]) return prev;
      const next: Record<string, true> = { ...prev, [fileId]: true };
      suppressedFileIdsRef.current = next;
      return next;
    });
  }, []);

  const unsuppressFile = useCallback((fileId: string | null | undefined) => {
    if (!fileId) return;
    setSuppressedFileIds((prev) => {
      if (!(fileId in prev)) return prev;
      const next = { ...prev };
      delete next[fileId];
      suppressedFileIdsRef.current = next;
      return next;
    });
  }, []);

  const isFileSuppressed = useCallback((fileId: string | null | undefined) => {
    if (!fileId) return false;
    return !!suppressedFileIdsRef.current[fileId];
  }, []);

  const isPersistedFileRow = useCallback((fileId: string | null | undefined) => {
    if (!fileId) return false;
    return files.some((file) => file.id === fileId);
  }, [files]);

  const resolveFileStatus = useCallback(
    (file: FileRow) => {
      const localStatus = localFileStatusesById[file.id]
        ? buildUserFileStatus(localFileStatusesById[file.id]!.status, localFileStatusesById[file.id]!.error)
        : null;
      const serverStatus = mapReadinessToUserStatus(fileReadinessById[file.id] ?? null);
      return pickDisplayStatus(localStatus, serverStatus);
    },
    [fileReadinessById, localFileStatusesById],
  );

  const refreshActiveUploadFiles = useCallback(
    async (upload: ActiveUpload | null, reason: string, force = false) => {
      if (!upload || !upload.responseSettled) return null;
      if (isFileSuppressed(upload.fileId)) return null;
      const currentFolderId = listFolderIdRef.current;
      if (!currentFolderId || currentFolderId !== upload.folderId) return null;

      const now = Date.now();
      if (!force && now - lastActiveUploadRefreshRef.current < ACTIVE_UPLOAD_REFRESH_MS) {
        return null;
      }

      lastActiveUploadRefreshRef.current = now;
      console.info("[UploadClient] refreshing visible upload file list", {
        requestId: upload.requestId,
        fileId: upload.fileId,
        fileName: upload.fileName,
        folderId: upload.folderId,
        reason,
        force,
      });
      return await loadFiles(currentFolderId);
    },
    [isFileSuppressed, loadFiles],
  );

  const refreshCompletedUploadFiles = useCallback(
    async (upload: ActiveUpload | null, reason: string, skipImmediateRefresh = false) => {
      if (isFileSuppressed(upload?.fileId)) return;
      const folderId = upload?.folderId ?? listFolderIdRef.current ?? uploadFolderId;
      const shouldRefreshVisibleFolder = !!folderId && listFolderIdRef.current === folderId;

      if (shouldRefreshVisibleFolder && !skipImmediateRefresh) {
        console.info("[UploadClient] refreshing file list after completed upload", {
          requestId: upload?.requestId ?? null,
          folderId,
          reason,
        });
        await loadFiles(folderId);
      }

      if (uploadReadyRefreshTimeoutRef.current != null) {
        window.clearTimeout(uploadReadyRefreshTimeoutRef.current);
      }

      if (shouldRefreshVisibleFolder && folderId) {
        uploadReadyRefreshTimeoutRef.current = window.setTimeout(() => {
          console.info("[UploadClient] running follow-up file list refresh", {
            requestId: upload?.requestId ?? null,
            folderId,
            reason,
          });
          void loadFiles(folderId);
        }, UPLOAD_READY_FOLLOWUP_REFRESH_MS);
      }
    },
    [isFileSuppressed, loadFiles, uploadFolderId],
  );

  useEffect(() => {
    if (!activeUpload?.fileId) return;
    if (!isFileSuppressed(activeUpload.fileId)) return;

    console.info("[UploadClient] stopping local polling for removed file", {
      requestId: activeUpload.requestId,
      fileId: activeUpload.fileId,
    });
    setActiveUpload(null);
    setUploading(false);
  }, [activeUpload, isFileSuppressed, suppressedFileIds]);

  useEffect(() => {
    if (!activeUpload) return;
    if (isFileSuppressed(activeUpload.fileId)) return;
    if (!activeUpload.responseSettled) return;
    if (activeUpload.kind !== "pdf") return;
    if (listFolderId !== activeUpload.folderId) return;

    const matchedFile = findMatchingUploadFile(activeUpload, visibleFiles);
    if (!matchedFile) return;
    const readiness = fileReadinessById[matchedFile.id] ?? null;
    if (!readiness?.ready) return;

    console.info("[UploadClient] stopping processing state because file is ready", {
      requestId: activeUpload.requestId,
      fileId: matchedFile.id,
      fileName: activeUpload.fileName,
      folderId: activeUpload.folderId,
      readiness: readiness.readiness,
      chunkCount: readiness.chunkCount,
    });
    upsertLocalFileStatus({
      fileId: matchedFile.id,
      fileName: matchedFile.name,
      folderId: activeUpload.folderId,
      sizeBytes: matchedFile.sizeBytes,
      uploadedAt: matchedFile.uploadedAt,
      status: "ready",
      error: null,
      updatedAt: Date.now(),
    });
    void refreshCompletedUploadFiles(activeUpload, "visible-file-ready", true);
    setUploadNotice("Materialet er klar nu.");
    setActiveUpload(null);
    setUploading(false);
    dispatchQuotaChanged();
  }, [
    activeUpload,
    dispatchQuotaChanged,
    fileReadinessById,
    listFolderId,
    refreshCompletedUploadFiles,
    isFileSuppressed,
    upsertLocalFileStatus,
    visibleFiles,
  ]);

  function readinessTone(status: UserFileStatus | null) {
    if (!status) return "border-transparent bg-transparent text-transparent";
    if (status.kind === "failed") return "border-red-200 bg-red-50 text-red-700";
    if (status.kind === "enhancing") return "border-sky-200 bg-sky-50 text-sky-700";
    if (status.kind === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    return "border-zinc-200 bg-zinc-50 text-zinc-700";
  }

  function fileListBadgeLabel(status: UserFileStatus | null) {
    if (!status || status.kind === "ready") return null;
    return status.label;
  }

  function fileListStatusDetail(status: UserFileStatus | null) {
    return status?.kind === "failed" || status?.kind === "enhancing" ? status.detail : null;
  }

  useEffect(() => {
    if (!activeUpload) return;
    if (isFileSuppressed(activeUpload.fileId)) return;

    let cancelled = false;
    let nextDelayMs = UPLOAD_STATUS_POLL_MS;
    let timeoutId: number | null = null;
    console.info("[UploadClient] polling started", {
      requestId: activeUpload.requestId,
      fileName: activeUpload.fileName,
      startedAt: activeUpload.startedAt,
    });

    const stopWithError = (message: string, reason: string) => {
      if (cancelled) return;
      if (activeUpload.fileId) {
        upsertLocalFileStatus({
          fileId: activeUpload.fileId,
          fileName: activeUpload.fileName,
          folderId: activeUpload.folderId,
          sizeBytes: visibleFiles.find((file) => file.id === activeUpload.fileId)?.sizeBytes ?? null,
          uploadedAt: visibleFiles.find((file) => file.id === activeUpload.fileId)?.uploadedAt ?? null,
          status: "failed",
          error: message,
          updatedAt: Date.now(),
        });
      }
      uploadAbortReasonRef.current = message;
      uploadAbortRef.current?.abort(reason);
      clearPickedFileSelection(activeUpload.fileName);
      if (!activeUpload.fileId) {
        setUploadError(message);
      }
      setUploading(false);
      setActiveUpload(null);
      console.warn("[UploadClient] polling stopped with error", {
        requestId: activeUpload.requestId,
        reason,
        message,
      });
    };

    const poll = async () => {
      const elapsedMs = Date.now() - activeUpload.startedAt;
      const timeoutMs = activeUpload.kind === "pdf" ? PDF_UPLOAD_REQUEST_TIMEOUT_MS : DEFAULT_UPLOAD_REQUEST_TIMEOUT_MS;
      if (elapsedMs > timeoutMs) {
        if (!cancelled) {
          setUploadNotice(
            activeUpload.kind === "pdf"
              ? "Uploaden tager længere tid end forventet. Materialet kan stadig være på vej."
              : "Uploaden tog længere tid end forventet. Prøv at opdatere om lidt.",
          );
          setUploading(false);
          setActiveUpload(null);
          console.warn("[UploadClient] polling stopped after timeout", {
            requestId: activeUpload.requestId,
            elapsedMs,
            timeoutMs,
          });
        }
        return;
      }

      try {
        const statusQuery = activeUpload.jobId
          ? `job_id=${encodeURIComponent(activeUpload.jobId)}`
          : `request_id=${encodeURIComponent(activeUpload.requestId)}`;
        const res = await fetch(`/api/import-status?${statusQuery}`, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (res.status === 401 || res.status === 429) {
          nextDelayMs = UPLOAD_STATUS_BACKOFF_MS;
          console.warn("[UploadClient] polling temporary auth/status issue", {
            requestId: activeUpload.requestId,
            status: res.status,
            nextDelayMs,
          });
          return;
        }

        const text = await res.text();
        const json = (safeJson(text) ?? {}) as ImportStatusPayload;
        const activeJob = json?.activeJob ?? null;

        console.info("[UploadClient] polling tick", {
          requestId: activeUpload.requestId,
          responseOk: res.ok,
          activeJobId: activeJob?.id ?? null,
          activeJobStatus: activeJob?.status ?? null,
          activeJobStage: activeJob?.stage ?? null,
          responseSettled: activeUpload.responseSettled,
        });

        if (activeJob?.id) {
          setActiveUpload((prev) =>
            prev && prev.requestId === activeUpload.requestId
              ? mergeActiveUploadState(prev, {
                  jobId: asString(activeJob.id),
                  fileId: asString(activeJob.fileId),
                  folderId: asString(activeJob.folderId) ?? prev.folderId,
                  status: asString(activeJob.status),
                  stage: asString(activeJob.stage),
                })
              : prev,
          );
        }

        const normalizedJobStatus = String(activeJob?.status ?? "").toLowerCase();
        const normalizedJobStage = String(activeJob?.stage ?? "").toLowerCase();
        nextDelayMs = getUploadPollDelayMs(elapsedMs);

        if (
          activeUpload.fileId &&
          (READY_STATUS_TOKENS.has(normalizedJobStatus) ||
            READY_STATUS_TOKENS.has(normalizedJobStage) ||
            BACKGROUND_STATUS_TOKENS.has(normalizedJobStatus) ||
            BACKGROUND_STATUS_TOKENS.has(normalizedJobStage))
        ) {
          if (!cancelled) {
            const matchedFile = findMatchingUploadFile(activeUpload, visibleFiles);
            upsertLocalFileStatus({
              fileId: activeUpload.fileId,
              fileName: matchedFile?.name ?? activeUpload.fileName,
              folderId: activeUpload.folderId,
              sizeBytes: matchedFile?.sizeBytes ?? null,
              uploadedAt: matchedFile?.uploadedAt ?? null,
              status: "ready",
              error: null,
              updatedAt: Date.now(),
            });
            void refreshCompletedUploadFiles(activeUpload, "job-first-ready");
            setUploadNotice("Materialet er klar nu.");
            setActiveUpload(null);
            setUploading(false);
            dispatchQuotaChanged();
          }
          return;
        }

        const shouldForceRefresh =
          !!activeUpload.responseSettled &&
          (!activeJob ||
            READY_STATUS_TOKENS.has(normalizedJobStatus) ||
            READY_STATUS_TOKENS.has(normalizedJobStage));
        const refreshedSnapshot = await refreshActiveUploadFiles(
          activeUpload,
          !activeJob ? "active-job-missing" : shouldForceRefresh ? "job-finished" : "processing-reconcile",
          shouldForceRefresh,
        );
        if (refreshedSnapshot && isUploadReadyFromSnapshot(activeUpload, refreshedSnapshot.files, refreshedSnapshot.readinessById)) {
          if (!cancelled) {
            const matchedFile = findMatchingUploadFile(activeUpload, refreshedSnapshot.files);
            console.info("[UploadClient] stopping processing state after readiness refresh", {
              requestId: activeUpload.requestId,
              reason: !activeJob ? "active-job-missing" : normalizedJobStatus || "processing",
            });
            if (matchedFile?.id) {
              upsertLocalFileStatus({
                fileId: matchedFile.id,
                fileName: matchedFile.name,
                folderId: activeUpload.folderId,
                sizeBytes: matchedFile.sizeBytes,
                uploadedAt: matchedFile.uploadedAt,
                status: "ready",
                error: null,
                updatedAt: Date.now(),
              });
            }
            void refreshCompletedUploadFiles(activeUpload, "polling-readiness-refresh", true);
            setUploadNotice("Materialet er klar nu.");
            setActiveUpload(null);
            setUploading(false);
            dispatchQuotaChanged();
          }
          return;
        }

        if (!activeJob && elapsedMs > UPLOAD_JOB_BOOT_TIMEOUT_MS) {
          console.info("[UploadClient] waiting for job start", {
            requestId: activeUpload.requestId,
            elapsedMs,
            timeoutMs,
          });
        }

        if (normalizedJobStatus === "failed") {
          stopWithError(activeJob?.error ?? "Uploaden fejlede under behandlingen.", "job-failed");
          if (listFolderIdRef.current === activeUpload.folderId) {
            void loadFiles(activeUpload.folderId);
          }
          return;
        }

        if (READY_STATUS_TOKENS.has(normalizedJobStatus) || READY_STATUS_TOKENS.has(normalizedJobStage)) {
          if (!cancelled) {
            if (activeUpload.fileId) {
              const matchedFile = findMatchingUploadFile(activeUpload, visibleFiles);
              upsertLocalFileStatus({
                fileId: activeUpload.fileId,
                fileName: matchedFile?.name ?? activeUpload.fileName,
                folderId: activeUpload.folderId,
                sizeBytes: matchedFile?.sizeBytes ?? null,
                uploadedAt: matchedFile?.uploadedAt ?? null,
                status: "ready",
                error: null,
                updatedAt: Date.now(),
              });
            }
            void refreshCompletedUploadFiles(activeUpload, "job-finished");
            setUploadNotice("Materialet er klar nu.");
            setActiveUpload(null);
            dispatchQuotaChanged();
          }
          return;
        }
      } catch (error) {
        if (!cancelled) {
          nextDelayMs = UPLOAD_STATUS_BACKOFF_MS;
          console.warn("[UploadClient] polling error", {
            requestId: activeUpload.requestId,
            error,
            nextDelayMs,
          });
        }
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      timeoutId = window.setTimeout(async () => {
        await poll();
        scheduleNext();
      }, nextDelayMs);
    };

    void poll().finally(() => scheduleNext());

    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      console.info("[UploadClient] polling stopped", {
        requestId: activeUpload.requestId,
      });
    };
  }, [
    activeUpload,
    dispatchQuotaChanged,
    isFileSuppressed,
    loadFiles,
    refreshActiveUploadFiles,
    refreshCompletedUploadFiles,
    uploadFolderId,
    upsertLocalFileStatus,
    visibleFiles,
  ]);

  async function doUpload() {
    if (!hasValidUploadFolder) {
      setUploadError("Du skal oprette eller vælge en mappe, før du kan uploade materiale.");
      return;
    }
    if (!pickedFile || !uploadFolderId) return;
    if (quotaBlocked) return;

    const blocked = await precheckQuota(true);
    if (blocked) return;

    setUploading(true);
    setUploadError(null);
    setUploadNotice(null);
    setUploadResult(null);
    setDeleteErrorsById({});
    uploadAbortReasonRef.current = null;
    dispatchUploadActivity(true);

    let keepPollingAfterResponse = false;
    let pendingFileId: string | null = null;
    let optimisticUploadedAt: string | null = null;

    try {
      const clientRequestId = createClientRequestId();
      const selectedUploadKind = isAudioFile(pickedFile) ? "audio" : "pdf";

      const controller = new AbortController();
      uploadAbortRef.current = controller;
      setActiveUpload({
        requestId: clientRequestId,
        startedAt: Date.now(),
        fileName: pickedFile.name,
        folderId: uploadFolderId,
        jobId: null,
        fileId: null,
        responseSettled: false,
        kind: selectedUploadKind,
        status: null,
        stage: null,
      });
      console.info("[UploadClient] upload started", {
        requestId: clientRequestId,
        fileName: pickedFile.name,
        folderId: uploadFolderId,
        sizeBytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
      });

      let res: Response;
      let responseText = "";
      let data: any = {};

      if (selectedUploadKind === "pdf") {
        const initRes = await fetch("/api/trainer/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            request_id: clientRequestId,
            folder_id: uploadFolderId,
            file_name: pickedFile.name,
            mime_type: pickedFile.type || "application/pdf",
            size_bytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
          }),
        });
        const initResponseText = await initRes.text();
        const initData = safeJson(initResponseText) ?? {};

        if (!initRes.ok) {
          clearPickedFileSelection(pickedFile.name);
          setUploadError(
            resolveUploadErrorMessage(initRes.status, initData, pickedFile, {
              res: initRes,
              responseText: initResponseText,
            }),
          );
          return;
        }

        const bucket = asString(initData?.storage?.bucket);
        const storagePath = asString(initData?.storage?.path);
        const uploadToken = asString(initData?.storage?.token);
        const initFileId = asString(initData?.fileId);

        if (!bucket || !storagePath || !uploadToken || !initFileId) {
          clearPickedFileSelection(pickedFile.name);
          setUploadError("Kunne ikke starte storage-uploaden. Prøv igen.");
          return;
        }

        setActiveUpload((prev) =>
          prev && prev.requestId === clientRequestId
            ? mergeActiveUploadState(prev, { fileId: initFileId })
            : prev,
        );
        pendingFileId = initFileId;

        const supabase = createBrowserClient();
        const storageUpload = await supabase.storage.from(bucket).uploadToSignedUrl(storagePath, uploadToken, pickedFile, {
          upsert: false,
          contentType: pickedFile.type || "application/pdf",
        });

        if (storageUpload.error) {
          clearPickedFileSelection(pickedFile.name);
          setUploadError(storageUpload.error.message || "Kunne ikke sende filen direkte til storage.");
          return;
        }

        optimisticUploadedAt = new Date().toISOString();
        if (!isFileSuppressed(initFileId)) {
          upsertLocalFileStatus({
            fileId: initFileId,
            fileName: pickedFile.name,
            folderId: uploadFolderId,
            sizeBytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
            uploadedAt: optimisticUploadedAt,
            status: "uploaded",
            error: null,
            updatedAt: Date.now(),
          });
        }

        res = await fetch("/api/trainer/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            request_id: clientRequestId,
            folder_id: uploadFolderId,
            file_id: initFileId,
            storage_path: storagePath,
            file_name: pickedFile.name,
            mime_type: pickedFile.type || "application/pdf",
            size_bytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
          }),
          signal: controller.signal,
        });
      } else {
        const fd = new FormData();
        fd.append("file", pickedFile);
        fd.append("folder_id", uploadFolderId);
        fd.append("request_id", clientRequestId);
        fd.append("audio_note_mode", audioNoteMode);
        res = await fetch("/api/trainer/upload", { method: "POST", body: fd, signal: controller.signal });
      }
      responseText = await res.text();
      data = safeJson(responseText) ?? {};
      setActiveUpload((prev) =>
        prev && prev.requestId === clientRequestId
          ? mergeActiveUploadState(prev, {
              responseSettled: true,
              jobId: asString(data?.jobId),
              fileId: asString(data?.fileId),
              status: asString(data?.jobStatus),
              stage: asString(data?.stage),
            })
          : prev,
      );

      if (res.status === 402 || res.status === 429) {
        const msg = resolveUploadErrorMessage(res.status, data, pickedFile, {
          res,
          responseText,
        });
        if (pendingFileId && !isFileSuppressed(pendingFileId)) {
          upsertLocalFileStatus({
            fileId: pendingFileId,
            fileName: pickedFile.name,
            folderId: uploadFolderId,
            sizeBytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
            uploadedAt: optimisticUploadedAt,
            status: "failed",
            error: msg,
            updatedAt: Date.now(),
          });
        }
        clearPickedFileSelection(pickedFile.name);
        setQuotaBlocked(msg);
        dispatchQuotaChanged();
        return;
      }

      if (res.status === 409) {
        const j = data;
        const msg = String(
          j?.message ??
            j?.error ??
            "Denne fil er allerede uploadet. Du kan ikke uploade den samme fil to gange.",
        );
        removeLocalFileStatus(pendingFileId);
        clearPickedFileSelection(pickedFile.name);
        setUploadNotice(msg);
        return;
      }

      if (res.status === 401) {
        const j = data;
        if (pendingFileId && !isFileSuppressed(pendingFileId)) {
          upsertLocalFileStatus({
            fileId: pendingFileId,
            fileName: pickedFile.name,
            folderId: uploadFolderId,
            sizeBytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
            uploadedAt: optimisticUploadedAt,
            status: "failed",
            error: String(j?.error ?? "Login kræves."),
            updatedAt: Date.now(),
          });
        }
        clearPickedFileSelection(pickedFile.name);
        setUploadError(String(j?.error ?? "Login kræves."));
        return;
      }

      if (res.status === 413) {
        const message = resolveUploadErrorMessage(res.status, data, pickedFile, {
          res,
          responseText,
        });
        if (pendingFileId && !isFileSuppressed(pendingFileId)) {
          upsertLocalFileStatus({
            fileId: pendingFileId,
            fileName: pickedFile.name,
            folderId: uploadFolderId,
            sizeBytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
            uploadedAt: optimisticUploadedAt,
            status: "failed",
            error: message,
            updatedAt: Date.now(),
          });
        }
        clearPickedFileSelection(pickedFile.name);
        setUploadError(message);
        return;
      }

      if (res.status === 403) {
        const j = data;
        if (pendingFileId && !isFileSuppressed(pendingFileId)) {
          upsertLocalFileStatus({
            fileId: pendingFileId,
            fileName: pickedFile.name,
            folderId: uploadFolderId,
            sizeBytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
            uploadedAt: optimisticUploadedAt,
            status: "failed",
            error: String(j?.message ?? j?.error ?? "Handlingen er ikke tilgængelig lige nu."),
            updatedAt: Date.now(),
          });
        }
        clearPickedFileSelection(pickedFile.name);
        setUploadNotice(String(j?.message ?? j?.error ?? "Handlingen er ikke tilgængelig lige nu."));
        return;
      }

      if (!res.ok) {
        const message = resolveUploadErrorMessage(res.status, data, pickedFile, {
          res,
          responseText,
        });
        if (pendingFileId && !isFileSuppressed(pendingFileId)) {
          upsertLocalFileStatus({
            fileId: pendingFileId,
            fileName: pickedFile.name,
            folderId: uploadFolderId,
            sizeBytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
            uploadedAt: optimisticUploadedAt,
            status: "failed",
            error: message,
            updatedAt: Date.now(),
          });
        }
        clearPickedFileSelection(pickedFile.name);
        setUploadError(message);
        return;
      }

      console.info("[UploadClient] upload finished", {
        requestId: clientRequestId,
        returnedRequestId: data?.requestId ?? null,
        returnedJobId: data?.jobId ?? null,
        fileId: data?.fileId ?? null,
        uploadKind: data?.uploadKind ?? null,
      });
      setUploadError(null);
      const uploadKind = data?.uploadKind === "audio" ? "audio" : "pdf";
      const responseStage = normalizeStatusToken(asString(data?.stage));
      const responseJobStatus = normalizeStatusToken(asString(data?.jobStatus));
      const responseAlreadyReady =
        READY_STATUS_TOKENS.has(responseStage) ||
        READY_STATUS_TOKENS.has(responseJobStatus) ||
        BACKGROUND_STATUS_TOKENS.has(responseStage) ||
        BACKGROUND_STATUS_TOKENS.has(responseJobStatus);
      const processingAccepted =
        uploadKind === "pdf" &&
        !responseAlreadyReady &&
        (res.status === 202 || data?.processing === true || data?.accepted === true);
      const noteCount = Array.isArray(data?.generatedNotes) ? data.generatedNotes.length : 0;
      const generatedNotes = Array.isArray(data?.generatedNotes) ? (data.generatedNotes as GeneratedUploadNote[]) : [];
      const notesHistoryHref = uploadFolderId ? `/traener/noter/historik?scope=${encodeURIComponent(uploadFolderId)}` : "/traener/noter/historik";

      keepPollingAfterResponse = processingAccepted;
      setUploading(false);
      if (pendingFileId && uploadKind === "pdf" && !isFileSuppressed(pendingFileId)) {
        upsertLocalFileStatus({
          fileId: pendingFileId,
          fileName: pickedFile.name,
          folderId: uploadFolderId,
          sizeBytes: typeof pickedFile.size === "number" ? pickedFile.size : null,
          uploadedAt: optimisticUploadedAt,
          status: processingAccepted ? "preparing" : "ready",
          error: null,
          updatedAt: Date.now(),
        });
      }

      setPickedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadResult(
        uploadKind === "audio"
          ? {
              kind: "audio",
              fileName: pickedFile.name,
              noteCount,
              audioNoteMode,
              message:
                noteCount > 0
                  ? `Lydfil modtaget. Vi gør den klar nu. ${noteCount === 1 ? "1 note" : `${noteCount} noter`} ligger under Noter.`
                  : "Lydfil modtaget. Vi gør den klar nu. Se resultatet under Noter.",
            }
          : {
              kind: "pdf",
              fileName: pickedFile.name,
              message: processingAccepted
                ? "Fil modtaget. Materialet bliver gjort klar til brug i Notely."
                : "Fil modtaget og klar til brug i Notely.",
            },
      );
      dispatchQuotaChanged();

      if (listFolderIdRef.current === uploadFolderId) {
        await loadFiles(uploadFolderId);
      }

      if (!processingAccepted) {
        setActiveUpload(null);
      } else {
        setActiveUpload((prev) =>
          prev && prev.requestId === clientRequestId
            ? mergeActiveUploadState(prev, {
                responseSettled: true,
                jobId: asString(data?.jobId),
                fileId: asString(data?.fileId),
                status: asString(data?.jobStatus) ?? "queued",
                stage: asString(data?.stage) ?? "queued",
              })
            : prev,
        );
      }

      if (uploadKind === "audio" && generatedNotes.length > 0) {
        const firstNoteId = String(generatedNotes[0]?.id ?? "").trim();
        if (generatedNotes.length === 1 && firstNoteId) {
          router.push(`/notes/${encodeURIComponent(firstNoteId)}?back=${encodeURIComponent(notesHistoryHref)}`);
        } else {
          router.push(notesHistoryHref);
        }
        return;
      }
    } catch (e) {
      if ((e as any)?.name === "AbortError") {
        const reason = uploadAbortReasonRef.current ?? "Uploaden blev afbrudt. Prøv igen.";
        console.warn("[UploadClient] upload aborted", { reason });
        if (pendingFileId && uploadAbortReasonRef.current && !isFileSuppressed(pendingFileId)) {
          upsertLocalFileStatus({
            fileId: pendingFileId,
            fileName: pickedFile?.name ?? activeUpload?.fileName ?? "Upload",
            folderId: uploadFolderId,
            sizeBytes: typeof pickedFile?.size === "number" ? pickedFile.size : null,
            uploadedAt: optimisticUploadedAt,
            status: "failed",
            error: reason,
            updatedAt: Date.now(),
          });
        }
        if (uploadAbortReasonRef.current) {
          clearPickedFileSelection(pickedFile?.name ?? activeUpload?.fileName ?? null);
          setUploadError(reason);
        }
      } else {
        console.error("[UploadClient] upload error", e);
        if (pendingFileId && !isFileSuppressed(pendingFileId)) {
          upsertLocalFileStatus({
            fileId: pendingFileId,
            fileName: pickedFile?.name ?? activeUpload?.fileName ?? "Upload",
            folderId: uploadFolderId,
            sizeBytes: typeof pickedFile?.size === "number" ? pickedFile.size : null,
            uploadedAt: optimisticUploadedAt,
            status: "failed",
            error: "Upload fejlede. Prøv igen.",
            updatedAt: Date.now(),
          });
        }
        clearPickedFileSelection(pickedFile?.name ?? activeUpload?.fileName ?? null);
        setUploadError("Upload fejlede. Prøv igen.");
      }
    } finally {
      uploadAbortRef.current = null;
      uploadAbortReasonRef.current = null;
      if (!keepPollingAfterResponse) {
        setActiveUpload(null);
      }
      setUploading(false);
      dispatchUploadActivity(false);
    }
  }

  async function moveFile(fileId: string, newFolderId: string) {
    setMoveError(null);
    setMoveNotice(null);
    setMovingId(fileId);

    const prevFolderId = visibleFiles.find((x) => x.id === fileId)?.folderId ?? null;
    const currentList = listFolderIdRef.current;
    const destName = folderOptions.find((x) => x.id === newFolderId)?.name ?? "den nye mappe";

    // optimistic update (så dropdown skifter med det samme)
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, folderId: newFolderId } : f)));

    let res: Response | null = null;

    try {
      res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ folder_id: newFolderId }),
      });
    } catch {
      res = null;
    }

    if (!res || !res.ok) {
      const j = res ? safeJson(await res.text()) : null;
      setMoveError(String(j?.error ?? j?.message ?? "Kunne ikke flytte filen. (Tjek API/RLS)"));

      // revert optimistic
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, folderId: prevFolderId } : f)));
      setMovingId(null);
      return;
    }

    // Hvis du flytter væk fra den mappe du står og kigger i: filen forsvinder fra listen (korrekt)
    if (currentList && prevFolderId === currentList && newFolderId !== currentList) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      setMoveNotice(`Filen er flyttet til "${destName}". Skift mappe for at se den.`);
    } else {
      await loadFiles(currentList);
      setMoveNotice(`Filen er flyttet til "${destName}".`);
    }

    setMovingId(null);
    dispatchImportStatusRefresh();
  }

  async function deleteFile(fileId: string) {
    const file = visibleFiles.find((x) => x.id === fileId);
    const name = file?.name ?? "filen";
    const currentList = listFolderIdRef.current;

    const ok = window.confirm(
      `Er du sikker på, at du vil slette "${name}"?\n\n` +
        `Filen bliver slettet permanent.\n` +
        `Bemærk: Sletning giver ikke sider tilbage i denne måned.`,
    );

    if (!ok) return;

    const isLocalOnlyRow = !isPersistedFileRow(fileId);
    clearRowDeleteError(fileId);
    setDeletingId(fileId);
    suppressFile(fileId);
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    removeFileReadiness(fileId);
    removeLocalFileStatus(fileId);
    clearPickedFileSelection(name);

    if (activeUpload?.fileId === fileId) {
      uploadAbortRef.current?.abort("delete-file");
      setActiveUpload(null);
      setUploading(false);
    }

    if (isLocalOnlyRow) {
      setDeletingId(null);
      return;
    }

    let res: Response | null = null;

    try {
      res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    } catch {
      res = null;
    }

    if (!res || res.status === 404) {
      try {
        res = await fetch(`/api/files?fileId=${encodeURIComponent(fileId)}`, { method: "DELETE" });
      } catch {
        res = null;
      }
    }

    if (!res || !res.ok) {
      const j = res ? safeJson(await res.text()) : null;
      unsuppressFile(fileId);
      await loadFiles(currentList);
      setRowDeleteError(fileId, String(j?.error ?? j?.message ?? "Kunne ikke slette filen. Prøv igen."));
      setDeletingId(null);
      return;
    }

    clearRowDeleteError(fileId);
    setDeletingId(null);
    dispatchImportStatusRefresh();
  }

  return (
    <div className="space-y-6">
      {/* Upload card */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-zinc-900">Upload materiale</div>
        <div className="mt-1 text-xs text-zinc-600">
          Vælg mappe og upload PDF eller lyd. Upload-siden er kun til indlevering; du ser og arbejder med output under Noter.
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium text-zinc-900">Mappe</div>

          <select
            className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
            value={uploadFolderId ?? ""}
            onChange={(e) => setUploadFolderId(e.target.value || null)}
            disabled={foldersLoading || folderOptions.length === 0}
          >
            {foldersLoading ? <option value="">Indlæser...</option> : null}
            {!foldersLoading && folderOptions.length === 0 ? <option value="">Ingen mapper</option> : null}
            {!foldersLoading &&
              folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>

          <div className="mt-1 text-[11px] text-zinc-500">
            Mapper styrer, hvilket fag/forløb materialet bliver knyttet til.
          </div>
          {foldersError ? <div className="mt-2 text-[11px] text-zinc-600">{foldersError}</div> : null}
          {!foldersLoading && !hasValidUploadFolder ? (
            <div className="mt-2 text-[11px] text-amber-700">
              <div>Du skal oprette eller vælge en mappe, før du kan uploade materiale.</div>
              <div>Opret en mappe under &quot;Mapper og perioder&quot; længere nede på siden.</div>
            </div>
          ) : null}
        </div>

        {/* Dropzone */}
        <label
          className={[
            "mt-4 block cursor-pointer rounded-2xl border border-dashed p-6 text-center",
            dragOver ? "border-zinc-700 bg-zinc-50" : "border-zinc-200 bg-white",
            uploading ? "opacity-60 cursor-default" : "",
          ].join(" ")}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            const f = e.dataTransfer?.files?.[0] ?? null;
            onPickFile(f);
          }}
        >
          <div className="text-sm font-medium text-zinc-900">Træk en PDF eller lydfil herind eller klik for at vælge.</div>
          <div className="mt-1 text-xs text-zinc-500">Understøtter PDF samt almindelige lydfiler som mp3, m4a, wav, webm og ogg.</div>
          <div className="mt-1 text-xs text-zinc-500">PDF: maks. 25 MB og 100 sider pr. fil.</div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium">Vælg fil</span>

            {pickedFile ? (
              <button
                type="button"
                className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPickedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Fjern
              </button>
            ) : null}
          </div>

          {pickedFile ? (
            <div className="mt-3 text-xs text-zinc-700">
              Valgt fil: <span className="font-medium">{pickedFile.name}</span>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,audio/*,.mp3,.m4a,.wav,.mp4,.mpeg,.mpga,.webm,.ogg,.oga,.flac,.aac"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              onPickFile(f);
            }}
          />
        </label>

        {isAudioFile(pickedFile) ? (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-xs font-medium text-zinc-900">Output til Noter</div>
            <div className="mt-1 text-[11px] text-zinc-600">
              Vælg hvad der skal oprettes fra lydfilen. Resultatet vises ikke her, men under Noter.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { value: "resume", label: "Resumé" },
                { value: "focus", label: "Fokus-noter" },
                { value: "both", label: "Begge" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAudioNoteMode(option.value as "resume" | "focus" | "both")}
                  className={[
                    "rounded-full border px-3 py-1.5 text-xs font-medium",
                    audioNoteMode === option.value
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 bg-white text-zinc-700",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {quotaBlocked ? <LimitNotice className="mt-4">{quotaBlocked}</LimitNotice> : null}
        {uploadNotice ? <LimitNotice className="mt-3">{uploadNotice}</LimitNotice> : null}
        {uploadError && !activeUpload ? <div className="mt-3 text-xs text-red-600">{uploadError}</div> : null}
        {processingStatusText ? <div className="mt-3 text-xs text-zinc-600">{processingStatusText}</div> : null}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void doUpload()}
            disabled={!canUpload}
            className="rounded-full bg-zinc-900 px-5 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {uploading ? "Uploader..." : "Upload fil"}
          </button>

          <button
            type="button"
            onClick={() => void loadFolders()}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium"
          >
            Opdater mapper
          </button>
        </div>
      </div>

      {/* Files list */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div>
          <div>
            <div className="text-sm font-semibold text-zinc-900">Materiale i dine mapper</div>
            <div className="mt-1 text-xs text-zinc-600">Viser PDF- og lydfiler i den mappe, du vælger herunder.</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="text-xs text-zinc-700">Vis filer i mappe:</div>

          <select
            className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs"
            value={listFolderId ?? ""}
            onChange={(e) => setListFolderId(e.target.value || null)}
            disabled={foldersLoading || folderOptions.length === 0}
          >
            {foldersLoading ? <option value="">Indlæser...</option> : null}
            {!foldersLoading && folderOptions.length === 0 ? <option value="">Ingen mapper</option> : null}
            {!foldersLoading &&
              folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </div>

        <div className="mt-3 min-h-[16px] text-xs text-zinc-600">{filesError ?? ""}</div>
        {moveError ? <div className="mt-3 text-xs text-red-600">{moveError}</div> : null}
        {moveNotice ? <div className="mt-3 text-xs text-zinc-700">{moveNotice}</div> : null}

        <div className="mt-4 space-y-3">
          {!filesLoading && (!listFolderId || visibleFiles.length === 0) ? (
            <div className="text-xs text-zinc-500">
              {listFolderId ? "Ingen filer i denne mappe endnu." : "Vælg en mappe."}
            </div>
          ) : null}

          {visibleFiles.map((f) => {
            const status = resolveFileStatus(f);
            const badgeLabel = fileListBadgeLabel(status);
            const statusDetail = fileListStatusDetail(status);
            const rowDeleteError = deleteErrorsById[f.id] ?? null;
            const isLocalOnlyRow = !isPersistedFileRow(f.id);
            const isTransientUpload = status?.kind === "uploaded" || status?.kind === "preparing";

            return (
              <div
                key={f.id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3"
              >
              <div>
                <div className="flex min-h-[28px] items-center gap-2">
                  <div className="text-sm font-medium text-zinc-900">{f.name}</div>
                  <span
                    className={`inline-flex min-w-[88px] items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-medium leading-none ${readinessTone(status)} ${badgeLabel ? "" : "invisible"}`}
                  >
                    {badgeLabel ?? "Klar"}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {humanBytes(f.sizeBytes)} {f.uploadedAt ? `· ${fmtDa(f.uploadedAt)}` : ""}
                  {statusDetail ? ` · ${statusDetail}` : ""}
                </div>
                {rowDeleteError ? <div className="mt-1 text-[11px] text-red-600">{rowDeleteError}</div> : null}
              </div>

              <div className="flex items-center gap-2">
                <select
                  className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs"
                  value={f.folderId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    if (!v) return;
                    void moveFile(f.id, v);
                  }}
                  disabled={
                    folderOptions.length === 0 || deletingId === f.id || movingId === f.id || isTransientUpload || isLocalOnlyRow
                  }
                  title="Flyt til anden mappe"
                >
                  {folderOptions.map((fo) => (
                    <option key={fo.id} value={fo.id}>
                      {fo.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => void deleteFile(f.id)}
                  disabled={deletingId === f.id || movingId === f.id}
                  className="rounded-full border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 disabled:opacity-40"
                >
                  {deletingId === f.id ? (isTransientUpload ? "Afbryder..." : "Sletter...") : "Slet"}
                </button>
              </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
