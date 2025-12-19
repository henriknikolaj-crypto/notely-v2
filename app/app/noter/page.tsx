// app/page.tsx
import "server-only";
import { redirect } from "next/navigation";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

export default async function Home() {
  const sb = await supabaseServerRSC();
  const { data } = await sb.auth.getUser();

  if (data?.user) {
    redirect("/overblik");
  }

  redirect("/auth/login");
}



