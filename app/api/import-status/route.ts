// app/api/import-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function n0(x: number | null | undefined) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Månedens start + næste måneds start i UTC.
 * - monthStart: inklusiv
 * - resetAt: eksklusiv
 * - monthEnd: sidste millisekund i måneden (kun til visning/debug)
 */
function getMonthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(resetAt.getTime() - 1);

  return {
    monthStart: start.toISOString(),
    resetAt: resetAt.toISOString(),
    monthEnd: monthEnd.toISOString(),
  };
}

type CountJobsResult = {
  count: number;
  used: { tsCol: string | null; withStatus: boolean } | null;
  error?: any;
};

async function countJobs(opts: {
  admin: any;
  ownerId: string;
  kind: string;
  from?: string;
  to?: string;
  statuses?: string[];
}): Promise<CountJobsResult> {
  const { admin, ownerId, kind, from, to, statuses } = opts;

  const tsCols: (string | null)[] = from && to ? ["queued_at", "created_at", "inserted_at"] : [null];
  let lastErr: any = null;

  for (const tsCol of tsCols) {
    // 1) med status-filter
    if (statuses?.length) {
      let q = admin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("kind", kind)
        .in("status", statuses);

      if (tsCol && from && to) q = q.gte(tsCol, from).lt(tsCol, to);

      const r = await q;
      if (!r.error && r.count != null) return { count: n0(r.count), used: { tsCol, withStatus: true } };
      lastErr = r.error ?? lastErr;
    }

    // 2) fallback uden status-filter
    let q2 = admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", kind);

    if (tsCol && from && to) q2 = q2.gte(tsCol, from).lt(tsCol, to);

    const r2 = await q2;
    if (!r2.error && r2.count != null) return { count: n0(r2.count), used: { tsCol, withStatus: false } };
    lastErr = r2.error ?? lastErr;
  }

  return { count: 0, used: null, error: lastErr };
}

type FileRow = {
  id: string;
  name: string | null;
  original_name: string | null;
  folder_id: string | null;
  uploaded_at: string | null;
  created_at: string | null;
};

export async function GET(req: NextRequest) {
  let ownerId = "";
  try {
    const u = await requireUser(req);
    ownerId = u.id;
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");
    if (!isAuth) console.error("[import-status] requireUser crash:", e);
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const folderId = req.nextUrl.searchParams.get("folder_id") || null;

  // Brug service-role så både kvote og fil-listning altid virker (uanset RLS/auth)
  let admin: any;
  try {
    admin = supabaseAdmin();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server config mangler.", details: String(e?.message ?? e) },
      { status: 500 },
    );
  }

  const now = new Date();
  const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(now);

  // Plan + import limit
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[import-status] profile error:", errInfo(profileErr));
  const plan = (profile as any)?.plan ?? "freemium";

  const { data: limitRow, error: limitErr } = await admin
    .from("plan_limits")
    .select("monthly_limit")
    .eq("plan", plan)
    .eq("feature", "import")
    .maybeSingle();

  if (limitErr) console.error("[import-status] plan_limits error:", errInfo(limitErr));
  const limitPerMonth =
    typeof (limitRow as any)?.monthly_limit === "number" ? (limitRow as any).monthly_limit : null;

  // Import usage = jobs(kind=import) — vi tæller kun succeeded som "brug"
  const statuses = ["succeeded"];

  const month = await countJobs({
    admin,
    ownerId,
    kind: "import",
    from: monthStart,
    to: resetAt,
    statuses,
  });
  if (month.error) console.error("[import-status] import month error:", errInfo(month.error));

  const all = await countJobs({
    admin,
    ownerId,
    kind: "import",
    statuses,
  });
  if (all.error) console.error("[import-status] import all-time error:", errInfo(all.error));

  // Files (aktuelt antal + seneste)
  let q = admin
    .from("files")
    .select("id,name,original_name,folder_id,uploaded_at,created_at", { count: "exact" })
    .eq("owner_id", ownerId);

  if (folderId) q = q.eq("folder_id", folderId);

  const { data, error, count } = await q
    .order("uploaded_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[import-status] files error:", errInfo(error));
    return NextResponse.json(
      { ok: false, error: "Supabase-forespørgsel fejlede.", details: (error as any)?.message ?? "unknown" },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as FileRow[];
  const latest = rows[0] ?? null;

  const filesTotal = n0(count ?? rows.length);

  const latestFile = latest
    ? {
        id: latest.id,
        name: latest.name ?? latest.original_name ?? "Ukendt fil",
        folder_id: latest.folder_id,
        updated_at: latest.uploaded_at ?? latest.created_at,
      }
    : null;

  return NextResponse.json(
    {
      ok: true,
      folderId,

      quota: {
        usedThisMonth: n0(month.count),
        totalAllTime: n0(all.count),
        limitPerMonth,
        monthStart,
        monthEnd,
        resetAt,
        plan,
      },

      files: {
        total: filesTotal,
        hasFile: !!latestFile,
        latest: latestFile,
      },
    },
    { status: 200 },
  );
}
