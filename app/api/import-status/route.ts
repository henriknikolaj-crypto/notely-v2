// app/api/import-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getImportQuotaSnapshot } from "@/lib/quota/importUsage";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";
import {
  normalizeImportJobRow,
  pickBestImportJob,
  resolveMaterialReadiness,
} from "@/lib/trainer/materialReadiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    ownerId = sessionUserId ?? "";

    if (sessionError && isAuthRateLimited(sessionError)) {
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
      .select("id, name, folder_id, updated_at, uploaded_at, created_at")
      .eq("owner_id", ownerId);

    if (folderId) q = q.eq("folder_id", folderId);

    // robust: prøv updated_at først, ellers uploaded_at/created_at
    const r = await q.order("updated_at", { ascending: false, nullsFirst: false }).limit(1);

    if (!r.error && Array.isArray(r.data) && r.data.length) {
      latest = r.data[0];
    } else {
      const r2 = await q.order("uploaded_at", { ascending: false, nullsFirst: false }).limit(1);
      if (!r2.error && Array.isArray(r2.data) && r2.data.length) latest = r2.data[0];
      else {
        const r3 = await q.order("created_at", { ascending: false, nullsFirst: false }).limit(1);
        if (!r3.error && Array.isArray(r3.data) && r3.data.length) latest = r3.data[0];
      }
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
    (latest?.updated_at ?? latest?.uploaded_at ?? latest?.created_at) ? String(latest.updated_at ?? latest.uploaded_at ?? latest.created_at) : null;

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
        readiness: "ready" | "processing" | "failed";
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
          .limit(100);

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

  if (folderId) {
    try {
      const folderFilesRes = await admin
        .from("files")
        .select("id,name,original_name")
        .eq("owner_id", ownerId)
        .eq("folder_id", folderId)
        .order("created_at", { ascending: false })
        .limit(80);

      const fileRows = Array.isArray(folderFilesRes.data) ? folderFilesRes.data : [];
      const fileIds = fileRows
        .map((row: any) => String(row?.id ?? "").trim())
        .filter(Boolean);

      if (fileIds.length > 0) {
        const [chunkRes, jobsRes] = await Promise.all([
          admin
            .from("doc_chunks")
            .select("file_id")
            .eq("owner_id", ownerId)
            .in("file_id", fileIds)
            .limit(4000),
          admin
            .from("jobs")
            .select("id,status,payload,meta,result,error,queued_at,started_at,finished_at,created_at,updated_at")
            .eq("owner_id", ownerId)
            .eq("kind", "import")
            .order("updated_at", { ascending: false, nullsFirst: false })
            .limit(300),
        ]);

        const chunkCountByFileId = new Map<string, number>();
        if (Array.isArray(chunkRes.data)) {
          for (const row of chunkRes.data as any[]) {
            const fileId = String(row?.file_id ?? "").trim();
            if (!fileId) continue;
            chunkCountByFileId.set(fileId, (chunkCountByFileId.get(fileId) ?? 0) + 1);
          }
        }

        const jobsByFileId = new Map<string, Array<ReturnType<typeof normalizeImportJobRow>>>();
        if (Array.isArray(jobsRes.data)) {
          for (const row of jobsRes.data as any[]) {
            const normalized = normalizeImportJobRow(row);
            const fileId = normalized?.fileId ?? null;
            if (!normalized || !fileId) continue;
            const group = jobsByFileId.get(fileId) ?? [];
            group.push(normalized);
            jobsByFileId.set(fileId, group);
          }
        }

        folderFiles = fileRows.map((row: any) => {
          const fileId = String(row?.id ?? "").trim();
          const chunkCount = chunkCountByFileId.get(fileId) ?? 0;
          const bestJob = pickBestImportJob(jobsByFileId.get(fileId) ?? []);
          const readiness = resolveMaterialReadiness({
            chunkCount,
            latestJob: bestJob,
          });
          return {
            id: fileId,
            name: String(row?.name ?? row?.original_name ?? "").trim(),
            readiness: readiness.state,
            readinessLabel: readiness.label,
            readinessDetail: readiness.detail,
            ready: readiness.ready,
            chunkCount: readiness.chunkCount,
            jobStatus: readiness.jobStatus,
            jobStage: readiness.jobStage,
          };
        });

        folderReadinessSummary = (folderFiles ?? []).reduce(
          (acc, file) => {
            acc[file.readiness] += 1;
            return acc;
          },
          { ready: 0, processing: 0, failed: 0 },
        );
      } else {
        folderFiles = [];
        folderReadinessSummary = { ready: 0, processing: 0, failed: 0 };
      }
    } catch (folderReadinessError) {
      console.warn("[import-status] folder readiness warning", {
        requestId,
        ownerId,
        folderId,
        error: String((folderReadinessError as any)?.message ?? folderReadinessError),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    requestId,

    folderId,
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
            folder_id: latest.folder_id ? String(latest.folder_id) : null,
            updated_at: latestUploadedAt,
          }
        : null,
    },

    filesTotal,
    latestFile: latest
      ? {
          name: String(latest.name ?? ""),
          uploadedAt: latestUploadedAt,
        }
      : null,

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
