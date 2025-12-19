// app/(lib)/db.ts
import "server-only";

import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

/**
 * Små helpers så vi undgår top-level await.
 * Brug dbRSC() i server components og dbRoute() i route handlers.
 */
export async function dbRSC() {
  return supabaseServerRSC();
}

export async function dbRoute() {
  return supabaseServerRoute();
}
