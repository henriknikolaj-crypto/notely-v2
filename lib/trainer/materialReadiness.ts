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
  createdAt: string | null;
  updatedAt: string | null;
};

export type MaterialReadinessState = "ready" | "processing" | "background" | "failed";

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

function parseTimeMs(value: string | null | undefined) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toLowerCase();
}

function isFirstReadyStage(stage: string | null | undefined) {
  return normalizeStatus(stage) === "first_ready";
}

function isDeepProcessingStage(stage: string | null | undefined) {
  return normalizeStatus(stage) === "deep_processing";
}

export function isImportJobFinishedStatus(status: string | null | undefined) {
  const normalized = normalizeStatus(status);
  return normalized === "finished" || normalized === "completed" || normalized === "succeeded";
}

export function isImportJobFailedStatus(status: string | null | undefined) {
  return normalizeStatus(status) === "failed";
}

export function isImportJobTerminalStatus(status: string | null | undefined) {
  return isImportJobFinishedStatus(status) || isImportJobFailedStatus(status);
}

export function getImportJobRelevantTime(job: NormalizedImportJob | null | undefined) {
  if (!job) return 0;
  return (
    parseTimeMs(job.updatedAt) ||
    parseTimeMs(job.finishedAt) ||
    parseTimeMs(job.startedAt) ||
    parseTimeMs(job.queuedAt) ||
    parseTimeMs(job.createdAt)
  );
}

function getImportJobPriority(job: NormalizedImportJob) {
  if (isImportJobFinishedStatus(job.status)) return 3;
  if (isImportJobFailedStatus(job.status)) return 2;
  return 1;
}

function compareImportJobs(a: NormalizedImportJob, b: NormalizedImportJob) {
  const relevantTimeDiff = getImportJobRelevantTime(b) - getImportJobRelevantTime(a);
  if (relevantTimeDiff !== 0) return relevantTimeDiff;

  const updatedTimeDiff = parseTimeMs(b.updatedAt) - parseTimeMs(a.updatedAt);
  if (updatedTimeDiff !== 0) return updatedTimeDiff;

  const createdTimeDiff = parseTimeMs(b.createdAt) - parseTimeMs(a.createdAt);
  if (createdTimeDiff !== 0) return createdTimeDiff;

  const priorityDiff = getImportJobPriority(b) - getImportJobPriority(a);
  if (priorityDiff !== 0) return priorityDiff;

  return b.id.localeCompare(a.id);
}

export function pickBestImportJob(jobs: Array<NormalizedImportJob | null | undefined>) {
  return jobs
    .filter((job): job is NormalizedImportJob => !!job)
    .sort(compareImportJobs)[0] ?? null;
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
    createdAt: strOrNull(row?.created_at),
    updatedAt: strOrNull(row?.updated_at),
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

  if ((chunkCount > 0 || isFirstReadyStage(jobStage)) && isDeepProcessingStage(jobStage)) {
    return {
      ready: true,
      state: "background",
      label: "Forbedres",
      detail: "Materialet er klar og forbedres i baggrunden",
      chunkCount,
      jobStatus,
      jobStage,
      jobId: latestJob?.id ?? null,
    };
  }

  if (chunkCount > 0 || isImportJobFinishedStatus(jobStatus) || isFirstReadyStage(jobStage)) {
    return {
      ready: true,
      state: "ready",
      label: "Klar",
      detail: chunkCount > 0 || isFirstReadyStage(jobStage) ? "Materialet er klar" : "Behandling afsluttet",
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

  return {
    ready: false,
    state: "processing",
    label: "Klargøres",
    detail: "Materialet klargøres",
    chunkCount,
    jobStatus,
    jobStage,
    jobId: latestJob?.id ?? null,
  };
}
