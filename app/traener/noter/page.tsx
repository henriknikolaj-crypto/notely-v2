// app/traener/noter/page.tsx
import "server-only";
import { getTrainerSession } from "@/lib/auth/trainer-session";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import TrainingScopeCard from "../_ui/TrainingScopeCard";
import GenerateFromSource from "./ui/GenerateFromSource";
import FeatureScopePicker from "@/components/training/FeatureScopePicker";

export const dynamic = "force-dynamic";

type FileOption = {
  id: string;
  name: string | null;
};

/**
 * Henter filer til Noter-siden.
 *
 * Hvis folderIds er tom, viser vi INGEN filer (brugeren skal vælge fag/mappe i venstre side).
 *
 * Hvis der er valgt mapper, henter vi filer fra files-tabellen (folder_id IN folderIds)
 * og kræver samtidig at filen har doc_chunks via inner join:
 * files -> doc_chunks (doc_chunks.file_id = files.id)
 */
async function listFilesForScope(sb: any, ownerId: string, folderIds: string[]): Promise<FileOption[]> {
  if (!folderIds || folderIds.length === 0) return [];

  // ✅ Robust: hent direkte fra files, men kun hvis der findes mindst én doc_chunk til filen
  // NB: doc_chunks har IKKE folder_id, så vi filtrerer på files.folder_id.
  const fRes = await sb
    .from("files")
    .select("id, name, original_name, folder_id, doc_chunks!inner(id)")
    .eq("owner_id", ownerId)
    .in("folder_id", folderIds)
    .order("name", { ascending: true });

  if (fRes.error) {
    console.error("listFilesForScope: files+doc_chunks join error", fRes.error);
    return [];
  }

  const rows = (fRes.data ?? []) as any[];

  return rows.map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? (row.original_name as string | null),
  }));
}

async function getScopeNames(sb: any, ownerId: string, folderIds: string[]): Promise<string[]> {
  if (!folderIds.length) return [];

  const { data, error } = await sb
    .from("folders")
    .select("id,name")
    .eq("owner_id", ownerId)
    .in("id", folderIds);

  if (error) {
    console.error("[traener/noter] folders load error:", error);
    return [];
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as any[]) {
    const id = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (id && name) map.set(id, name);
  }

  return folderIds.filter((id) => map.has(id)).map((id) => map.get(id) as string);
}

async function listFolderOptions(sb: any, ownerId: string) {
  const { data, error } = await sb
    .from("folders")
    .select("id,name")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("[traener/noter] folder options load error:", error);
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
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const sb = await supabaseServerRSC();
  const { ownerId } = await getTrainerSession();
  if (!ownerId) return null;

  const sp = (await searchParams) ?? {};
  const scopeRaw = sp.scope;

  let scopeFolderIds: string[] = [];

  if (typeof scopeRaw === "string" && scopeRaw.trim().length > 0) {
    scopeFolderIds = scopeRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(scopeRaw)) {
    scopeFolderIds = scopeRaw
      .join(",")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const primaryFolderId = scopeFolderIds[0] ?? null;
  const scopeNames = await getScopeNames(sb, ownerId, scopeFolderIds);
  const folderOptions = await listFolderOptions(sb, ownerId);
  const files = await listFilesForScope(sb, ownerId, scopeFolderIds);
  const hasScope = scopeFolderIds.length > 0;

  return (
    <section className="space-y-4">
      <header className="mb-2 border-b border-zinc-200 pb-3">
        <h1 className="text-lg font-semibold">Noter</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Venstre kolonne vælger scope. De mapper, du har valgt til træning,
          styrer hvilke filer der kan vælges som kilde her.
        </p>
      </header>

      <TrainingScopeCard
        names={scopeNames}
        className="md:hidden"
        emptyLabel="Vælg en mappe direkte her."
        helpText={!hasScope ? "Noter er låst, indtil du har valgt en mappe." : undefined}
      >
        <FeatureScopePicker selectedNames={scopeNames} selectedScopeIds={scopeFolderIds} initialFolders={folderOptions} />
      </TrainingScopeCard>

      <TrainingScopeCard
        names={scopeNames}
        className="hidden md:block"
        emptyLabel="Vælg en mappe i venstre side."
        helpText={!hasScope ? "Noter er låst, indtil du har valgt en mappe." : undefined}
      />

      <GenerateFromSource
        ownerId={ownerId}
        activeFolderId={primaryFolderId}
        files={files}
        hasScope={hasScope}
      />
    </section>
  );
}
