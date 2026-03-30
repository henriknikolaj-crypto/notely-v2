// lib/quota.ts
import { createClient } from "@supabase/supabase-js";

export type QuotaFeature = "import" | "evaluate" | "trainer_round";

type QuotaOk = { ok: true; remaining: number | null };
type QuotaError = { ok: false; status: number; message: string };
export type QuotaResult = QuotaOk | QuotaError;

/** Supabase-service-klient (bypasser RLS). */
function getServiceClient(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "[quota] Mangler NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY.",
    );
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** UTC månedsvindue (end exclusive). */
function getMonthWindowUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: resetAt.toISOString() };
}

/**
 * Hent månedlig limit for plan+feature fra plan_limits.
 * semantics:
 * - undefined => mangler række i plan_limits (opsætningsfejl)
 * - null      => ∞ (ingen månedlig grænse)
 * - number    => månedlig grænse
 */
async function loadMonthlyLimit(
  supabase: any,
  plan: string,
  feature: QuotaFeature,
): Promise<number | null | undefined> {
  const { data, error } = await supabase
    .from("plan_limits")
    .select("monthly_limit, is_unlimited")
    .eq("plan", plan)
    .eq("feature", feature)
    .maybeSingle();

  if (error) {
    console.error("[quota] plan_limits error:", error);
    return undefined;
  }

  if (!data) return undefined;

  if ((data as any)?.is_unlimited === true) return null;

  const v = (data as any)?.monthly_limit;

  // NULL => ∞
  if (v == null) return null;

  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function missingLimitsMessage(feature: QuotaFeature) {
  return `Plan limits mangler for ${feature}. Tjek plan_limits.`;
}

/** Robust count af jobs pr. måned. */
async function countJobsThisMonth(opts: {
  supabase: any;
  ownerId: string;
  kind: string;
  statuses?: string[];
}): Promise<number> {
  const { supabase, ownerId, kind, statuses } = opts;
  const { startIso, endIso } = getMonthWindowUTC();

  const tsCols: Array<"queued_at" | "created_at" | "inserted_at"> = ["queued_at", "created_at", "inserted_at"];

  for (const tsCol of tsCols) {
    if (statuses?.length) {
      const r1 = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("kind", kind)
        .in("status", statuses)
        .gte(tsCol, startIso)
        .lt(tsCol, endIso);

      if (!r1.error && r1.count != null) return r1.count ?? 0;
    }

    const r2 = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", kind)
      .gte(tsCol, startIso)
      .lt(tsCol, endIso);

    if (!r2.error && r2.count != null) return r2.count ?? 0;
  }

  return 0;
}

/** Tæl forbrug denne måned. */
async function countUsageThisMonth(
  supabase: any,
  ownerId: string,
  feature: QuotaFeature,
): Promise<number> {
  if (feature === "import") {
    return countJobsThisMonth({
      supabase,
      ownerId,
      kind: "import",
      statuses: ["succeeded", "finished", "completed"],
    });
  }

  if (feature === "trainer_round") {
    return countJobsThisMonth({
      supabase,
      ownerId,
      kind: "trainer_round",
      statuses: ["succeeded"],
    });
  }

  // evaluate
  return countJobsThisMonth({
    supabase,
    ownerId,
    kind: "evaluate",
    statuses: ["succeeded"],
  });
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
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      message: "Kunne ikke tjekke din grænse lige nu. Prøv igen om lidt.",
    };
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota] profile error:", profileErr);

  const plan = ((profile as any)?.plan as string | undefined) ?? "freemium";

  const limit = await loadMonthlyLimit(supabase, plan, feature);

  // Mangler række i plan_limits => opsætningsfejl
  if (limit === undefined) {
    return { ok: false, status: 500, message: missingLimitsMessage(feature) };
  }

  // NULL => ∞
  if (limit === null) {
    return { ok: true, remaining: null };
  }

  const effectiveCost = Number.isFinite(cost) && cost > 0 ? cost : 1;
  const used = await countUsageThisMonth(supabase, ownerId, feature);
  const wouldUse = used + effectiveCost;

  // 0 eller negativ => ingen adgang
  if (limit <= 0) {
    const msg =
      feature === "import"
        ? "Din plan har ikke adgang til uploads."
        : feature === "trainer_round"
          ? "Din plan har ikke adgang til Træner-runder."
          : "Din plan har ikke adgang til evalueringer.";
    return { ok: false, status: 429, message: msg };
  }

  if (wouldUse > limit) {
    const remainingNow = Math.max(0, limit - used);

    const msg =
      feature === "import"
        ? "Du har brugt alle uploads for denne måned på din nuværende plan."
        : feature === "trainer_round"
          ? "Du har brugt alle Træner-runder for denne måned på din nuværende plan."
          : "Du har brugt alle evalueringer for denne måned på din nuværende plan.";

    return {
      ok: false,
      status: 429,
      message:
        remainingNow > 0
          ? `${msg} (Du har ${remainingNow} tilbage, men dette kald ville overskride grænsen.)`
          : msg,
    };
  }

  return { ok: true, remaining: limit - wouldUse };
}
