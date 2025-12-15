// app/api/quota-status/route.ts
import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * I prod: kræv login.
 * I dev: fallback til DEV_USER_ID (så irm/curl virker uden cookies).
 */
async function getOwnerId(sb: any): Promise<{
  ownerId: string | null;
  mode: "auth" | "dev";
}> {
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

/**
 * Månedens start/slut i Europe/Copenhagen, returneret som UTC ISO strings.
 * (robust nok til quotas – undgår server-tz drift i prod).
 */
function getMonthBoundsCopenhagen(now = new Date()) {
  const timeZone = "Europe/Copenhagen";

  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });

  const parts = dtf.formatToParts(now).reduce((acc: any, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});

  const year = Number(parts.year);
  const month = Number(parts.month); // 1-12

  // Helper: find offset(ms) for timezone at a given UTC instant
  function tzOffsetMs(dateUtc: Date) {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(dateUtc)
      .reduce((acc: any, x) => {
        if (x.type !== "literal") acc[x.type] = x.value;
        return acc;
      }, {});

    const asUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second)
    );

    return asUtc - dateUtc.getTime();
  }

  // Convert "wall clock in Copenhagen" -> UTC instant (single-pass; OK for month boundaries)
  function zonedToUtc(y: number, m1: number, d: number, hh: number, mm: number, ss: number, ms: number) {
    const guess = new Date(Date.UTC(y, m1 - 1, d, hh, mm, ss, ms));
    const off = tzOffsetMs(guess);
    return new Date(guess.getTime() - off);
  }

  const monthStartUtc = zonedToUtc(year, month, 1, 0, 0, 0, 0);
  const nextMonthUtc = month === 12
    ? zonedToUtc(year + 1, 1, 1, 0, 0, 0, 0)
    : zonedToUtc(year, month + 1, 1, 0, 0, 0, 0);

  const monthEndUtc = new Date(nextMonthUtc.getTime() - 1);

  return {
    monthStart: monthStartUtc.toISOString(),
    monthEnd: monthEndUtc.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const { ownerId, mode } = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return NextResponse.json(
      { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const now = new Date();
  const { monthStart, monthEnd } = getMonthBoundsCopenhagen(now);

  // Profile (plan + quota)
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, email, plan, quota, quota_renew_at")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota-status] profile error:", profileErr);

  const plan = (profile as any)?.plan ?? "freemium";

  // Plan limits
  const { data: planLimitRows, error: planLimitErr } = await admin
    .from("plan_limits")
    .select("plan, feature, monthly_limit")
    .eq("plan", plan);

  if (planLimitErr) console.error("[quota-status] plan_limits error:", planLimitErr);

  const planLimits = planLimitRows ?? [];
  const importLimit =
    planLimits.find((r: any) => r.feature === "import")?.monthly_limit ?? null;
  const evalLimit =
    planLimits.find((r: any) => r.feature === "evaluate")?.monthly_limit ?? null;

  // Import usage (jobs: kind=import, status=succeeded)
  const { count: importThisMonth = 0 } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded")
    .gte("queued_at", monthStart)
    .lte("queued_at", monthEnd);

  const { count: importAllTime = 0 } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded");

  // Evaluate usage (exam_sessions: source_type=trainer)
  const { count: evalThisMonth = 0, error: evalMonthErr } = await admin
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .gte("created_at", monthStart)
    .lte("created_at", monthEnd);

  if (evalMonthErr) console.error("[quota-status] eval month error:", evalMonthErr);

  const { count: evalAllTime = 0, error: evalAllErr } = await admin
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer");

  if (evalAllErr) console.error("[quota-status] eval all-time error:", evalAllErr);

  return NextResponse.json({
    ok: true,
    mode,
    ownerId,
    now: now.toISOString(),
    monthStart,
    monthEnd,
    plan,
    profile,
    import: {
      usedThisMonth: importThisMonth,
      totalAllTime: importAllTime,
      limitPerMonth: importLimit,
    },
    evaluate: {
      usedThisMonth: evalThisMonth,
      totalAllTime: evalAllTime,
      limitPerMonth: evalLimit,
    },
    planLimits,
  });
}
