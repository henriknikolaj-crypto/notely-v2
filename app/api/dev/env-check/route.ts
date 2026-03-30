import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireDevSecret } from "@/lib/dev/guard";

export async function GET(req: NextRequest) {
  const guard = requireDevSecret(req);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.message }, { status: guard.status });
  }

  return Response.json({
    DEV_USER_ID: process.env.DEV_USER_ID ?? null,
    HAS_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    HAS_SECRET: !!process.env.IMPORT_SHARED_SECRET,
  });
}
