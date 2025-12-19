// app/traener/mc/page.tsx
import "server-only";

import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientMC from "./ClientMC";

export const dynamic = "force-dynamic";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // falder igennem til DEV
  }
  return process.env.DEV_USER_ID ?? null;
}

export default async function MCPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const sp = (await searchParams) ?? {};

  const scopeParam = sp.scope;
  const scopeRaw =
    typeof scopeParam === "string"
      ? scopeParam
      : Array.isArray(scopeParam)
      ? scopeParam[0]
      : "";
  const scopeFolderIds = scopeRaw
    ? scopeRaw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="p-4 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

  const { data: folders } = await sb
    .from("folders")
    .select("id, name, parent_id")
    .eq("owner_id", ownerId)
    .order("name", { ascending: true });

  const folderRows: FolderRow[] = folders ?? [];

  let scopeLabel = "Alle mapper";
  if (scopeFolderIds.length === 1) {
    const f = folderRows.find((x) => x.id === scopeFolderIds[0]);
    scopeLabel = f?.name ?? "Valgt mappe";
  } else if (scopeFolderIds.length > 1) {
    scopeLabel = `${scopeFolderIds.length} mapper`;
  }

  return (
    <main>
      <header>
        <h1 className="text-lg font-semibold text-zinc-900">
          Multiple Choice
        </h1>
        <p className="mt-1 text-sm text-zinc-600 max-w-2xl">
          Træn multiple choice-spørgsmål ét ad gangen og få overblik over, hvor
          sikkert du kan dit pensum.
        </p>
        <div className="mt-3 h-px w-full bg-zinc-200" />
      </header>

      {/* Lidt luft under stregen – men mindre end mt-1 */}
      <section className="mt-2 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Du træner lige nu på
        </p>
        <p className="mt-1 text-sm font-medium text-zinc-900">
          Du træner lige nu på: {scopeLabel}
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          Spørgsmålene her bygger på den valgte mappe. Tilpas udvalget i venstre
          side, hvis du vil inkludere flere mapper.
        </p>
      </section>

      <section className="mt-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-zinc-900">
            Multiple Choice-træning
          </h2>
          <p className="mt-1 text-xs text-zinc-600">
            Svar på spørgsmål ét ad gangen. Når du tjekker svaret, bliver
            forsøget gemt, så du kan følge din udvikling.
          </p>
        </div>

        <ClientMC scopeFolderIds={scopeFolderIds} />
      </section>
    </main>
  );
}
