// app/traener/upload/page.tsx
import "server-only";

import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import UploadClient from "./UploadClient";
import FolderManagerClient from "./FolderManagerClient";
import ImportStatusBox from "./ImportStatusBox";

export const dynamic = "force-dynamic";

type FolderRow = {
  id: string;
  name: string;
  parent_id?: string | null;
  archived_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

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

export default async function UploadPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="min-h-screen bg-[#fffef9] p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

  const { data: foldersData, error: foldersError } = await sb
    .from("folders")
    .select("id,name,parent_id,start_date,end_date,archived_at")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (foldersError) console.error("UPLOAD layout folders error:", foldersError);

  const folders = (foldersData ?? []) as FolderRow[];

  const sp = (await searchParams) ?? {};
  const folderParam = sp.folder;
  const scopeParam = sp.scope;

  let initialFolderId: string | null = null;

  if (typeof folderParam === "string" && folderParam.trim().length > 0) {
    initialFolderId = folderParam.trim();
  } else {
    let scopeIds: string[] = [];

    if (typeof scopeParam === "string" && scopeParam.trim().length > 0) {
      scopeIds = scopeParam.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(scopeParam)) {
      scopeIds = scopeParam
        .join(",")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (scopeIds.length > 0) initialFolderId = scopeIds[0];
  }

  if (!initialFolderId && folders.length > 0) initialFolderId = folders[0].id;

  return (
    <main className="min-h-screen bg-[#fffef9]">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 md:px-6">
        <section className="space-y-4">
          <header className="border-b border-zinc-200 pb-3">
            <h1 className="text-lg font-semibold text-zinc-900">
              Upload / ret materiale
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Upload dine pensumfiler. Når materialet er gjort klar, kan du bruge
              det på tværs af Notely.
            </p>
          </header>

          {/* Status (kvote + filer + seneste) */}
          <ImportStatusBox folderId={null} />
        </section>

        <section>
          <UploadClient
            folders={folders.map((f) => ({ id: f.id, name: f.name }))}
            initialFolderId={initialFolderId}
            ownerId={ownerId}
          />
        </section>

        <section>
          <FolderManagerClient ownerId={ownerId} initialFolders={folders} />
        </section>
      </div>
    </main>
  );
}
