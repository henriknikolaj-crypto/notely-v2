import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import SourcesClient from "./sources-client";

function isAdmin(email?: string | null) {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && admins.includes(email.toLowerCase());
}

export default async function Page() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set(){}, remove(){} } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect("/");

  const { data } = await supabase
    .from("candidate_sources")
    .select("domain, first_seen, last_seen, hit_count")
    .order("hit_count", { ascending: false })
    .order("last_seen", { ascending: false })
    .limit(200);

  return <SourcesClient initialItems={data ?? []} />;
}


