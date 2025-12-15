/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseServerRoute } from "@/lib/supabaseServer";

export async function requireUser() {
  const supabase = await supabaseServerRoute();          //  await
  const { data } = await supabase.auth.getUser();
  if (data?.user?.id) return { id: data.user.id };

  const dev = process.env.DEV_USER_ID;
  if (!dev) throw new Error("Not authenticated and no DEV_USER_ID set");
  return { id: dev };
}


