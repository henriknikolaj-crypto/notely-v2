// app/traener/simulator/page.tsx
import "server-only";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // DEV fallback
  }
  return process.env.DEV_USER_ID ?? null;
}

export default async function SimulatorPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};

  // Aktiv mappe via klik på mappe-navn
  const folderParam = sp.folder;
  const activeFolderId =
    typeof folderParam === "string" ? folderParam : null;

  // Scope: comma-separeret liste af folder-id’er fra tjekboksene
  const scopeParam = sp.scope;
  const scopeRaw = typeof scopeParam === "string" ? scopeParam : "";
  const scopeIds = scopeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

  const scopeLabel = (() => {
    if (scopeIds.length > 1)
      return `Simulatoren vil bruge ${scopeIds.length} valgte mapper som grundlag.`;
    if (scopeIds.length === 1)
      return "Simulatoren vil bruge 1 valgt mappe som grundlag.";
    if (activeFolderId)
      return "Simulatoren vil tage udgangspunkt i den mappe du har valgt i venstre side.";
    return "Vælg mapper i venstre side for at bestemme hvad eksamens-simulatoren skal dække.";
  })();

  return (
    <main className="max-w-3xl px-4 py-6 md:px-0 space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Simulator</h1>
        <p className="text-sm text-zinc-600">
          Tidsbegrænsede eksamensforløb med flere spørgsmål i træk – samme
          følelse som en rigtig prøve.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Træningsområde</h2>
        <p className="text-xs text-zinc-600">{scopeLabel}</p>
        <p className="mt-1 text-[11px] text-zinc-500">
          Vi bruger de mapper du vælger i venstre side – ligesom i Træner,
          Multiple Choice og Flashcards.
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold">Simulatoren er på vej</h3>
        <p className="text-sm text-zinc-600">
          Selve eksamens-simulatoren er endnu ikke aktiveret i denne version.
          Planen er, at du kan køre rigtige eksamenssæt med flere spørgsmål i
          træk, tidsbegrænsning og samlet evaluering efter aflevering.
        </p>
        <p className="mt-2 text-sm text-zinc-600">
          Når funktionen er klar, vil den automatisk bruge de mapper og noter
          du allerede har valgt som dit træningsområde.
        </p>
      </section>
    </main>
  );
}
