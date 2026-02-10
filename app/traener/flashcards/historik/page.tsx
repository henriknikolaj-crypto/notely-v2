import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

const LIMIT = 50;

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) return data.user.id as string;
  } catch {}
  return process.env.DEV_USER_ID ?? null;
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
  const qs = qp.toString();
  const backHref = qs ? `/traener/flashcards?${qs}` : "/traener/flashcards";

  if (!ownerId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Mangler bruger-id.</p>
      </main>
    );
  }

  const { data, error, count } = await sb
    .from("flashcard_sessions")
    .select("id, created_at, difficulty, requested, returned", { count: "exact" })
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

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
      difficulty: string | null;
      requested: number | null;
      returned: number | null;
    }[]) ?? [];

  const totalRaw = count ?? sessions.length;
  const total = Math.min(totalRaw, LIMIT);
  const shown = sessions.length;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <div>
        <Link href={backHref} className="text-xs text-zinc-600 hover:underline">
          ← Tilbage til Flashcards
        </Link>
      </div>

      <header>
        <h1 className="text-lg font-semibold text-zinc-900">
          Flashcards-historik (seneste {shown} af {total})
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Oversigt over dine flashcard-sessions. Der gemmes maksimalt {LIMIT} sessions.
        </p>
      </header>

      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-600">
          Ingen sessions endnu. Generér en runde i Flashcards for at komme i gang.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between px-4 py-2 text-sm"
            >
              <div>
                <div className="font-medium text-zinc-900">
                  {fmt(s.created_at)} · {(s.difficulty ?? "medium").toLowerCase()}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {Number(s.returned ?? 0)}/{Number(s.requested ?? 0)} kort
                </div>
              </div>

              <button
                type="button"
                disabled
                className="cursor-default rounded-lg border border-zinc-200 px-3 py-1 text-xs text-zinc-400"
              >
                Detaljer (kommer senere)
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2">
        <Link href={backHref} className="text-xs text-zinc-600 hover:underline">
          ← Tilbage til Flashcards
        </Link>
      </div>
    </main>
  );
}
