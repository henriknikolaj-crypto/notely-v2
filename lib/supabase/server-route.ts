import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

function withRootPath(options?: Record<string, unknown>) {
  return { ...(options ?? {}), path: "/" };
}

export async function supabaseServerRoute(request?: NextRequest, response?: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (request && response) {
    return createServerClient(url, anon, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const c of cookiesToSet) {
            request.cookies.set(c.name, c.value);
            response.cookies.set(c.name, c.value, withRootPath(c.options));
          }
        },
      },
    });
  }

  const cookieStore = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) {
          cookieStore.set(c.name, c.value, withRootPath(c.options));
        }
      },
    },
  });
}
