import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(url, anon, {
    cookies: {
      get: (k:string) => cookieStore.get(k)?.value,
      set: () => {},
      remove: () => {},
    },
  });
}

