import { supabaseServerRSC } from "@/lib/supabase/server";

export async function getUserOrNull() {
  const supabase = await supabaseServerRSC();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function requireUser() {
  const user = await getUserOrNull();
  if (!user) throw new Error("Unauthorized");
  return user;
}
