import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const sb = await supabaseServerRSC();
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) redirect("/traener");
  } catch {
    // ignore
  }
  redirect("/auth/login");
}
