// app/traener/page.tsx
import "server-only";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientTrainer from "./ux/ClientTrainer";

export const dynamic = "force-dynamic";

type FolderRow = {
  id: string;
  name: string;
  parent_id?: string | null;
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // lokal dev → fallback
  }
  return process.env.DEV_USER_ID ?? null;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const sp = (await searchParams) ?? {};
  const rawScope = sp.scope ?? sp["scope"];

  let scopeFolderIds: string[] = [];

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

  const activeFolderId = scopeFolderIds[0] ?? null;

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
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

  return (
    <main>
      <header>
        <h1 className="text-lg font-semibold text-zinc-900">Træner</h1>
        <p className="mt-1 text-sm text-zinc-600 max-w-2xl">
          Træn eksamenslignende spørgsmål og få feedback på dine svar – på sigt
          baseret på dit eget pensum og faglige kilder.
        </p>
        <div className="mt-3 h-px w-full bg-zinc-200" />
      </header>

      {/* Lille margin – så boksen kommer tæt op på stregen som på Noter */}
      <section className="mt-2">
        <ClientTrainer
          ownerId={ownerId}
          folders={folders}
          activeFolderId={activeFolderId}
          scopeFolderIds={scopeFolderIds}
        />
      </section>
    </main>
  );
}
