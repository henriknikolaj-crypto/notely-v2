import "server-only";
import Link from "next/link";
import { getHistoryWindowForPlan } from "@/lib/plan/history";
import { getCanonicalUserPlan } from "@/lib/plan/limits";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LIMIT = 50;

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) return data.user.id as string;
  } catch {}
  return null;
}

function fmt(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d
    .toLocaleString("da-DK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\.$/, "");
}

type SearchParams =
  | Record<string, string | string[] | undefined>
  | undefined;

type SnapshotCard = {
  id?: string | null;
  front?: string | null;
  back?: string | null;
};

export default async function FlashcardsHistoryPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  const sp = (await searchParams) ?? {};
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qp.set(k, v);
  }
  const selectedSessionId = typeof sp.session === "string" ? sp.session : null;

  const qs = qp.toString();
  const backHref = qs ? `/traener/flashcards?${qs}` : "/traener/flashcards";

  if (!ownerId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Du skal være logget ind for at se Flashcards-historik.</p>
      </main>
    );
  }

  const planInfo = await getCanonicalUserPlan(sb, ownerId);
  const historyWindow = getHistoryWindowForPlan(planInfo.normalizedPlan);
  const pageLimit = Math.min(LIMIT, historyWindow.flashcardsHistoryItems);

  if (process.env.NODE_ENV !== "production") {
    console.log("[flashcards/history]", {
      ownerId,
      rawResolvedPlan: planInfo.rawPlan,
      normalizedPlan: planInfo.normalizedPlan,
      planSource: planInfo.source,
      resolvedHistoryLimit: historyWindow.flashcardsHistoryItems,
    });
  }

  const { data, error } = await sb
    .from("flashcard_sessions")
    .select("id, created_at, scope_folder_ids, cards_snapshot", { count: "exact" })
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(pageLimit);

  if (error) {
    console.error("flashcards/historik:", error);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Kunne ikke hente flashcards-historik.</p>
        <div className="mt-4">
          <Link href={backHref} className="text-xs text-zinc-600 hover:underline">
            ← Tilbage til Flashcards
          </Link>
        </div>
      </main>
    );
  }

  const sessions =
    (data as {
      id: string;
      created_at: string | null;
      scope_folder_ids: string[] | null;
      cards_snapshot?: SnapshotCard[] | null;
    }[]) ?? [];

  const allFolderIds = Array.from(
    new Set(
      sessions.flatMap((session) =>
        Array.isArray(session.scope_folder_ids)
          ? session.scope_folder_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          : [],
      ),
    ),
  );

  let folderNameById = new Map<string, string>();
  if (allFolderIds.length > 0) {
    const { data: folders } = await sb
      .from("folders")
      .select("id, name")
      .in("id", allFolderIds);
    folderNameById = new Map(
      ((folders ?? []) as Array<{ id: string; name: string | null }>)
        .map((folder) => [folder.id, String(folder.name ?? "").trim()] as const)
        .filter((entry) => entry[0] && entry[1]),
    );
  }

  const visibleSessions = sessions.slice(0, historyWindow.flashcardsHistoryItems);
  function scopeLabel(scopeFolderIds: string[] | null | undefined): string | null {
    const names = (scopeFolderIds ?? [])
      .map((id) => folderNameById.get(id) ?? "")
      .filter(Boolean);
    if (names.length === 0) return null;
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} og ${names[1]}`;
    return `${names[0]} + ${names.length - 1} mapper`;
  }

  function cardsForSession(cardsSnapshot: SnapshotCard[] | null | undefined) {
    return Array.isArray(cardsSnapshot)
      ? cardsSnapshot.filter(
          (card): card is Required<Pick<SnapshotCard, "front" | "back">> & SnapshotCard =>
            !!String(card?.front ?? "").trim() && !!String(card?.back ?? "").trim(),
        )
      : [];
  }

  function hrefForSession(sessionId: string | null) {
    const next = new URLSearchParams(qp.toString());
    if (sessionId) next.set("session", sessionId);
    else next.delete("session");
    const nextQs = next.toString();
    return nextQs ? `/traener/flashcards/historik?${nextQs}` : "/traener/flashcards/historik";
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <div>
        <Link href={backHref} className="text-xs text-zinc-600 hover:underline">
          ← Tilbage til Flashcards
        </Link>
      </div>

      <header>
        <h1 className="text-lg font-semibold text-zinc-900">
          Flashcards-historik (seneste {historyWindow.flashcardsHistoryItems})
        </h1>
      </header>

      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-600">
          Ingen sessions endnu. Generér en runde i Flashcards for at komme i gang.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
          {visibleSessions.map((s) => (
            <li key={s.id} className="px-4 py-2 text-sm">
              {(() => {
                const isOpen = selectedSessionId === s.id;
                const savedCards = cardsForSession(s.cards_snapshot);
                return (
                  <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-zinc-900">{fmt(s.created_at)}</div>
                  {scopeLabel(s.scope_folder_ids) ? (
                    <div className="text-[11px] text-zinc-500">{scopeLabel(s.scope_folder_ids)}</div>
                  ) : null}
                </div>
                {Array.isArray(s.cards_snapshot) && s.cards_snapshot.length > 0 ? (
                  <Link
                    href={isOpen ? hrefForSession(null) : hrefForSession(s.id)}
                    className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-700"
                  >
                    {isOpen ? "Skjul kort" : "Gense kort"}
                  </Link>
                ) : null}
              </div>
              {isOpen ? (
                <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3">
                  {savedCards.length === 0 ? (
                    <p className="text-sm text-zinc-600">Denne session har ikke gemt kort-snapshot.</p>
                  ) : (
                    <ul className="space-y-3">
                      {savedCards.map((card, index) => (
                        <li key={String(card.id ?? index)} className="rounded-xl border border-zinc-200 p-3">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                            Kort {index + 1}
                          </div>
                          <div className="mt-1 text-sm font-medium text-zinc-900">
                            {String(card.front ?? "").trim()}
                          </div>
                          <div className="mt-2 whitespace-pre-line text-sm text-zinc-700">
                            {String(card.back ?? "").trim()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
                  </>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
