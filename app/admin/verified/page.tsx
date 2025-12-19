import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import VerifiedClient from "./verified-client";

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
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set() {}, remove() {} } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect("/");

  const { data } = await supabase
    .from("verified_sources")
    .select("domain, weight, language, note")
    .order("weight", { ascending: false })
    .order("domain", { ascending: true })
    .limit(500);

  return <VerifiedClient initialItems={data ?? []} />;
}


