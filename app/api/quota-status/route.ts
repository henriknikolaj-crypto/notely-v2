// app/api/quota-status/route.ts
import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getOwnerId(
  sb: any,
): Promise<{ ownerId: string | null; mode: "auth" | "dev" }> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      const id = (data?.user?.id as string | undefined) ?? null;
      if (id) return { ownerId: id, mode: "auth" };
    }
  } catch {
    // ignore
  }

  const dev = (process.env.DEV_USER_ID ?? "").trim();
  if (process.env.NODE_ENV !== "production" && dev) {
    return { ownerId: dev, mode: "dev" };
  }

  return { ownerId: null, mode: "auth" };
}

function errInfo(e: any) {
  try {
    if (!e) return { message: "Unknown error", raw: e };
    if (typeof e === "string") return { message: e };
    if (e instanceof Error) return { message: e.message, stack: e.stack };

    const msg =
      e.message ?? e.error_description ?? e.error ?? e.msg ?? "Unknown error";

    return {
      message: msg,
      code: e.code,
      details: e.details,
      hint: e.hint,
      status: e.status,
      raw: Object.keys(e).length ? e : undefined,
    };
  } catch {
    return { message: "Unknown error" };
  }
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

function n0(x: number | null | undefined) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

async function countJobs(opts: {
  admin: any;
  ownerId: string;
  kind: string;
  from?: string;
  to?: string;
  statuses?: string[];
}) {
  const { admin, ownerId, kind, from, to, statuses } = opts;

  // Prøv først med status-filter + forskellige timestamp-kolonner.
  const tsCols = from && to ? ["queued_at", "created_at", "inserted_at"] : [null];

  let lastErr: any = null;

  for (const tsCol of tsCols) {
    // 1) Forsøg med status-filter (hvis angivet)
    if (statuses?.length) {
      const q1 = admin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("kind", kind)
        .in("status", statuses);

      const q1b =
        tsCol && from && to ? q1.gte(tsCol, from).lt(tsCol, to) : q1;

      const r1 = await q1b;
      if (!r1.error && r1.count != null) {
        return { count: n0(r1.count), used: { tsCol, withStatus: true } };
      }
      lastErr = r1.error ?? lastErr;
    }

    // 2) Fallback: uden status-filter (så quota ikke crasher pga enum/values)
    const q2 = admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", kind);

    const q2b = tsCol && from && to ? q2.gte(tsCol, from).lt(tsCol, to) : q2;

    const r2 = await q2b;
    if (!r2.error && r2.count != null) {
      return { count: n0(r2.count), used: { tsCol, withStatus: false } };
    }
    lastErr = r2.error ?? lastErr;
  }

  return { count: 0, used: null, error: lastErr };
}

export async function GET(_req: NextRequest) {
  const sb = await supabaseServerRoute();
  const { ownerId, mode } = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 },
    );
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(now);

  // Profile
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, email, plan, quota, quota_renew_at")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota-status] profile error:", errInfo(profileErr));

  const plan = (profile as any)?.plan ?? "freemium";

  // Plan limits
  const { data: planLimitRows, error: planLimitErr } = await admin
    .from("plan_limits")
    .select("plan, feature, monthly_limit")
    .eq("plan", plan);

  if (planLimitErr)
    console.error("[quota-status] plan_limits error:", errInfo(planLimitErr));

  const planLimits = planLimitRows ?? [];
  const importLimit =
    planLimits.find((r: any) => r.feature === "import")?.monthly_limit ?? null;
  const evalLimit =
    planLimits.find((r: any) => r.feature === "evaluate")?.monthly_limit ?? null;

  // Import usage
  // (Hold den snæver, men tolerant: hvis status-filter fejler, falder vi tilbage uden filter)
  const importStatuses = ["succeeded"];


  const importMonth = await countJobs({
    admin,
    ownerId,
    kind: "import",
    from: monthStart,
    to: resetAt,
    statuses: importStatuses,
  });

  if ((importMonth as any).error)
    console.error("[quota-status] import month error:", errInfo((importMonth as any).error));

  const importAll = await countJobs({
    admin,
    ownerId,
    kind: "import",
    statuses: importStatuses,
  });

  if ((importAll as any).error)
    console.error("[quota-status] import all-time error:", errInfo((importAll as any).error));

  // Evaluate usage (trainer)
  const { count: evalThisMonthRaw, error: evalMonthErr } = await admin
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .gte("created_at", monthStart)
    .lt("created_at", resetAt);

  if (evalMonthErr) console.error("[quota-status] eval month error:", errInfo(evalMonthErr));

  const { count: evalAllTimeRaw, error: evalAllErr } = await admin
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer");

  if (evalAllErr) console.error("[quota-status] eval all-time error:", errInfo(evalAllErr));

  return NextResponse.json({
    ok: true,
    mode,
    ownerId,
    now: now.toISOString(),
    monthStart,
    monthEnd,
    resetAt,
    plan,
    profile,
    import: {
      usedThisMonth: n0(importMonth.count),
      totalAllTime: n0(importAll.count),
      limitPerMonth: importLimit,
    },
    evaluate: {
      usedThisMonth: n0(evalThisMonthRaw),
      totalAllTime: n0(evalAllTimeRaw),
      limitPerMonth: evalLimit,
    },
    planLimits,
    // Dev-only debug (hjælper, hvis jobs-kolonner/status driller)
    ...(process.env.NODE_ENV !== "production"
      ? { _debug: { importMonthUsed: importMonth.used, importAllUsed: importAll.used } }
      : {}),
  });
}
