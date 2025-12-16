// app/api/dev/quota-status/route.ts
import "server-only";
 
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readSecret(req: NextRequest | Request): string {
  const h1 = req.headers.get("x-shared-secret");
  if (h1 && h1.trim()) return h1.trim();

  const h2 =
    req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return h2.replace(/^Bearer\s+/i, "").trim();
}

function isDev() {
  return process.env.NODE_ENV !== "production";
}

// Månedens start/slut i lokal tid (Danmark) – konverteret til ISO/UTC
function getMonthBounds(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11

  const localStart = new Date(year, month, 1, 0, 0, 0, 0);
  const localEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  return {
    monthStart: localStart.toISOString(),
    monthEnd: localEnd.toISOString(),
  };
}

function jsonError(
  status: number,
  payload: { ok?: boolean; code?: string; error?: string; message?: string } & Record<
    string,
    any
  >,
) {
  return NextResponse.json({ ok: false, ...payload }, { status });
}

export async function GET(req: NextRequest) {
  /**
   * Auth-regel:
   * - Prod: kræver x-shared-secret / Bearer (IMPORT_SHARED_SECRET)
   * - Dev: tillad også "ingen secret" for local testing (fallback til DEV_USER_ID)
   */
  const expected = (process.env.IMPORT_SHARED_SECRET || "").trim();
  const incoming = readSecret(req);

  if (!isDev()) {
    // PROD: kræv secret
    if (!expected || incoming !== expected) {
      return jsonError(401, { code: "UNAUTHORIZED", error: "unauthorized" });
    }
  } else {
    // DEV: hvis secret er sat, accepter enten korrekt secret eller ingen/andet
    // (det gør endpoint testbart i UI/PowerShell uden cookies)
    // Hvis du vil kræve secret i dev også, så fjern denne blok og brug prod-reglen.
  }

  // Admin Supabase client (service role, ingen RLS)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    return jsonError(500, {
      code: "SERVER_MISCONFIG",
      message: "Supabase env vars mangler (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Owner (DEV) — senere kan vi udvide med query param / rigtig auth
  const ownerId = String(process.env.DEV_USER_ID ?? "").trim();
  if (!ownerId) {
    return jsonError(400, {
      code: "DEV_USER_ID_MISSING",
      error: "DEV_USER_ID not set",
    });
  }

  const now = new Date();
  const { monthStart, monthEnd } = getMonthBounds(now);

  // Profil (plan + quota)
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, email, plan, quota, quota_renew_at")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) {
    console.error("[quota-status] profile error:", profileErr);
  }

  const plan = (profile as any)?.plan ?? "freemium";

  // Plan-limits for denne plan
  const { data: planLimitRows, error: planLimitErr } = await supabase
    .from("plan_limits")
    .select("plan, feature, monthly_limit")
    .eq("plan", plan);

  if (planLimitErr) {
    console.error("[quota-status] plan_limits error:", planLimitErr);
  }

  const planLimits = planLimitRows ?? [];

  const importLimit =
    planLimits.find((r: any) => r.feature === "import")?.monthly_limit ?? null;

  const evalLimit =
    planLimits.find((r: any) => r.feature === "evaluate")?.monthly_limit ?? null;

  // Import-brug (jobs.kind='import', status='succeeded')
  const { count: importThisMonth = 0, error: importMonthErr } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded")
    .gte("queued_at", monthStart)
    .lt("queued_at", monthEnd);

  if (importMonthErr) {
    console.error("[quota-status] import month error:", importMonthErr);
  }

  const { count: importAllTime = 0, error: importAllErr } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded");

  if (importAllErr) {
    console.error("[quota-status] import all-time error:", importAllErr);
  }

  // Evaluate-brug (exam_sessions, source_type='trainer')
  const { count: evalThisMonth = 0, error: evalMonthErr } = await supabase
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);

  if (evalMonthErr) {
    console.error("[quota-status] eval month error:", evalMonthErr);
  }

  const { count: evalAllTime = 0, error: evalAllErr } = await supabase
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer");

  if (evalAllErr) {
    console.error("[quota-status] eval all-time error:", evalAllErr);
  }

  // Returnér både de "nye" feltnavne (monthlyLimit) og de eksisterende (limitPerMonth)
  // så UI kan være bagudkompatibel.
  return NextResponse.json({
    ok: true,
    ownerId,
    now: now.toISOString(),
    monthStart,
    monthEnd,
    profile,
    import: {
      usedThisMonth: importThisMonth,
      totalAllTime: importAllTime,
      // eksisterende:
      limitPerMonth: importLimit,
      // ui-venlig:
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
