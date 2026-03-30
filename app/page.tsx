import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function appendSearchParams(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (typeof entry === "string" && entry.length > 0) search.append(key, entry);
    }
  }
  return search.toString();
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const code = firstParam(params.code);
  const type = firstParam(params.type);
  const authError = firstParam(params.error);
  const authErrorCode = firstParam(params.error_code);
  const authErrorDescription = firstParam(params.error_description);

  if (code) {
    const suffix = appendSearchParams(params);
    const target = type === "recovery" ? "/auth/reset" : "/auth/callback";
    redirect(suffix ? `${target}?${suffix}` : target);
  }

  if (authError || authErrorCode || authErrorDescription) {
    const suffix = appendSearchParams(params);
    const target = type === "recovery" ? "/auth/reset" : "/auth/callback";
    const fallbackTarget = target === "/auth/reset" ? "/auth/reset" : "/auth/login";
    redirect(suffix ? `${fallbackTarget}?${suffix}` : fallbackTarget);
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
