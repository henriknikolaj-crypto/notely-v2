export type Plan = "free" | "basic" | "pro";

export function canUseEvaluate(
  plan: Plan,
  usageToday: number,
  planLimits = { free: 5, basic: 50, pro: 9999 }
) {
  const limit =
    plan === "free" ? planLimits.free :
    plan === "basic" ? planLimits.basic :
    planLimits.pro;

  const remaining = Math.max(0, limit - usageToday);
  return { ok: remaining > 0, remaining, limit };
}
