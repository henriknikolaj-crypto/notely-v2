// lib/rateLimit.ts
import "server-only";

import { createClient } from "@supabase/supabase-js";

type RateLimitOk = { ok: true };
type RateLimitBlocked = { ok: false; status: 429; message: string; retryAfterMs: number };
type RateLimitUnavailable = { ok: false; status: 503; message: string; retryAfterMs: number };
export type RateLimitResult = RateLimitOk | RateLimitBlocked | RateLimitUnavailable;

function getServiceClient(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("[rateLimit] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function formatWait(ms: number) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s === 1 ? "1 sekund" : `${s} sekunder`;
}

export async function enforceRateLimit(
  ownerId: string,
  key: string,
  opts: { limit: number; windowSeconds: number; minIntervalMs?: number },
  actionLabel?: string,
): Promise<RateLimitResult> {
  const sb = getServiceClient();
  if (!sb) {
    return {
      ok: false,
      status: 503,
      retryAfterMs: 1000,
      message: "Kunne ikke tjekke hastighedsgrænsen lige nu. Prøv igen om lidt.",
    };
  }

  const { data, error } = await sb.rpc("rate_limit_check", {
    p_owner_id: ownerId,
    p_key: key,
    p_limit: opts.limit,
    p_window_seconds: opts.windowSeconds,
    p_min_interval_ms: opts.minIntervalMs ?? 0,
  });

  if (error) {
    console.error("[rateLimit] rpc error:", error);
    return {
      ok: false,
      status: 503,
      retryAfterMs: 1000,
      message: "Kunne ikke tjekke hastighedsgrænsen lige nu. Prøv igen om lidt.",
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const allowed = !!row?.allowed;
  const retryMs = Number(row?.retry_after_ms ?? 0) || 0;

  if (!allowed) {
    const label = actionLabel || "For mange kald";
    const ms = retryMs > 0 ? retryMs : 1000;
    return {
      ok: false,
      status: 429,
      retryAfterMs: ms,
      message: `${label}: vent ${formatWait(ms)} og prøv igen.`,
    };
  }

  return { ok: true };
}
