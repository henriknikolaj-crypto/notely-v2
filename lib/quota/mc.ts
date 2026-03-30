import "server-only";

import { quotaTryConsume } from "@/lib/quota/rpc";

const MC_QUOTA_EXCEEDED_MESSAGE = "Du har nået din grænse for Multiple Choice denne måned.";

function normalizePlan(raw: unknown) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

async function getPlan(admin: any, ownerId: string) {
  const { data: profile } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
  return normalizePlan((profile as any)?.plan ?? "freemium");
}

function getRemaining(limitPerMonth: number | null, used: number) {
  if (typeof limitPerMonth !== "number") return null;
  return Math.max(0, limitPerMonth - used);
}

export async function getMcQuotaSnapshot(admin: any, ownerId: string) {
  const plan = await getPlan(admin, ownerId);
  const quota = await quotaTryConsume({
    admin,
    ownerId,
    feature: "mc_generate",
    amount: 0,
    exceededMessage: MC_QUOTA_EXCEEDED_MESSAGE,
  });

  return {
    plan,
    ...quota,
    remainingThisMonth: getRemaining(quota.limitPerMonth, quota.used),
  };
}

export async function consumeMcQuota(admin: any, ownerId: string, amount: number) {
  const plan = await getPlan(admin, ownerId);
  const quota = await quotaTryConsume({
    admin,
    ownerId,
    feature: "mc_generate",
    amount,
    exceededMessage: MC_QUOTA_EXCEEDED_MESSAGE,
  });

  return {
    plan,
    ...quota,
    remainingThisMonth: getRemaining(quota.limitPerMonth, quota.used),
  };
}
