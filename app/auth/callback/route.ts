import { NextResponse } from "next/server"
import { supabaseServerRoute } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") || "/exam"

  const supabase = await supabaseServerRoute()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      const url = new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, request.url)
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.redirect(new URL(next, request.url))
}
