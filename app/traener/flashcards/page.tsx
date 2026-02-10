import "server-only";

import FlashcardsClient from "./FlashcardsClient";

export const dynamic = "force-dynamic";

type SearchParams =
  | Record<string, string | string[] | undefined>
  | undefined;

function parseScopeIds(scopeRaw: unknown): string[] {
  const s = typeof scopeRaw === "string" ? scopeRaw : "";
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const scopeFolderIds = parseScopeIds(sp.scope);

  const label =
    scopeFolderIds.length === 0
      ? "Alle mapper"
      : scopeFolderIds.length === 1
        ? "1 valgt mappe"
        : `${scopeFolderIds.length} valgte mapper`;

  return (
    <section className="space-y-4">
      <header className="mb-2 border-b border-zinc-200 pb-3">
        <h1 className="text-lg font-semibold">Flashcards</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Træn på dit eget pensum. Generér kort til hurtig repetition af begreber,
          formler og nøglepointer.
        </p>
      </header>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-[11px] font-semibold tracking-wide text-zinc-500">
          DU TRÆNER PÅ
        </div>
        <div className="mt-1 text-sm font-semibold text-zinc-900">{label}</div>
        <div className="mt-1 text-xs text-zinc-600">
          Du kan ændre mapper i venstre side, før du genererer en runde.
        </div>

        <div className="mt-4">
          <FlashcardsClient scopeFolderIds={scopeFolderIds} />
        </div>
      </div>
    </section>
  );
}
