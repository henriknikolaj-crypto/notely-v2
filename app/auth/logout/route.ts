// app/auth/logout/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export async function GET() {
  const supabase = await supabaseServerRSC();

  try {
    const { error } = await supabase.auth.signOut();

    // Ignorér "ingen session"/refresh token fejl i dev,
    // log kun uventede fejl.
    if (
      error &&
      error.code !== "refresh_token_not_found" &&
      error.code !== "session_not_found"
    ) {
      console.error("Logout error:", error);
    }
  } catch (e) {
    console.error("Logout exception:", e);
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return NextResponse.redirect(new URL("/auth/login", base));
}



