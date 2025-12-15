/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";

export type JobRow = {
  id: string;
  status: "queued" | "succeeded" | "failed";
  error: string | null;
  attempts: number;
  max_attempts: number;
};

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function supaService() {
  return createClient(SUPA_URL, SUPA_SERVICE);
}

function backoffMs(attempts: number) {
  const base = 30_000;                  // 30s
  const ms = base * Math.max(1, Math.pow(2, attempts));
  return Math.min(ms, 120_000);         // cap 2 min
}

export async function markFailedWithAutoRetry(jobId: string, errMsg: string) {
  const supa = supaService();

  const { data: job, error: getErr } = await supa
    .from("jobs")
    .select("id, attempts, max_attempts")
    .eq("id", jobId)
    .single();

  if (getErr || !job) {
    await supa.from("jobs").update({ status: "failed", error: errMsg }).eq("id", jobId);
    return;
  }

  const attempts = (job.attempts ?? 0) + 1;
  const allowRetry = attempts <= (job.max_attempts ?? 2);

  if (allowRetry) {
    const delay = backoffMs(attempts - 1);
    const next = new Date(Date.now() + delay).toISOString();

    await supa.from("jobs").update({
      status: "queued",
      error: errMsg,
      attempts,
      next_retry_at: next,
      started_at: null,
      finished_at: null,
    }).eq("id", jobId);
  } else {
    await supa.from("jobs").update({
      status: "failed",
      error: errMsg,
      attempts,
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}

export async function markSucceeded(jobId: string, patch?: Record<string, any>) {
  const supa = supaService();
  await supa.from("jobs").update({
    status: "succeeded",
    error: null,
    finished_at: new Date().toISOString(),
    ...(patch ?? {}),
  }).eq("id", jobId);
}

export async function requeueNow(jobId: string) {
  const supa = supaService();
  await supa.from("jobs").update({
    status: "queued",
    next_retry_at: new Date().toISOString(),
    error: null,
    started_at: null,
    finished_at: null,
  }).eq("id", jobId);
}


