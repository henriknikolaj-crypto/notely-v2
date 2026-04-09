import "server-only";

export type NormalizedImportJob = {
  id: string;
  status: string | null;
  stage: string | null;
  error: string | null;
  requestId: string | null;
  fileId: string | null;
  folderId: string | null;
  uploadKind: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type MaterialReadinessState = "ready" | "processing" | "failed";

export type MaterialReadiness = {
  ready: boolean;
  state: MaterialReadinessState;
  label: string;
  detail: string | null;
  chunkCount: number;
  jobStatus: string | null;
  jobStage: string | null;
  jobId: string | null;
};

function strOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function isImportJobFinishedStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "finished" || normalized === "completed" || normalized === "succeeded";
}

export function isImportJobFailedStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toLowerCase() === "failed";
}

export function normalizeImportJobRow(row: any): NormalizedImportJob | null {
  const id = strOrNull(row?.id);
  if (!id) return null;

  return {
    id,
    status: strOrNull(row?.status),
    stage: strOrNull(row?.payload?.stage) ?? strOrNull(row?.meta?.stage),
    error:
      strOrNull(row?.error?.message) ??
      strOrNull(typeof row?.error === "string" ? row.error : null),
    requestId:
      strOrNull(row?.payload?.request_id) ??
      strOrNull(row?.meta?.request_id) ??
      strOrNull(row?.result?.requestId),
    fileId:
      strOrNull(row?.result?.fileId) ??
      strOrNull(row?.payload?.file_id) ??
      strOrNull(row?.meta?.file_id),
    folderId:
      strOrNull(row?.result?.folderId) ??
      strOrNull(row?.payload?.folder_id) ??
      strOrNull(row?.meta?.folder_id),
    uploadKind:
      strOrNull(row?.result?.uploadKind) ??
      strOrNull(row?.payload?.upload_kind) ??
      strOrNull(row?.meta?.upload_kind) ??
      strOrNull(row?.payload?.input_kind),
    queuedAt: strOrNull(row?.queued_at),
    startedAt: strOrNull(row?.started_at),
    finishedAt: strOrNull(row?.finished_at),
  };
}

export function resolveMaterialReadiness(args: {
  chunkCount: number;
  latestJob: NormalizedImportJob | null;
}) : MaterialReadiness {
  const chunkCount = Math.max(0, Number(args.chunkCount ?? 0) || 0);
  const latestJob = args.latestJob ?? null;
  const jobStatus = latestJob?.status ?? null;
  const jobStage = latestJob?.stage ?? null;

  if (chunkCount > 0 || isImportJobFinishedStatus(jobStatus)) {
    return {
      ready: true,
      state: "ready",
      label: "Klar",
      detail: chunkCount > 0 ? "Klar til Træner" : "Behandling afsluttet",
      chunkCount,
      jobStatus,
      jobStage,
      jobId: latestJob?.id ?? null,
    };
  }

  if (isImportJobFailedStatus(jobStatus)) {
    return {
      ready: false,
      state: "failed",
      label: "Fejlede",
      detail: latestJob?.error ?? "Klargøring fejlede",
      chunkCount,
      jobStatus,
      jobStage,
      jobId: latestJob?.id ?? null,
    };
  }

  const stage = String(jobStage ?? "").toLowerCase();
  const label =
    stage === "ocr_started" ||
    stage === "ocr_finished" ||
    stage === "pdf_extract_started" ||
    stage === "pdf_extract_finished" ||
    stage === "chunk_build_started" ||
    stage === "chunk_build_finished" ||
    stage === "processing_started"
      ? "OCR/klargøring i gang"
      : "Behandles...";

  return {
    ready: false,
    state: "processing",
    label,
    detail: label === "Behandles..." ? "Materialet gøres klar" : "Materialet klargøres til Træner",
    chunkCount,
    jobStatus,
    jobStage,
    jobId: latestJob?.id ?? null,
  };
}
