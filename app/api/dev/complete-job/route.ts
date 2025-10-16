/* eslint-disable @typescript-eslint/no-explicit-any */
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

function envNum(name: string, dflt: number) {
  const v = process.env[name];
  if (!v) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function envRate(name: string, dflt: number) {
  let r = envNum(name, dflt);
  if (r < 0) r = 0;
  if (r > 1) r = 1;
  return r;
}
function randInt(min: number, max: number) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export async function POST(_req: Request) {
  const hdrs = await headers();
  if (hdrs.get("x-shared-secret") !== process.env.IMPORT_SHARED_SECRET) {
    return Response.json({ ok:false, error:"Unauthorized" }, { status: 401 });
  }

  let id: string | undefined;
  try { const b = await _req.json(); id = b?.id; } catch {}
  if (!id) return Response.json({ ok:false, error:"Missing id" }, { status: 400 });

  // Read simulation knobs from env
  const failRate   = envRate("DEV_SMOKE_FAIL_RATE", 0.2);       // 20% default fail
  const tMin       = envNum("DEV_SMOKE_TOKENS_MIN", 800);
  const tMax       = envNum("DEV_SMOKE_TOKENS_MAX", 2500);
  const lMin       = envNum("DEV_SMOKE_LATENCY_MIN_MS", 500);
  const lMax       = envNum("DEV_SMOKE_LATENCY_MAX_MS", 3500);

  const simulateFail = Math.random() < failRate;
  const tokens_used  = randInt(tMin, tMax);
  const latency_ms   = randInt(lMin, lMax);
  const status       = simulateFail ? "failed" : "succeeded";
  const errorText    = simulateFail ? "Simulated evaluator failure (dev)" : null;

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const update: any = { status, tokens_used, latency_ms };
  if (errorText !== null) update.error = errorText; // ok hvis kolonnen findes

  const { error } = await supa.from("jobs").update(update).eq("id", id);
  if (error) return Response.json({ ok:false, error: error.message }, { status: 400 });

  return Response.json({ ok:true, id, status, tokens_used, latency_ms, failRate });
}


