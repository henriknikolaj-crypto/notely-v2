// app/traener/upload/page.tsx
import "server-only";

import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ImportStatusBox from "./ImportStatusBox";
import UploadPageClient from "./UploadPageClient";
import AuthStateNotice from "@/components/ui/AuthStateNotice";

export const dynamic = "force-dynamic";

type FolderRow = {
  id: string;
  name: string;
  parent_id?: string | null;
  archived_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

async function getOwnerCtxRsc(sb: any): Promise<
  | { ownerId: string; mode: "auth"; email: string | null }
  | { ownerId: string; mode: "dev"; email: null }
  | null
> {
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) return { ownerId: data.user.id as string, mode: "auth", email: data.user.email ?? null };
  } catch {
    // ignore
  }

  const dev = (process.env.DEV_USER_ID ?? "").trim();
  if (dev) return { ownerId: dev, mode: "dev", email: null };

  return null;
}

export default async function UploadPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sb = await supabaseServerRSC();
  const owner = await getOwnerCtxRsc(sb);

  if (!owner?.ownerId) {
    return (
      <main className="min-h-screen bg-[#fffef9] p-6 text-sm text-zinc-800">
        <p>Du er ikke logget ind.</p>
        <Link href="/auth/login" className="mt-2 inline-block rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50">
          Gå til login
        </Link>
      </main>
    );
  }

  const ownerId = owner.ownerId;

  if (owner.mode === "dev") {
    return (
      <section className="space-y-6">
        <header className="border-b border-zinc-200 pb-3">
          <h1 className="text-lg font-semibold text-zinc-900">Upload / ret materiale</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Mobil-LAN kraever en rigtig login-session for stabile uploads, mapper og status-kald.
          </p>
        </header>

        <AuthStateNotice message="Denne browser koerer kun paa serverens DEV_USER_ID fallback. Derfor vil klientkald til mapper, upload-status og filer ende i unauthorized. Log ind i samme browser for at bruge upload sikkert." />
      </section>
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
    <section className="space-y-8">
      <section className="space-y-4">
        <header className="border-b border-zinc-200 pb-3">
          <h1 className="text-lg font-semibold text-zinc-900">Upload / ret materiale</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Upload dine pensumfiler. Når materialet er gjort klar, kan du bruge det på tværs af Notely.
          </p>
        </header>

        <ImportStatusBox folderId={null} />
      </section>

      <UploadPageClient ownerId={ownerId} initialFolderId={initialFolderId} initialFolders={folders} />
    </section>
  );
}
