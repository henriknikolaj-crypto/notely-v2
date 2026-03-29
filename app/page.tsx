import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const code = firstParam(params.code);
  const type = firstParam(params.type);

  if (code) {
    const nextSearch = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        if (typeof entry === "string" && entry.length > 0) nextSearch.append(key, entry);
      }
    }
    const target = type === "recovery" ? "/auth/reset" : "/auth/callback";
    const suffix = nextSearch.toString();
    redirect(suffix ? `${target}?${suffix}` : target);
  }

  try {
    const sb = await supabaseServerRSC();
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) redirect("/traener");
  } catch {
    // ignore
  }
  redirect("/auth/login");
}
