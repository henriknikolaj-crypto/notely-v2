import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireDevSecret } from "@/lib/dev/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function present(name: string) {
  return !!String(process.env[name] ?? "").trim();
}

export async function GET(req: NextRequest) {
  const g = requireDevSecret(req);
  if (!g.ok) return NextResponse.json({ ok: false, error: g.message }, { status: g.status });

  const must = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "OPENAI_API_KEY",
  ];

  const optional = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "DEV_USER_ID",
    "DEV_BYPASS_SECRET",
    "OPENAI_MODEL",
    "OPENAI_MODEL_QUESTION",
    "OPENAI_MODEL_MC",
  ];

  const missing = must.filter((k) => !present(k));

  return NextResponse.json({
    ok: missing.length === 0,
    missing,
    must: Object.fromEntries(must.map((k) => [k, present(k)])),
    optional: Object.fromEntries(optional.map((k) => [k, present(k)])),
  });
}
