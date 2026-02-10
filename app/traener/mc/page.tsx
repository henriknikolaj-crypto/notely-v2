// app/traener/mc/page.tsx
import "server-only";

import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientMC from "./ClientMC";

export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // ignore – falder tilbage til DEV_USER_ID
  }
  return process.env.DEV_USER_ID ?? null;
}

function parseScopeFolderIds(sp: Record<string, string | string[]>) {
  const scopeRaw = (sp as any)?.scope;
  let out: string[] = [];

  if (typeof scopeRaw === "string" && scopeRaw.trim().length > 0) {
    out = scopeRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(scopeRaw)) {
    out = scopeRaw
      .join(",")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // uniq
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const id of out) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  return uniq;
}

async function getFolderNames(sb: any, ownerId: string, folderIds: string[]) {
  if (!folderIds.length) return [];
  const { data, error } = await sb
    .from("folders")
    .select("id,name")
    .eq("owner_id", ownerId)
    .in("id", folderIds);

  if (error) {
    console.error("[mc/page] folders load error:", error);
    return [];
  }

  const map = new Map<string, string>();
  for (const r of (data ?? []) as any[]) {
    const id = String(r.id);
    const name = String(r.name ?? "").trim();
    if (id && name) map.set(id, name);
  }

  // behold samme rækkefølge som scopeFolderIds
  return folderIds.map((id) => map.get(id) ?? "Ukendt mappe");
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <section className="p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </section>
    );
  }

  const sp = (await searchParams) ?? {};
  const scopeFolderIds = parseScopeFolderIds(sp);
  const names = await getFolderNames(sb, ownerId, scopeFolderIds);

  const primary = names[0] ?? null;
  const label =
    primary && scopeFolderIds.length > 0
      ? scopeFolderIds.length > 1
        ? `${primary} (+${scopeFolderIds.length - 1})`
        : primary
      : "Vælg mappe i venstre side";

  return (
    <section className="space-y-4">
      <header className="mb-2 border-b border-zinc-200 pb-3">
        <h1 className="text-lg font-semibold">Multiple Choice</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Træn på dit eget pensum. Du vælger mapper i venstre side og starter, når du er klar.
        </p>
      </header>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-[11px] font-semibold tracking-wide text-zinc-500">DU TRÆNER PÅ</div>
        <div className="mt-1 text-sm font-semibold text-zinc-900">{label}</div>
        <div className="mt-1 text-xs text-zinc-600">
          Du kan ændre mapper i venstre side, før du starter en runde.
        </div>

        <div className="mt-4">
          <ClientMC scopeFolderIds={scopeFolderIds} />
        </div>
      </div>
    </section>
  );
}
