/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

// Re-exports så du kan importere direkte fra "@/lib/supabase/server"
export { createServerClient };
export type { CookieOptions };

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Brug i RSC (pages/layouts/server components)
export async function supabaseServerRSC() {
  const cookieStore = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options as CookieOptions);
          });
        } catch {}
      },
    },
  });
}

// Brug i Route Handlers (app/api/*)
export async function supabaseServerRoute() {
  const cookieStore = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options as CookieOptions);
          });
        } catch {}
      },
    },
  });
}

// Service-role (ingen cookies)
export function supabaseService() {
  return createServerClient(URL, SERVICE, {
    cookies: {
      getAll() { return []; },
      setAll(_cookies) {},
    },
  });
}

