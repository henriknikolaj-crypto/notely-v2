import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export async function POST(req: Request) {
  try {
    const { access_token, refresh_token } = (await req.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!access_token || !refresh_token) {
      return NextResponse.json({ ok: false, error: "Missing tokens" }, { status: 400 });
    }

    const supabase = await supabaseServerRoute();
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}








