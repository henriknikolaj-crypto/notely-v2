// app/traener/page.tsx
import "server-only";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { redirect } from "next/navigation";
import ClientTrainer from "./ux/ClientTrainer";

export const dynamic = "force-dynamic";

type FolderRow = {
  id: string;
  name: string;
  parent_id?: string | null;
};

const DEMO_SCOPE_ID = "demo-samfund";
const DEMO_SCOPE_NAME = "Samfund";

async function hasOwnUsableMaterial(sb: any, ownerId: string): Promise<boolean> {
  const { data: filesData, error: filesError } = await sb
    .from("files")
    .select("id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filesError) {
    console.error("TRÆNER page files readiness error:", filesError);
    return false;
  }

  const fileIds = (filesData ?? [])
    .map((row: any) => String(row?.id ?? "").trim())
    .filter(Boolean);

  if (fileIds.length === 0) return false;

  const { data: chunkData, error: chunkError } = await sb
    .from("doc_chunks")
    .select("id,content")
    .eq("owner_id", ownerId)
    .in("file_id", fileIds)
    .not("content", "is", null)
    .limit(20);

  if (chunkError) {
    console.error("TRÆNER page doc_chunks readiness error:", chunkError);
    return false;
  }

  return (
    Array.isArray(chunkData) &&
    chunkData.some((row: any) => String(row?.content ?? "").trim().length > 0)
  );
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

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const sp = (await searchParams) ?? {};
  const isDemoMode =
    sp.demo === "1" ||
    sp.demo === "true" ||
    (Array.isArray(sp.demo) && (sp.demo[0] === "1" || sp.demo[0] === "true"));
  const rawScope = sp.scope ?? sp["scope"];
  const rawFolder = sp.folder ?? sp["folder"];

  let scopeFolderIds: string[] = [];
  let folderParam: string | null = null;

  if (typeof rawScope === "string") {
    scopeFolderIds = rawScope
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(rawScope) && rawScope.length > 0) {
    scopeFolderIds = rawScope[0]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof rawFolder === "string") {
    folderParam = rawFolder.trim() || null;
  } else if (Array.isArray(rawFolder) && rawFolder.length > 0) {
    folderParam = rawFolder[0]?.trim() || null;
  }

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return null;
  }

  const { data, error } = await sb
    .from("folders")
    .select("id,name,parent_id")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("TRÆNER page folders error:", error);
  }

  const folders = (data ?? []) as FolderRow[];
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const sanitizedScopeFolderIds = isDemoMode
    ? [DEMO_SCOPE_ID]
    : scopeFolderIds.filter((id) => validFolderIds.has(id));
  const fallbackFolderId = folders[0]?.id ?? null;
  const sanitizedFolderParam =
    isDemoMode || !folderParam || !validFolderIds.has(folderParam) ? null : folderParam;
  const shouldFallbackScope =
    !isDemoMode && scopeFolderIds.length > 0 && sanitizedScopeFolderIds.length === 0 && !!fallbackFolderId;
  const shouldPromoteLegacyFolderToScope =
    !isDemoMode && sanitizedScopeFolderIds.length === 0 && !!sanitizedFolderParam;
  const finalScopeFolderIds = shouldFallbackScope
    ? [fallbackFolderId as string]
    : shouldPromoteLegacyFolderToScope
      ? [sanitizedFolderParam as string]
      : sanitizedScopeFolderIds;
  const activeFolderId = isDemoMode ? DEMO_SCOPE_ID : finalScopeFolderIds[0] ?? null;
  const scopeChanged =
    !isDemoMode &&
    (finalScopeFolderIds.length !== scopeFolderIds.length ||
      finalScopeFolderIds.some((id, index) => id !== scopeFolderIds[index]));
  const folderChanged = !isDemoMode && !!folderParam;

  if (!isDemoMode && (scopeChanged || folderChanged)) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (key === "scope" || key === "folder") continue;
      if (typeof value === "string" && value.trim()) params.set(key, value);
      else if (Array.isArray(value) && value[0]?.trim()) params.set(key, value[0]);
    }
    if (finalScopeFolderIds.length > 0) params.set("scope", finalScopeFolderIds.join(","));
    const qs = params.toString();
    redirect(qs ? `/traener?${qs}` : "/traener");
  }

  const effectiveFolders = isDemoMode ? [{ id: DEMO_SCOPE_ID, name: DEMO_SCOPE_NAME }, ...folders] : folders;
  const effectiveScopeFolderIds = finalScopeFolderIds;
  const showFirstUseCta = !isDemoMode && !(await hasOwnUsableMaterial(sb, ownerId));

  return (
    <main>
      <header>
        <h1 className="text-lg font-semibold text-zinc-900">Træner</h1>
        <p className="mt-1 text-sm text-zinc-600 max-w-2xl">
          Træn eksamenslignende spørgsmål og få feedback på dine svar – baseret på dit eget pensum og faglige kilder.
        </p>
        <div className="mt-3 h-px w-full bg-zinc-200" />
      </header>

      {/* Lille margin – så boksen kommer tæt op på stregen som på Noter */}
      <section className="mt-2">
        <ClientTrainer
          ownerId={ownerId}
          folders={effectiveFolders}
          activeFolderId={activeFolderId}
          scopeFolderIds={effectiveScopeFolderIds}
          showFirstUseCta={showFirstUseCta}
          demoMode={isDemoMode}
          demoScopeName={isDemoMode ? DEMO_SCOPE_NAME : null}
        />
      </section>
    </main>
  );
}
