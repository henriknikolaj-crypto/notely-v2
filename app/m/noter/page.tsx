import "server-only";
import { redirect } from "next/navigation";
import MobileBackToMenu from "@/components/mobile/MobileBackToMenu";
import MobileHubHeader from "@/components/mobile/MobileHubHeader";
import MobileNotesFlow from "@/components/mobile/MobileNotesFlow";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

type FolderOption = {
  id: string;
  name: string;
};

type FileOption = {
  id: string;
  name: string | null;
};

async function getOwnerCtx(sb: any): Promise<{ ownerId: string | null; userEmail: string | null }> {
  try {
    const { data } = await sb.auth.getUser();
    return {
      ownerId: data?.user?.id ?? null,
      userEmail: data?.user?.email ?? null,
    };
  } catch {
    return {
      ownerId: null,
      userEmail: null,
    };
  }
}

async function listFolders(sb: any, ownerId: string): Promise<FolderOption[]> {
  const { data, error } = await sb
    .from("folders")
    .select("id,name")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("Mobile notes folders error", error);
    return [];
  }

  return ((data ?? []) as any[])
    .map((row) => ({
      id: String(row?.id ?? "").trim(),
      name: String(row?.name ?? "").trim(),
    }))
    .filter((row) => row.id && row.name);
}

async function listFilesForFolder(sb: any, ownerId: string, folderId: string | null): Promise<FileOption[]> {
  if (!folderId) return [];

  const { data, error } = await sb
    .from("files")
    .select("id, name, original_name, folder_id, doc_chunks!inner(id)")
    .eq("owner_id", ownerId)
    .eq("folder_id", folderId)
    .order("name", { ascending: true });

  if (error) {
    console.error("Mobile notes files error", error);
    return [];
  }

  return ((data ?? []) as any[]).map((row) => ({
    id: String(row?.id ?? ""),
    name: (row?.name as string | null) ?? (row?.original_name as string | null),
  }));
}

export default async function MobileNotesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sb = await supabaseServerRSC();
  const { ownerId, userEmail } = await getOwnerCtx(sb);

  if (!ownerId) {
    return <section className="p-6 text-sm text-red-600">Du skal være logget ind for at åbne Noter.</section>;
  }

  const sp = (await searchParams) ?? {};
  const scopeRaw = sp.scope;
  const scopeFolderIds = typeof scopeRaw === "string"
    ? scopeRaw.split(",").map((part) => part.trim()).filter(Boolean)
    : Array.isArray(scopeRaw)
      ? scopeRaw.join(",").split(",").map((part) => part.trim()).filter(Boolean)
      : [];
  const selectedFolderId = scopeFolderIds[0] ?? null;

  if (scopeFolderIds.length > 1) {
    redirect(selectedFolderId ? `/m/noter?scope=${encodeURIComponent(selectedFolderId)}` : "/m/noter");
  }

  const folders = await listFolders(sb, ownerId);
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const resolvedFolderId = selectedFolderId && validFolderIds.has(selectedFolderId) ? selectedFolderId : null;

  if (selectedFolderId && !resolvedFolderId) {
    redirect("/m/noter");
  }

  const files = await listFilesForFolder(sb, ownerId, resolvedFolderId);

  return (
    <main className="min-h-screen bg-[#fffef9] px-4 py-6 md:px-6 md:py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <MobileHubHeader userEmail={userEmail} />
        <MobileBackToMenu href="/m/traening" label="← Tilbage til træning" />

        <section className="space-y-4">
          <header className="border-b border-zinc-200 pb-3">
            <h1 className="text-xl font-semibold text-zinc-900">Noter</h1>
            <p className="mt-1 text-sm text-zinc-600">Vælg én mappe og én fil for at generere noter på mobil.</p>
          </header>

          <MobileNotesFlow folders={folders} selectedFolderId={resolvedFolderId} files={files} />
        </section>
      </div>
    </main>
  );
}
