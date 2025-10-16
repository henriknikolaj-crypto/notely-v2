"use client";

import { createBrowserClient as createSSRBrowserClient } from "@supabase/ssr";

/** Client-side Supabase til brug i "use client" komponenter (login mm.) */
export function createBrowserClient() {
  return createSSRBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

