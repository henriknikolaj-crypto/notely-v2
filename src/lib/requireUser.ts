import { redirect } from "next/navigation";
import { supabaseServerRSC } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await supabaseServerRSC();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  return user;
}