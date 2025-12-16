// app/api/quota/current/route.ts
import "server-only";
 
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // fall through
  }
  return process.env.DEV_USER_ID ?? null;
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

function n0(x: number | null | undefined) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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

async function countJobs(opts: {
  admin: any;
  ownerId: string;
  kind: string;
  from?: string;
  to?: string;
  statuses?: string[];
}) {
  const { admin, ownerId, kind, from, to, statuses } = opts;
  const tsCols = from && to ? ["queued_at", "created_at", "inserted_at"] : [null];
  let lastErr: any = null;

  for (const tsCol of tsCols) {
    // med status-filter
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

    // fallback uden status-filter
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

  return { count: 0, used: null as any, error: lastErr };
}

export async function GET(_req: NextRequest) {
  void _req;
  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const now = new Date();
  const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(now);

  // plan + limits
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota/current] profile error:", errInfo(profileErr));
  const plan = (profile as any)?.plan ?? "freemium";

  const { data: planLimits, error: limitsErr } = await admin
    .from("plan_limits")
    .select("feature, monthly_limit")
    .eq("plan", plan);

  if (limitsErr) console.error("[quota/current] plan_limits error:", errInfo(limitsErr));

  const importLimit =
    (planLimits ?? []).find((r: any) => r.feature === "import")?.monthly_limit ?? null;
  const evalLimit =
    (planLimits ?? []).find((r: any) => r.feature === "evaluate")?.monthly_limit ?? null;

  // IMPORT = jobs(kind=import) — samme “sandhed” som /api/import-status
  const importStatuses = ["succeeded"];

  const importMonth = await countJobs({
    admin,
    ownerId,
    kind: "import",
    from: monthStart,
    to: resetAt,
    statuses: importStatuses,
  });

  if ((importMonth as any).error) {
    console.error("[quota/current] import month error:", errInfo((importMonth as any).error));
  }

  // EVALUATE = exam_sessions(source_type=trainer)
  const { count: evalThisMonthRaw, error: evalMonthErr } = await admin
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .gte("created_at", monthStart)
    .lt("created_at", resetAt);

  if (evalMonthErr) console.error("[quota/current] eval month error:", errInfo(evalMonthErr));

  return NextResponse.json({
    ok: true,
    ownerId,
    plan,
    monthStart,
    monthEnd,
    resetAt,

    // kompatibilitet: både gamle og nye felter
    importUsedThisMonth: n0(importMonth.count),
    importLimitPerMonth: importLimit,
    evalUsedThisMonth: n0(evalThisMonthRaw),
    evalLimitPerMonth: evalLimit,

    import: {
      usedThisMonth: n0(importMonth.count),
      limitPerMonth: importLimit,
    },
    evaluate: {
      usedThisMonth: n0(evalThisMonthRaw),
      limitPerMonth: evalLimit,
    },
  });
}

