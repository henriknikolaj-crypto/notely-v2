// lib/plan/limits.ts
// Lille helper til at slå brugerens plan + kvoter (plan_limits) op ét sted.

 

import { supabaseAdminOrNull } from "@/lib/quota/rpc";

export type PlanCode = "freemium" | "basis" | "pro" | string;

export type PlanLimits = {
  plan: PlanCode;
  oralMinutesPerMonth: number;
  evalsPerMonth: number;
  mcQuestionsPerMonth: number;
  maxFiles: number;
  maxFolders: number;
};

// Samme defaults som vi talte om (bruges som fallback hvis DB mangler rækker/felter)
const DEFAULT_LIMITS_BY_PLAN: Record<string, Omit<PlanLimits, "plan">> = {
  freemium: {
    oralMinutesPerMonth: 0,
    evalsPerMonth: 60,
    mcQuestionsPerMonth: 300,
    maxFiles: 5,
    maxFolders: 1,
  },
  basis: {
    oralMinutesPerMonth: 30,
    evalsPerMonth: 300,
    mcQuestionsPerMonth: 2000,
    maxFiles: 50,
    maxFolders: 10,
  },
  pro: {
    oralMinutesPerMonth: 120,
    evalsPerMonth: 1000,
    mcQuestionsPerMonth: 10000,
    maxFiles: 200,
    maxFolders: 50,
  },
};

function buildFallbackLimits(plan: PlanCode): PlanLimits {
  const base =
    DEFAULT_LIMITS_BY_PLAN[plan] ?? DEFAULT_LIMITS_BY_PLAN["freemium"];
  return {
    plan,
    ...base,
  };
}

export function normalizePlanCode(raw: unknown): PlanCode {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

/**
 * Slår brugerens plan op i profiles.
 * Antagelse: profiles.id == auth.user.id og har en kolonne "plan".
 */
export async function getUserPlan(
  sb: any,
  ownerId: string,
): Promise<PlanCode> {
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("plan")
      .eq("id", ownerId)
      .maybeSingle();

    if (error) {
      console.error("[plan] getUserPlan error:", error);
    }

    const rawPlan = (data?.plan as string | null) ?? null;
    const plan = normalizePlanCode(rawPlan);
    return plan;
  } catch (err) {
    console.error("[plan] getUserPlan exception:", err);
    return "freemium";
  }
}

export async function getCanonicalUserPlan(
  sb: any,
  ownerId: string,
): Promise<{ rawPlan: string | null; normalizedPlan: PlanCode; source: "admin" | "rsc" | "fallback" }> {
  try {
    const admin = supabaseAdminOrNull();
    if (admin) {
      const { data, error } = await admin
        .from("profiles")
        .select("plan")
        .eq("id", ownerId)
        .maybeSingle();
      if (!error) {
        const rawPlan = (data?.plan as string | null) ?? null;
        return {
          rawPlan,
          normalizedPlan: normalizePlanCode(rawPlan),
          source: "admin",
        };
      }
      console.error("[plan] getCanonicalUserPlan admin error:", error);
    }
  } catch (err) {
    console.error("[plan] getCanonicalUserPlan admin exception:", err);
  }

  try {
    const rawPlan = await getUserPlan(sb, ownerId);
    return {
      rawPlan: String(rawPlan ?? "").trim() || null,
      normalizedPlan: normalizePlanCode(rawPlan),
      source: "rsc",
    };
  } catch (err) {
    console.error("[plan] getCanonicalUserPlan rsc exception:", err);
    return {
      rawPlan: null,
      normalizedPlan: "freemium",
      source: "fallback",
    };
  }
}

/**
 * Slår limits op i plan_limits for en given plan.
 * Hvis der ikke findes en række, eller felter er null, falder vi tilbage til DEFAULT_LIMITS_BY_PLAN.
 */
export async function getPlanLimits(
  sb: any,
  plan: PlanCode,
): Promise<PlanLimits> {
  try {
    const baseFallback = buildFallbackLimits(plan);
    const { data, error }: {
      data: Array<{ plan?: string | null; feature?: string | null; monthly_limit?: number | null; is_unlimited?: boolean | null }> | null;
      error: any;
    } = await sb
      .from("plan_limits")
      .select("plan, feature, monthly_limit, is_unlimited")
      .eq("plan", plan);

    if (error) {
      console.error("[plan] getPlanLimits error:", error);
    }

    if (!data) {
      return buildFallbackLimits(plan);
    }

    const byFeature = new Map<string, number | null>();
    for (const row of data) {
      const feature = String(row?.feature ?? "").trim();
      if (!feature) continue;
      if (row?.is_unlimited === true) {
        byFeature.set(feature, null);
        continue;
      }
      const monthlyLimit =
        typeof row?.monthly_limit === "number" ? row.monthly_limit : row?.monthly_limit == null ? null : undefined;
      byFeature.set(feature, monthlyLimit ?? null);
    }

    const trainerRoundLimit = byFeature.get("trainer_round");
    const mcGenerateLimit = byFeature.get("mc_generate");

    return {
      plan: String(data[0]?.plan ?? plan),
      oralMinutesPerMonth:
        baseFallback.oralMinutesPerMonth,
      evalsPerMonth:
        typeof trainerRoundLimit === "number"
          ? trainerRoundLimit
          : baseFallback.evalsPerMonth,
      mcQuestionsPerMonth:
        typeof mcGenerateLimit === "number"
          ? mcGenerateLimit
          : baseFallback.mcQuestionsPerMonth,
      maxFiles:
        baseFallback.maxFiles,
      maxFolders:
        baseFallback.maxFolders,
    };
  } catch (err) {
    console.error("[plan] getPlanLimits exception:", err);
    return buildFallbackLimits(plan);
  }
}

/**
 * Convenience-helper: henter både plan + limits for en given owner_id.
 *
 * Bruges fx i /api/import, /api/evaluate, osv.:
 *
 *   const { plan, limits } = await getPlanAndLimitsForOwner(sb, ownerId);
 */
export async function getPlanAndLimitsForOwner(sb: any, ownerId: string): Promise<{
  plan: PlanCode;
  limits: PlanLimits;
}> {
  const plan = await getUserPlan(sb, ownerId);
  const limits = await getPlanLimits(sb, plan);
  return { plan, limits };
}
