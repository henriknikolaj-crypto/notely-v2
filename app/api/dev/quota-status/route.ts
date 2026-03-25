// app/api/dev/quota-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDevSecret } from "@/lib/dev/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function monthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
  const monthEnd = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0)).toISOString();
  return { monthStart, monthEnd };
}

function jsonError(
  status: number,
  payload: { ok?: boolean; code?: string; error?: string; message?: string } & Record<string, any>,
) {
  return NextResponse.json({ ok: false, ...payload }, { status });
}

export async function GET(req: NextRequest) {
  const guard = requireDevSecret(req);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.message }, { status: guard.status });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    return jsonError(500, {
      code: "SERVER_MISCONFIG",
      message: "Supabase env vars mangler (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const sp = req.nextUrl.searchParams;
  const ownerOverride = (sp.get("owner_id") ?? sp.get("ownerId") ?? "").trim() || null;

  let ownerId = String(process.env.DEV_USER_ID ?? "").trim();
  if (ownerOverride) {
    if (!isUuidLike(ownerOverride)) {
      return jsonError(400, { code: "INVALID_OWNER_ID", error: "owner_id must be a UUID" });
    }
    ownerId = ownerOverride;
  }

  if (!ownerId) {
    return jsonError(400, { code: "DEV_USER_ID_MISSING", error: "DEV_USER_ID not set" });
  }

  const now = new Date();
  const { monthStart, monthEnd } = monthBoundsUTC(now);

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, email, plan, quota, quota_renew_at")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota-status] profile error:", profileErr);

  const plan = (profile as any)?.plan ?? "freemium";

  const { data: planLimitRows, error: planLimitErr } = await supabase
    .from("plan_limits")
    .select("plan, feature, monthly_limit, is_unlimited")
    .eq("plan", plan);

  if (planLimitErr) console.error("[quota-status] plan_limits error:", planLimitErr);

  const planLimits = planLimitRows ?? [];

  const importLimit =
    planLimits.find((r: any) => r.feature === "import")?.is_unlimited
      ? null
      : (planLimits.find((r: any) => r.feature === "import")?.monthly_limit ?? null);

  const evalLimit =
    planLimits.find((r: any) => r.feature === "evaluate")?.is_unlimited
      ? null
      : (planLimits.find((r: any) => r.feature === "evaluate")?.monthly_limit ?? null);

  const { count: importThisMonth = 0, error: importMonthErr } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded")
    .gte("queued_at", monthStart)
    .lt("queued_at", monthEnd);

  if (importMonthErr) console.error("[quota-status] import month error:", importMonthErr);

  const { count: importAllTime = 0, error: importAllErr } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded");

  if (importAllErr) console.error("[quota-status] import all-time error:", importAllErr);

  const { count: evalThisMonth = 0, error: evalMonthErr } = await supabase
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);

  if (evalMonthErr) console.error("[quota-status] eval month error:", evalMonthErr);

  const { count: evalAllTime = 0, error: evalAllErr } = await supabase
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer");

  if (evalAllErr) console.error("[quota-status] eval all-time error:", evalAllErr);

  return NextResponse.json({
    ok: true,
    gatedAs: "dev",
    ownerId,
    now: now.toISOString(),
    monthStart,
    monthEnd,
    profile,
    import: {
      usedThisMonth: importThisMonth,
      totalAllTime: importAllTime,
      limitPerMonth: importLimit,
      monthlyLimit: importLimit,
    },
    evaluate: {
      usedThisMonth: evalThisMonth,
      totalAllTime: evalAllTime,
      limitPerMonth: evalLimit,
      monthlyLimit: evalLimit,
    },
    planLimits,
  });
}
