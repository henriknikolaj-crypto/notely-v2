// lib/supabase/server-route.ts
import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function supabaseServerRoute() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL/key missing in env");

  const cookieStore = (await cookies()) as any;

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        try {
          return cookieStore.getAll();
        } catch {
          return [];
        }
      },
      setAll(cookiesToSet) {
        try {
          for (const c of cookiesToSet) {
            cookieStore.set(c.name, c.value, c.options);
          }
        } catch {
          // ignore
        }
      },
    },
  });
}
