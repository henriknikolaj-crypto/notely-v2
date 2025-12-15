/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";

export type QuotaFeature = "import" | "evaluate";

type QuotaOk = { ok: true; remaining: number | null };
type QuotaError = { ok: false; status: number; message: string };
export type QuotaResult = QuotaOk | QuotaError;

/** Supabase-service-klient (bypasser RLS). */
function getServiceClient(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn(
      "[quota] Mangler NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY – skipper quota-check.",
    );
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

/** Start/slut på nuværende måned (lokal tid). */
function getMonthWindow() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Hent månedlig limit for plan+feature fra plan_limits. */
async function loadMonthlyLimit(
  supabase: any,
  plan: string,
  feature: QuotaFeature,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("plan_limits")
    .select("monthly_limit")
    .eq("plan", plan)
    .eq("feature", feature)
    .maybeSingle();

  if (error) {
    console.error("[quota] plan_limits error:", error);
    return null;
  }

  const monthly = (data as any)?.monthly_limit;
  return typeof monthly === "number" ? monthly : null;
}

/** Tæl forbrug denne måned. */
async function countUsageThisMonth(
  supabase: any,
  ownerId: string,
  feature: QuotaFeature,
): Promise<number> {
  const { startIso, endIso } = getMonthWindow();

  if (feature === "import") {
    const { count, error } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", "import")
      .gte("queued_at", startIso)
      .lte("queued_at", endIso);

    if (error) {
      console.error("[quota] jobs count error (import):", error);
      return 0;
    }
    return count ?? 0;
  }

  const { count, error } = await supabase
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (error) {
    console.error("[quota] exam_sessions count error:", error);
    return 0;
  }

  return count ?? 0;
}

/**
 * ensureQuotaAndDecrement
 * Returnerer ok:false hvis dette kald ville overskride grænsen.
 */
export async function ensureQuotaAndDecrement(
  ownerId: string,
  feature: QuotaFeature,
  cost = 1,
): Promise<QuotaResult> {
  const supabase = getServiceClient();
  if (!supabase) return { ok: true, remaining: null };

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota] profile error:", profileErr);

  const plan = ((profile as any)?.plan as string | undefined) ?? "freemium";

  const limit = await loadMonthlyLimit(supabase, plan, feature);
  if (!limit || limit <= 0) return { ok: true, remaining: null };

  const used = await countUsageThisMonth(supabase, ownerId, feature);

  const effectiveCost = Number.isFinite(cost) && cost > 0 ? cost : 1;
  const wouldUse = used + effectiveCost;

  if (wouldUse > limit) {
    const remainingNow = Math.max(0, limit - used);
    const msg =
      feature === "import"
        ? "Du har brugt alle uploads for denne måned på din nuværende plan."
        : "Du har brugt alle evalueringer for denne måned på din nuværende plan.";

    return {
      ok: false,
      status: 402,
      message:
        remainingNow > 0
          ? `${msg} (Du har ${remainingNow} tilbage, men dette kald ville overskride grænsen.)`
          : msg,
    };
  }

  return { ok: true, remaining: limit - wouldUse };
}
