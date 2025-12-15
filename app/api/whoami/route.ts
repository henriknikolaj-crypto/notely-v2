import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServerRoute();

  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) {
      return NextResponse.json({
        ok: true,
        mode: "auth",
        user: { id: data.user.id, email: data.user.email ?? null },
      });
    }
  } catch {}

  const dev = (process.env.DEV_USER_ID ?? "").trim();
  if (process.env.NODE_ENV !== "production" && dev) {
    return NextResponse.json({
      ok: true,
      mode: "dev",
      user: { id: dev, email: null },
    });
  }

  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
