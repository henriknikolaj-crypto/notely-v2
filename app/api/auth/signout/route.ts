import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export async function POST() {
  const supabase = await supabaseServerRoute();
  await supabase.auth.signOut();

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return NextResponse.redirect(new URL("/", base));
}








