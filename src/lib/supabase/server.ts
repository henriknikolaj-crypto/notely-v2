/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Read-only i Server Components */
export async function await getSupabaseServer() {
  const store = await cookies(); // <- await i Next 15.5
  return createServerClient(url, key, {
    cookies: {
      get: (name: string) => store.get(name)?.value,
      set: () => {},       // no-op i RSC
      remove: () => {},    // no-op i RSC
    },
  });
}

/** Read/Write i Route Handlers & Server Actions */
export async function supabaseServerRoute() {
  const store = await cookies(); // <- await i routes
  return createServerClient(url, key, {
    cookies: {
      get: (name: string) => store.get(name)?.value,
      set: (name: string, value: string, options: any) => {
        try { store.set({ name, value, ...options }); } catch {}
      },
      remove: (name: string, options: any) => {
        try { store.set({ name, value: "", ...options, maxAge: 0 }); } catch {}
      },
    },
  });
}

