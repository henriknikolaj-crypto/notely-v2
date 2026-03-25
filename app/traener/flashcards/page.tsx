import "server-only";

import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import TrainingScopeCard from "../_ui/TrainingScopeCard";
import FlashcardsClient from "./FlashcardsClient";
import FeatureScopePicker from "@/components/training/FeatureScopePicker";

export const dynamic = "force-dynamic";

type SearchParams =
  | Record<string, string | string[] | undefined>
  | undefined;

function parseScopeIds(scopeRaw: unknown): string[] {
  if (typeof scopeRaw === "string") {
    return scopeRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (Array.isArray(scopeRaw)) {
    return scopeRaw
      .join(",")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // ignore
  }
  return null;
}

async function getResolvedScope(sb: any, ownerId: string, folderIds: string[]) {
  if (!folderIds.length) return { scopeFolderIds: [] as string[], names: [] as string[] };
  const { data, error } = await sb
    .from("folders")
    .select("id,name")
    .eq("owner_id", ownerId)
    .in("id", folderIds);

  if (error) {
    console.error("[flashcards/page] folders load error:", error);
    return { scopeFolderIds: [] as string[], names: [] as string[] };
  }

  const map = new Map<string, string>();
  for (const r of (data ?? []) as any[]) {
    const id = String(r.id);
    const name = String(r.name ?? "").trim();
    if (id && name) map.set(id, name);
  }

  const scopeFolderIds = folderIds.filter((id) => map.has(id));
  const names = scopeFolderIds.map((id) => map.get(id) as string);
  return { scopeFolderIds, names };
}

async function listFolderOptions(sb: any, ownerId: string) {
  const { data, error } = await sb
    .from("folders")
    .select("id,name")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("[flashcards/page] folder options load error:", error);
    return [] as Array<{ id: string; name: string }>;
  }

  return ((data ?? []) as any[])
    .map((row) => {
      const id = String(row?.id ?? "").trim();
      const name = String(row?.name ?? "").trim();
      if (!id || !name) return null;
      return { id, name };
    })
    .filter(Boolean) as Array<{ id: string; name: string }>;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);
  if (!ownerId) {
    return (
      <section className="space-y-4">
        <header className="mb-2 border-b border-zinc-200 pb-3">
          <h1 className="text-lg font-semibold">Flashcards</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Træn på dit eget pensum. Generér kort til hurtig repetition af begreber,
            formler og nøglepointer.
          </p>
        </header>
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
          Flashcards-indholdet opdateres lige nu.
        </section>
      </section>
    );
  }

  const sp = (await searchParams) ?? {};
  const requestedScopeFolderIds = parseScopeIds(sp.scope);
  const folderOptions = await listFolderOptions(sb, ownerId);
  const resolvedScope = await getResolvedScope(sb, ownerId, requestedScopeFolderIds);
  const scopeFolderIds = resolvedScope.scopeFolderIds;
  const names = resolvedScope.names;
  const hasScope = scopeFolderIds.length > 0;

  return (
    <section className="space-y-4">
      <header className="mb-2 border-b border-zinc-200 pb-3">
        <h1 className="text-lg font-semibold">Flashcards</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Træn på dit eget pensum. Generér kort til hurtig repetition af begreber,
          formler og nøglepointer.
        </p>
      </header>

      <TrainingScopeCard
        names={names}
        className="md:hidden"
        emptyLabel="Vælg en mappe direkte her."
        helpText={!hasScope ? "Flashcards er låst, indtil du har valgt en mappe." : undefined}
      >
        <FeatureScopePicker selectedNames={names} selectedScopeIds={scopeFolderIds} initialFolders={folderOptions} />
      </TrainingScopeCard>
      <TrainingScopeCard
        names={names}
        className="hidden md:block"
        emptyLabel="Vælg en mappe i venstre side."
        helpText={!hasScope ? "Flashcards er låst, indtil du har valgt en mappe." : undefined}
      />

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <FlashcardsClient scopeFolderIds={scopeFolderIds} />
      </div>
    </section>
  );
}
