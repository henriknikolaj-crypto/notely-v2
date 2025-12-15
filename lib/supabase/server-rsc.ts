// lib/supabase/server-rsc.ts
import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function supabaseServerRSC() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase URL/key missing in env (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            (cookieStore as any).set({ name, value, ...options });
          }
        } catch {
          // ignore (RSC kan ikke altid sætte cookies)
        }
      },
    },
  });
}

// Backwards-compatible alias (så ældre filer stadig bygger)
export const getSupabaseServer = supabaseServerRSC;
