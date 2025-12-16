// lib/plan/limits.ts
// Lille helper til at slå brugerens plan + kvoter (plan_limits) op ét sted.

 

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
    const plan = (rawPlan || "freemium") as PlanCode;
    return plan;
  } catch (err) {
    console.error("[plan] getUserPlan exception:", err);
    return "freemium";
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
    const { data, error } = await sb
      .from("plan_limits")
      .select(
        "plan, oral_minutes_per_month, evals_per_month, mc_questions_per_month, max_files, max_folders",
      )
      .eq("plan", plan)
      .maybeSingle();

    if (error) {
      console.error("[plan] getPlanLimits error:", error);
    }

    if (!data) {
      // Ingen række i plan_limits → brug fallback defaults
      return buildFallbackLimits(plan);
    }

    const baseFallback = buildFallbackLimits(plan);

    return {
      plan: (data.plan as string) ?? plan,
      oralMinutesPerMonth:
        typeof data.oral_minutes_per_month === "number"
          ? data.oral_minutes_per_month
          : baseFallback.oralMinutesPerMonth,
      evalsPerMonth:
        typeof data.evals_per_month === "number"
          ? data.evals_per_month
          : baseFallback.evalsPerMonth,
      mcQuestionsPerMonth:
        typeof data.mc_questions_per_month === "number"
          ? data.mc_questions_per_month
          : baseFallback.mcQuestionsPerMonth,
      maxFiles:
        typeof data.max_files === "number"
          ? data.max_files
          : baseFallback.maxFiles,
      maxFolders:
        typeof data.max_folders === "number"
          ? data.max_folders
          : baseFallback.maxFolders,
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
