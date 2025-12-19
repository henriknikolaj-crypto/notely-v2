// app/traener/flashcards/page.tsx
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
    // dev fallback
  }
  return process.env.DEV_USER_ID ?? null;
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FlashcardsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

  // Aktiv mappe (via klik på mappe-navn)
  const folderParam = sp.folder;
  const activeFolderId = typeof folderParam === "string" ? folderParam : null;

  // Scope: comma-separeret liste af folder-id'er fra venstre tjekbokse
  const scopeParam = sp.scope;
  const scopeRaw = typeof scopeParam === "string" ? scopeParam : "";
  const scopeIds = scopeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const scopeLabel = (() => {
    if (scopeIds.length > 0) {
      if (scopeIds.length === 1) return "Du træner flashcards på 1 valgt mappe.";
      return `Du træner flashcards på ${scopeIds.length} valgte mapper.`;
    }
    if (activeFolderId) {
      return "Flashcards bliver senere koblet direkte til den valgte mappe.";
    }
    return "Vælg en eller flere mapper i venstre side for at definere, hvad dine flashcards skal dække.";
  })();

  return (
    <main className="max-w-3xl px-4 py-6 md:px-0 space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Flashcards</h1>
        <p className="text-sm text-zinc-600">
          Her kommer dine kort til hurtig repetition af begreber, formler og
          nøglepointer – altid baseret på dit eget materiale.
        </p>
      </header>

      {/* Scope-summary – samme koncept som på Træner/MC */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Træningsområde</h2>
        <p className="text-xs text-zinc-600">{scopeLabel}</p>
        <p className="mt-1 text-[11px] text-zinc-500">
          Vi bruger de samme mapper og materialer, som du vælger i venstre side.
        </p>
      </section>

      {/* Placeholder-indhold – selve flashcards-funktionen kommer senere */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold">Flashcards er på vej</h3>
        <p className="text-sm text-zinc-600">
          Selve flashcard-funktionen er endnu ikke aktiveret i denne version.
          Planen er, at Notely automatisk kan foreslå kort ud fra dine mapper og
          noter – så du kan øve begreber, definitioner og små forklaringer
          lynhurtigt.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Du kan allerede nu forberede dig ved at uploade materiale og vælge
          mapper til træning. Når flashcards er klar, vil de automatisk bruge det
          samme træningsområde.
        </p>
      </section>
    </main>
  );
}
