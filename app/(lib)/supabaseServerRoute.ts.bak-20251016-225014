import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client til Route Handlers.
 * Bruger SERVICE_ROLE_KEY når den findes (skriv/adm rettigheder),
 * ellers falder den tilbage til ANON (read/limited write afh. RLS).
 */
export async function supabaseServerRoute() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL mangler i .env.local");
  }
  if (!serviceKey && !anon) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY eller NEXT_PUBLIC_SUPABASE_ANON_KEY mangler i .env.local");
  }

  const key = serviceKey ?? anon!;
  const client = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "notely-v2-route" } },
  });

  return client;
}

