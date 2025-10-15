import { supabaseServerRoute } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await supabaseServerRoute();
  const { data: { user } } = await supabase.auth.getUser();
  return NextResponse.json({ user });
}
