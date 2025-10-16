/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

async function supaFromCookies() {
  // Next.js 15: cookies() can be async
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options as CookieOptions);
            }
          } catch {
            // ignore SSR set errors
          }
        },
      },
    }
  );
}

export async function GET() {
  const supa = await supaFromCookies();
  const { data } = await supa.auth.getUser();
  return NextResponse.json({ ok: true, authed: !!data?.user });
}


