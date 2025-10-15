import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await supabaseServerRoute();
  await supabase.auth.signOut();

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return NextResponse.redirect(new URL("/auth/login", base));
}
