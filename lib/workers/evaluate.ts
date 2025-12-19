 
import { createClient } from "@supabase/supabase-js";

// Minimal "claim → process → update" loop for local testing.
// Replace with your proper runner/cron if you have one.
export async function processNextEvaluateJob() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Naive claim: first queued job (you can swap with a RPC using SKIP LOCKED)
  const { data: jobs, error } = await sb
    .from("jobs")
    .select("id, payload")
    .eq("kind", "evaluate")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error || !jobs?.length) return { ok: false, reason: error?.message ?? "no-job" };
  const job = jobs[0];

  try {
    // >>> Your evaluation logic here <<<
    // e.g., iterate job.payload.targets and generate feedback/metrics.

    await sb
      .from("jobs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", job.id);

    return { ok: true, id: job.id };
  } catch (e: any) {
    await sb
      .from("jobs")
      .update({ status: "failed", error: e?.message ?? "error", finished_at: new Date().toISOString() })
      .eq("id", job.id);

    return { ok: false, id: job.id, reason: e?.message };
  }
}


