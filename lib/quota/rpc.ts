import "server-only";

import { createClient } from "@supabase/supabase-js";

export type QuotaRpcFeature = "import" | "trainer_round" | "mc_generate" | "flashcards_generate" | "evaluate";

export type QuotaConsumeOk = {
  ok: true;
  used: number;
  limitPerMonth: number | null;
  resetAt: string | null;
  raw: any;
};

export type QuotaConsumeErr = {
  ok: false;
  status: 429 | 503;
  message: string;
  used: number;
  limitPerMonth: number | null;
  resetAt: string | null;
  raw: any;
};

function n0(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function toIsoOrNull(x: any): string | null {
  const s = String(x ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

function rollForwardMonthly(resetAt: Date, now: Date) {
  const r = new Date(resetAt.getTime());
  while (r.getTime() <= now.getTime()) r.setUTCMonth(r.getUTCMonth() + 1);
  return r;
}

function getMonthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const reset = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  return {
    monthStart: start.toISOString(),
    resetAt: reset.toISOString(),
  };
}

function getCycleBoundsFromRenewAtUTC(quotaRenewAtIso: string | null, now = new Date()) {
  if (!quotaRenewAtIso) return null;
  const d = new Date(quotaRenewAtIso);
  if (Number.isNaN(d.getTime())) return null;
  const reset = rollForwardMonthly(d, now);
  const start = new Date(reset.getTime());
  start.setUTCMonth(start.getUTCMonth() - 1);
  return {
    monthStart: start.toISOString(),
    resetAt: reset.toISOString(),
  };
}

async function quotaTryConsumeFallback(opts: {
  admin: any;
  ownerId: string;
  feature: QuotaRpcFeature;
  amount: number;
  exceededMessage: string;
  rpcError: any;
}): Promise<QuotaConsumeOk | QuotaConsumeErr> {
  const { admin, ownerId, feature, amount, exceededMessage, rpcError } = opts;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("plan, quota_renew_at")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      status: 503,
      message: "Kunne ikke tjekke din grænse lige nu. Prøv igen om lidt.",
      used: 0,
      limitPerMonth: null,
      resetAt: null,
      raw: { rpcError, profileError },
    };
  }

  const plan = normalizePlan((profile as any)?.plan ?? "freemium");
  const bounds =
    getCycleBoundsFromRenewAtUTC((profile as any)?.quota_renew_at ?? null, new Date()) ??
    getMonthBoundsUTC(new Date());

  const { data: planLimitRow, error: planLimitError } = await admin
    .from("plan_limits")
    .select("monthly_limit, is_unlimited")
    .eq("plan", plan)
    .eq("feature", feature)
    .maybeSingle();

  if (planLimitError || !planLimitRow) {
    return {
      ok: false,
      status: 503,
      message: "Kunne ikke tjekke din grænse lige nu. Prøv igen om lidt.",
      used: 0,
      limitPerMonth: null,
      resetAt: bounds.resetAt,
      raw: { rpcError, planLimitError, plan, feature },
    };
  }

  const limitPerMonth =
    planLimitRow?.is_unlimited === true
      ? null
      : planLimitRow?.monthly_limit == null
        ? null
        : n0(planLimitRow.monthly_limit);

  const { data: existingUsage, error: usageError } = await admin
    .from("quota_usage")
    .select("used, reserved, reset_at")
    .eq("owner_id", ownerId)
    .eq("feature", feature)
    .eq("month_start", bounds.monthStart)
    .maybeSingle();

  if (usageError) {
    return {
      ok: false,
      status: 503,
      message: "Kunne ikke tjekke din grænse lige nu. Prøv igen om lidt.",
      used: 0,
      limitPerMonth,
      resetAt: bounds.resetAt,
      raw: { rpcError, usageError, plan, feature, monthStart: bounds.monthStart },
    };
  }

  const used = n0((existingUsage as any)?.used);
  const nextUsed = used + Math.max(0, Math.round(Number(amount) || 0));

  if (typeof limitPerMonth === "number" && nextUsed > limitPerMonth) {
    return {
      ok: false,
      status: 429,
      message: exceededMessage,
      used,
      limitPerMonth,
      resetAt: toIsoOrNull((existingUsage as any)?.reset_at) ?? bounds.resetAt,
      raw: { fallback: true, plan, feature, rpcError, used, limitPerMonth },
    };
  }

  if (amount > 0) {
    const { error: writeError } = await admin.from("quota_usage").upsert(
      {
        owner_id: ownerId,
        feature,
        month_start: bounds.monthStart,
        reset_at: bounds.resetAt,
        used: nextUsed,
        reserved: n0((existingUsage as any)?.reserved),
      },
      { onConflict: "owner_id,feature,month_start" },
    );

    if (writeError) {
      return {
        ok: false,
        status: 503,
        message: "Kunne ikke tjekke din grænse lige nu. Prøv igen om lidt.",
        used,
        limitPerMonth,
        resetAt: bounds.resetAt,
        raw: { rpcError, writeError, plan, feature, monthStart: bounds.monthStart },
      };
    }
  }

  return {
    ok: true,
    used: amount > 0 ? nextUsed : used,
    limitPerMonth,
    resetAt: toIsoOrNull((existingUsage as any)?.reset_at) ?? bounds.resetAt,
    raw: {
      fallback: true,
      plan,
      feature,
      rpcError,
      monthStart: bounds.monthStart,
    },
  };
}

export function supabaseAdminOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function quotaTryConsume(opts: {
  admin: any;
  ownerId: string;
  feature: QuotaRpcFeature;
  amount: number;
  exceededMessage: string;
}): Promise<QuotaConsumeOk | QuotaConsumeErr> {
  const { admin, ownerId, feature, amount, exceededMessage } = opts;

  const rpc = await admin.rpc("quota_try_consume", {
    p_owner_id: ownerId,
    p_feature: feature,
    p_amount: Math.max(0, Math.round(Number(amount) || 0)),
  });

  if (rpc?.error) {
    return quotaTryConsumeFallback({
      admin,
      ownerId,
      feature,
      amount,
      exceededMessage,
      rpcError: rpc.error,
    });
  }

  const row = Array.isArray(rpc?.data) ? rpc.data[0] : rpc?.data;
  const allowed = !!row?.ok;
  const used = n0(row?.out_used);
  const limitPerMonth = row?.out_monthly_limit == null ? null : n0(row?.out_monthly_limit);
  const resetAt = toIsoOrNull(row?.out_reset_at);

  if (!allowed) {
    return {
      ok: false,
      status: 429,
      message: exceededMessage,
      used,
      limitPerMonth,
      resetAt,
      raw: row,
    };
  }

  return {
    ok: true,
    used,
    limitPerMonth,
    resetAt,
    raw: row,
  };
}
