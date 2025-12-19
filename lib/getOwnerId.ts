import "server-only";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export async function getOwnerIdFromServer() {
  const sb = await supabaseServerRoute();

  try {
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user?.id) return { sb, ownerId: data.user.id as string };
  } catch {
    // ignore
  }

  // Ingen DEV fallback
  return { sb, ownerId: null as string | null };
}
