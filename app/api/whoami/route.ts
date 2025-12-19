// app/api/whoami/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const host = req.headers.get("host") ?? null;

  const cookieNames = req.cookies.getAll().map((c) => c.name);
  const hasSbCookies = cookieNames.some((n) => n.startsWith("sb-"));

  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);

  if (!owner) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
        debug: { host, hasSbCookies, cookieNames },
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    mode: owner.mode, // "auth" | "dev"
    user: owner.user ?? { id: owner.ownerId, email: null },
    debug: { host, hasSbCookies, cookieNames },
  });
}
