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
  const { data, error } = await supabaseAdmin.rpc("ensure_quota_and_decrement", {
    p_owner_id: owner_id,
    p_cost: Math.max(1, Number(cost ?? 1)),
  });
  if (error) return { ok: false, remaining: 0, code: `RPC_ERROR:${error.code ?? "UNKNOWN"}` };
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: !!row?.ok, remaining: Number(row?.remaining ?? 0), code: String(row?.code ?? "UNKNOWN") };
}
