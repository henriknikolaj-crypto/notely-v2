/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server"
import { supabaseServerRSC } from "@/lib/supabase/server-rsc"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") || "/overblik";


  const supabase = await supabaseServerRSC()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      const url = new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, request.url)
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.redirect(new URL(next, request.url))
}





