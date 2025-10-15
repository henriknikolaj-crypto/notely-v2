import { createServerClient } from "@/lib/supabase/server";

export async function getUserOrNull() {
  const supabase = await await await createServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function requireUser() {
  const user = await getUserOrNull();
  if (!user) throw new Error("AUTH_REQUIRED");
  return user;
}
