/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";

export type QuotaResult = { ok: boolean; remaining: number; code: string };

export function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function ensureQuotaAndDecrement(owner_id: string, cost = 1): Promise<QuotaResult> {
  const supabaseAdmin = getAdminClient();

  const safeCost = Math.max(1, Number(isNaN(Number(cost)) ? 1 : cost));
  const { data, error } = await supabaseAdmin.rpc("ensure_quota_and_decrement", {
    p_owner_id: owner_id,
    p_cost: safeCost,
  });

  if (error) {
    const code = "RPC_ERROR:" + String((error as any)?.code ?? "UNKNOWN");
    return { ok: false, remaining: 0, code };
  }

  const row: any = Array.isArray(data) ? (data as any[])[0] : (data as any);
  return {
    ok: !!row?.ok,
    remaining: Number(row?.remaining ?? 0),
    code: String(row?.code ?? "UNKNOWN"),
  };
}

