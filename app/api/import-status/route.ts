// app/api/import-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getImportQuotaSnapshot } from "@/lib/quota/importUsage";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";
import {
  type MaterialReadinessState,
  normalizeImportJobRow,
  pickBestImportJob,
  resolveMaterialReadiness,
} from "@/lib/trainer/materialReadiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_ID_LOOKUP_LIMIT = 1000;
const PAGE_SIZE = 1000;

function n0(x: any): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : 0;
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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

function asString(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseTimeMs(value: string | null | undefined) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function getFileRelevantTime(row: {
  updatedAt?: string | null;
  uploadedAt?: string | null;
  createdAt?: string | null;
} | null) {
  if (!row) return 0;
  return parseTimeMs(row.uploadedAt) || parseTimeMs(row.createdAt);
}

type MaterialOverviewRow = {
  id: string;
  name: string;
  folderId: string | null;
  updatedAt: string | null;
  uploadedAt: string | null;
  createdAt: string | null;
  readiness: MaterialReadinessState;
  readinessLabel: string;
  readinessDetail: string | null;
  ready: boolean;
  chunkCount: number;
  jobStatus: string | null;
  jobStage: string | null;
};

async function fetchAllRows<T>(
  loadPage: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const page = await loadPage(from, to);
    if (page.error) throw page.error;
    const data = Array.isArray(page.data) ? page.data : [];
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadMaterialOverview(args: {
  admin: any;
  ownerId: string;
  folderId: string | null;
  limit?: number | null;
}) {
  const files = await fetchAllRows<any>((from, to) => {
    let q = args.admin
      .from("files")
      .select("id,name,original_name,folder_id,uploaded_at,created_at")
      .eq("owner_id", args.ownerId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (args.folderId) q = q.eq("folder_id", args.folderId);
    if (typeof args.limit === "number") q = q.limit(args.limit);
    return q;
  });

  const fileRows = files
    .map((row) => {
      const id = asString(row?.id);
      if (!id) return null;
      return {
        id,
        name: asString(row?.name) ?? asString(row?.original_name) ?? "Fil",
        folderId: asString(row?.folder_id),
        updatedAt: asString(row?.uploaded_at) ?? asString(row?.created_at),
        uploadedAt: asString(row?.uploaded_at),
        createdAt: asString(row?.created_at),
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    folderId: string | null;
    updatedAt: string | null;
    uploadedAt: string | null;
    createdAt: string | null;
  }>;

  if (fileRows.length === 0) {
    return {
      rows: [] as MaterialOverviewRow[],
      summary: { ready: 0, processing: 0, background: 0, failed: 0 },
    };
  }

  const fileIdSet = new Set(fileRows.map((row) => row.id));
  const [chunkRows, jobRows] = await Promise.all([
    fetchAllRows<any>((from, to) => {
      let q = args.admin.from("doc_chunks").select("file_id,folder_id").eq("owner_id", args.ownerId).range(from, to);
      if (args.folderId) q = q.eq("folder_id", args.folderId);
      return q;
    }),
    fetchAllRows<any>((from, to) =>
      args.admin
        .from("jobs")
        .select("id,status,payload,meta,result,error,queued_at,started_at,finished_at,created_at,updated_at")
        .eq("owner_id", args.ownerId)
        .eq("kind", "import")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .range(from, to),
    ),
  ]);

  const chunkCountByFileId = new Map<string, number>();
  for (const row of chunkRows) {
    const fileId = asString((row as any)?.file_id);
    if (!fileId || !fileIdSet.has(fileId)) continue;
    chunkCountByFileId.set(fileId, (chunkCountByFileId.get(fileId) ?? 0) + 1);
  }

  const jobsByFileId = new Map<string, ImportJobRow[]>();
  for (const row of jobRows) {
    const normalized = normalizeImportJobRow(row);
    const fileId = normalized?.fileId ?? null;
    if (!normalized || !fileId || !fileIdSet.has(fileId)) continue;
    const group = jobsByFileId.get(fileId) ?? [];
    group.push(normalized);
    jobsByFileId.set(fileId, group);
  }

  const rows: MaterialOverviewRow[] = fileRows.map((row) => {
    const bestJob = pickBestImportJob(jobsByFileId.get(row.id) ?? []);
    const readiness = resolveMaterialReadiness({
      chunkCount: chunkCountByFileId.get(row.id) ?? 0,
      latestJob: bestJob,
    });
    return {
      id: row.id,
      name: row.name,
      folderId: row.folderId,
      updatedAt: row.updatedAt,
      uploadedAt: row.uploadedAt,
      createdAt: row.createdAt,
      readiness: readiness.state,
      readinessLabel: readiness.label,
      readinessDetail: readiness.detail,
      ready: readiness.ready,
      chunkCount: readiness.chunkCount,
      jobStatus: readiness.jobStatus,
      jobStage: readiness.jobStage,
    };
  });

  const summary = rows.reduce(
    (acc, row) => {
      acc[row.readiness] += 1;
      return acc;
    },
    { ready: 0, processing: 0, background: 0, failed: 0 },
  );

  return { rows, summary };
}

function isAuthRateLimited(error: any) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return error?.status === 429 || message.includes("over_request_rate_limit") || message.includes("rate limit");
}

function toActiveJobResponse(job: ReturnType<typeof normalizeImportJobRow>) {
  if (!job) return null;
  return {
    id: job.id,
    status: String(job.status ?? "unknown"),
    stage: job.stage,
    error: job.error,
    requestId: job.requestId,
    fileId: job.fileId,
    folderId: job.folderId,
    uploadKind: job.uploadKind,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

type ImportJobRow = NonNullable<ReturnType<typeof normalizeImportJobRow>>;

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);

  let ownerId = "";

  try {
    const sb = supabaseServerRouteReadOnly(req);
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;
    const { data: authData, error: authError } = sessionUserId
      ? { data: null, error: null }
      : await sb.auth.getUser();
    const getUserError = authError?.message ?? null;
    ownerId = sessionUserId ?? (authData?.user?.id ? String(authData.user.id) : "");

    if (!ownerId && ((sessionError && isAuthRateLimited(sessionError)) || (authError && isAuthRateLimited(authError)))) {
      return NextResponse.json(
        {
          ok: false,
          error: "auth_rate_limited",
          requestId,
        },
        { status: 429, headers: { "Retry-After": "15" } },
      );
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
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server config mangler.", details: String(e?.message ?? e), requestId },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const folderParam = (url.searchParams.get("folder_id") ?? url.searchParams.get("folderId") ?? "").trim();
  const jobIdParam = (url.searchParams.get("job_id") ?? url.searchParams.get("jobId") ?? "").trim();
  const uploadRequestIdParam = (url.searchParams.get("request_id") ?? url.searchParams.get("requestId") ?? "").trim();
  let folderId: string | null = folderParam && isUuidLike(folderParam) ? folderParam : null;

  // Hvis folderId er sat: valider at folderen findes og ejes af user (ellers null)
  if (folderId) {
    const fr = await admin.from("folders").select("id").eq("owner_id", ownerId).eq("id", folderId).maybeSingle();
    if (fr.error || !fr.data?.id) folderId = null;
  }

  const quota = await getImportQuotaSnapshot({ admin, ownerId });
  const plan = quota.plan;
  const monthStart = quota.monthStart;
  const resetAt = quota.resetAt;
  const monthEnd = quota.monthEnd;
  const monthlyLimit = quota.monthlyLimit;
  const usedThisMonth = quota.usedThisMonth;
  const reservedThisMonth = 0; // hvis du senere reserverer sider, kan du udfylde her
  const quotaReached = quota.quotaReached;

  // Files meta (total + latest)
  let filesTotal = 0;
  {
    let q = admin.from("files").select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
    if (folderId) q = q.eq("folder_id", folderId);
    const r = await q;
    filesTotal = n0(r.count);
  }

  let latest: any = null;
  {
    let q = admin
      .from("files")
      .select("id, name, folder_id, uploaded_at, created_at")
      .eq("owner_id", ownerId);

    if (folderId) q = q.eq("folder_id", folderId);

    const r = await q.order("uploaded_at", { ascending: false, nullsFirst: false }).limit(1);

    if (!r.error && Array.isArray(r.data) && r.data.length) {
      latest = r.data[0];
    } else {
      const r2 = await q.order("created_at", { ascending: false, nullsFirst: false }).limit(1);
      if (!r2.error && Array.isArray(r2.data) && r2.data.length) latest = r2.data[0];
    }
  }

  // Orphaned debug (best-effort)
  let orphanedTotal = 0;
  try {
    const r = await admin
      .from("doc_chunks")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .is("folder_id", null);
    orphanedTotal = n0(r.count);
  } catch {
    orphanedTotal = 0;
  }

  const latestUploadedAt =
    (latest?.uploaded_at ?? latest?.created_at)
      ? String(latest.uploaded_at ?? latest.created_at)
      : null;
  let usableFilesTotal = filesTotal;
  let failedFilesExcluded = 0;
  let latestUsableFile: { name: string; uploadedAt: string | null } | null = latest
    ? {
        name: String(latest.name ?? ""),
        uploadedAt: latestUploadedAt,
      }
    : null;

  try {
    const materialOverview = await loadMaterialOverview({
      admin,
      ownerId,
      folderId,
    });
    const usableRows = materialOverview.rows.filter((row) => row.readiness !== "failed");
    const latestUsable = [...usableRows].sort((a, b) => getFileRelevantTime(b) - getFileRelevantTime(a))[0] ?? null;
    usableFilesTotal = usableRows.length;
    failedFilesExcluded = materialOverview.summary.failed;
    latestUsableFile = latestUsable
      ? {
          name: latestUsable.name,
          uploadedAt: latestUsable.uploadedAt ?? latestUsable.createdAt,
        }
      : null;
  } catch (materialOverviewError) {
    console.warn("[import-status] usable files overview warning", {
      requestId,
      ownerId,
      folderId,
      error: String((materialOverviewError as any)?.message ?? materialOverviewError),
    });
  }

  let activeJob: {
    id: string;
    status: string;
    stage: string | null;
    error: string | null;
    requestId: string | null;
    fileId: string | null;
    folderId: string | null;
    uploadKind: string | null;
    queuedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  } | null = null;

  let folderFiles:
    | Array<{
        id: string;
        name: string;
        readiness: "ready" | "processing" | "background" | "failed";
        readinessLabel: string;
        readinessDetail: string | null;
        ready: boolean;
        chunkCount: number;
        jobStatus: string | null;
        jobStage: string | null;
      }>
    | null = null;
  let folderReadinessSummary:
    | {
        ready: number;
        processing: number;
        background: number;
        failed: number;
      }
    | null = null;

  if (jobIdParam || uploadRequestIdParam) {
    try {
      let jobRow: any = null;
      let candidateMatches: Array<{ id: string; status: string | null; payloadRequestId: string | null; metaRequestId: string | null }> = [];

      if (jobIdParam && isUuidLike(jobIdParam)) {
        const jobRes = await admin
          .from("jobs")
          .select("id,status,payload,meta,result,error,queued_at,started_at,finished_at,created_at,updated_at")
          .eq("owner_id", ownerId)
          .eq("id", jobIdParam)
          .maybeSingle();
        if (!jobRes.error && jobRes.data) jobRow = normalizeImportJobRow(jobRes.data);
      } else if (uploadRequestIdParam) {
        const jobsRes = await admin
          .from("jobs")
          .select("id,status,payload,meta,result,error,queued_at,started_at,finished_at,created_at,updated_at")
          .eq("owner_id", ownerId)
          .eq("kind", "import")
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(REQUEST_ID_LOOKUP_LIMIT);

        if (!jobsRes.error && Array.isArray(jobsRes.data)) {
          const matchingJobs: ImportJobRow[] = jobsRes.data
            .map((row: any) => normalizeImportJobRow(row))
            .filter(
              (job: ReturnType<typeof normalizeImportJobRow>): job is ImportJobRow =>
                !!job && job.requestId === uploadRequestIdParam,
            );

          candidateMatches = matchingJobs.map((job) => ({
            id: job.id,
            status: job.status,
            payloadRequestId: job.requestId,
            metaRequestId: job.requestId,
          }));
          jobRow = pickBestImportJob(matchingJobs);
        }
      }

      activeJob = toActiveJobResponse(jobRow);

      console.info("[import-status] lookup", {
        requestId,
        ownerId,
        folderId,
        jobIdParam: jobIdParam || null,
        uploadRequestIdParam: uploadRequestIdParam || null,
        activeJobId: activeJob?.id ?? null,
        activeJobStatus: activeJob?.status ?? null,
        activeJobStage: activeJob?.stage ?? null,
        candidateMatches,
      });
    } catch (lookupError) {
      console.warn("[import-status] lookup warning", {
        requestId,
        ownerId,
        folderId,
        jobIdParam: jobIdParam || null,
        uploadRequestIdParam: uploadRequestIdParam || null,
        error: String((lookupError as any)?.message ?? lookupError),
      });
    }
  }

  let effectiveFolderId = folderId;
  if (!effectiveFolderId && activeJob?.folderId && isUuidLike(activeJob.folderId)) {
    try {
      const folderRes = await admin
        .from("folders")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("id", activeJob.folderId)
        .maybeSingle();
      if (!folderRes.error && folderRes.data?.id) {
        effectiveFolderId = String(folderRes.data.id);
      }
    } catch (folderLookupError) {
      console.warn("[import-status] active folder lookup warning", {
        requestId,
        ownerId,
        activeJobId: activeJob?.id ?? null,
        folderId: activeJob?.folderId ?? null,
        error: String((folderLookupError as any)?.message ?? folderLookupError),
      });
    }
  }

  if (activeJob?.fileId && isUuidLike(activeJob.fileId)) {
    try {
      const activeFileRes = await admin
        .from("files")
        .select("id, name, folder_id, uploaded_at, created_at")
        .eq("owner_id", ownerId)
        .eq("id", activeJob.fileId)
        .maybeSingle();
      if (!activeFileRes.error && activeFileRes.data) {
        latest = activeFileRes.data;
        if (!effectiveFolderId && activeFileRes.data.folder_id) {
          effectiveFolderId = String(activeFileRes.data.folder_id);
        }
      }
    } catch (activeFileLookupError) {
      console.warn("[import-status] active file lookup warning", {
        requestId,
        ownerId,
        activeJobId: activeJob?.id ?? null,
        fileId: activeJob?.fileId ?? null,
        error: String((activeFileLookupError as any)?.message ?? activeFileLookupError),
      });
    }
  }

  if (effectiveFolderId) {
    try {
      const materialOverview = await loadMaterialOverview({
        admin,
        ownerId,
        folderId: effectiveFolderId,
        limit: 80,
      });

      folderFiles = materialOverview.rows.map((row) => ({
        id: row.id,
        name: row.name,
        readiness: row.readiness,
        readinessLabel: row.readinessLabel,
        readinessDetail: row.readinessDetail,
        ready: row.ready,
        chunkCount: row.chunkCount,
        jobStatus: row.jobStatus,
        jobStage: row.jobStage,
      }));
      folderReadinessSummary = materialOverview.summary;
    } catch (folderReadinessError) {
      console.warn("[import-status] folder readiness warning", {
        requestId,
        ownerId,
        folderId: effectiveFolderId,
        error: String((folderReadinessError as any)?.message ?? folderReadinessError),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    requestId,

    folderId: effectiveFolderId,
    plan,

    usedThisMonth,
    reservedThisMonth,
    monthlyLimit,

    resetAt,
    resetAtNice: formatDa(resetAt),
    monthStart,
    monthEnd,

    quotaReached,

    used: usedThisMonth,
    limit: monthlyLimit,

    month: { used: usedThisMonth, limit: monthlyLimit },

    quota: {
      usedThisMonth,
      limitPerMonth: monthlyLimit,
      monthStart,
      monthEnd,
      resetAt,
      plan,
    },

    files: {
      total: filesTotal,
      hasFile: filesTotal > 0,
      latest: latest
        ? {
            id: String(latest.id),
            name: String(latest.name ?? ""),
            folder_id: latest.folder_id ? String(latest.folder_id) : effectiveFolderId,
            updated_at: latestUploadedAt,
          }
        : null,
    },

    filesTotal,
    usableFilesTotal,
    failedFilesExcluded,
    latestFile: latest
      ? {
          name: String(latest.name ?? ""),
          uploadedAt: latestUploadedAt,
        }
      : null,
    latestUsableFile,

    debug: { orphanedTotal },
    activeJob,
    folderFiles,
    folderReadinessSummary,

    message: null,

    ...(process.env.NODE_ENV !== "production"
      ? {
          _debug: {
            quotaSource: "successful_import_jobs",
          },
        }
      : {}),
  });
}
