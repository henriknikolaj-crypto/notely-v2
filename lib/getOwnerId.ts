// lib/getOwnerId.ts
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export async function getOwnerIdFromServer() {
  const sb = await supabaseServerRoute();

  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) return { sb, ownerId: data.user.id as string };
  } catch {
    // ignore auth errors, fallback below
  }

  const dev = process.env.DEV_USER_ID ?? null;
  return { sb, ownerId: dev };
}


