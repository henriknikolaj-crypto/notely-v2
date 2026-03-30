export const runtime = "nodejs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { URL } from "url";
import dns from "node:dns/promises";
import https from "node:https";
import { requireDevSecret } from "@/lib/dev/guard";

export async function GET(req: NextRequest) {
  const guard = requireDevSecret(req);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.message }, { status: guard.status });
  }

  const baseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)!;
  const u = new URL(baseUrl);
  const host = u.hostname;

  let dnsInfo: any;
  let httpsStatus: any = null;
  let httpsError: any = null;
  try { dnsInfo = await dns.lookup(host, { all: true }); } catch (e: any) { dnsInfo = { error: e?.message }; }

  try {
    httpsStatus = await new Promise((resolve, reject) => {
      const req = https.request({
        method: "GET",
        host,
        path: "/rest/v1/plan_limits?select=plan&limit=1",
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` },
        timeout: 8000,
        rejectUnauthorized: false,
      }, res => { res.resume(); resolve({ statusCode: res.statusCode }); });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.end();
    });
  } catch (e: any) {
    httpsError = { name: e?.name, message: e?.message, code: e?.code, errno: e?.errno };
  }

  return NextResponse.json({ host, dns: dnsInfo, httpsStatus, httpsError });
}
