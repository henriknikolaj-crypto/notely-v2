// app/api/env-debug/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireDevSecret } from "@/lib/dev/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireDevSecret(req);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.message }, { status: guard.status });
  }

  return NextResponse.json({
    ok: true,
    node_env: process.env.NODE_ENV,
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
    supa_url: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    has_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    has_import_shared_secret: Boolean(process.env.IMPORT_SHARED_SECRET),
    has_dev_secret: Boolean(
      String(process.env.DEV_BYPASS_SECRET ?? process.env.DEV_SECRET ?? "").trim(),
    ),
  });
}
