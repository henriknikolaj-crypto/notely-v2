// app/traener/noter/page.tsx
import "server-only";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import GenerateFromSource from "./ui/GenerateFromSource";

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

type FileOption = {
  id: string;
  name: string | null;
};

/**
 * Henter filer til Noter-siden.
 *
 * Hvis folderIds er tom, viser vi INGEN filer (brugeren skal vælge fag/mappe
 * i venstre side).
 *
 * Hvis der er valgt mapper, henter vi filer fra ALLE de mapper (IN),
 * baseret på doc_chunks + files.
 */
async function listFilesForScope(
  sb: any,
  ownerId: string,
  folderIds: string[]
): Promise<FileOption[]> {
  // Ingen scope = ingen filer i dropdown
  if (!folderIds || folderIds.length === 0) {
    return [];
  }

  // 1) Find alle file_id'er, der har doc_chunks i de valgte mapper
  const dcRes = await sb
    .from("doc_chunks")
    .select("file_id")
    .eq("owner_id", ownerId)
    .in("folder_id", folderIds);

  if (dcRes.error) {
    console.error("listFilesForScope: doc_chunks error", dcRes.error);
    return [];
  }

  const fileIds = Array.from(
    new Set(
      (dcRes.data ?? [])
        .map((row: any) => row.file_id as string | null)
        .filter(Boolean)
    )
  );

  if (fileIds.length === 0) {
    return [];
  }

  // 2) Slå filnavne op i files-tabellen
  const fRes = await sb
    .from("files")
    .select("id, name, original_name")
    .in("id", fileIds)
    .order("name", { ascending: true });

  if (fRes.error) {
    console.error("listFilesForScope: files error", fRes.error);
    return [];
  }

  const rows = (fRes.data ?? []) as any[];

  return rows.map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? (row.original_name as string | null),
  }));
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

      <GenerateFromSource
        ownerId={ownerId}
        activeFolderId={primaryFolderId}
        files={files}
        hasScope={hasScope}
      />
    </section>
  );
}
