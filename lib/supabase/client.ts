import { createBrowserClient as createBrowserClientSSR } from "@supabase/ssr";

export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createBrowserClientSSR(url, anonKey);
}
