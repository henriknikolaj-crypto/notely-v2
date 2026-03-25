import "server-only";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export function supabaseServerRouteReadOnly(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll() {
        // Read-only auth lookup til preview-følsomme API-kald.
      },
    },
  });
}
