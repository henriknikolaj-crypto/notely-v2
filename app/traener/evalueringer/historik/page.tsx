// app/traener/evalueringer/historik/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

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

export default async function TrainerEvaluationsHistoryPage({
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
  const backHref = qs ? `/traener?${qs}` : "/traener";

  if (!ownerId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Mangler bruger-id.</p>
      </main>
    );
  }

  const LIMIT = 50;

  const { data, error, count } = await sb
    .from("exam_sessions")
    .select("id, score, created_at", { count: "exact" })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error("trainer/evalueringer/historik:", error);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">
          Kunne ikke hente Træner-evalueringer.
        </p>
        <div className="mt-4">
          <Link
            href={backHref}
            className="text-xs text-zinc-600 hover:underline"
          >
            ← Tilbage til Træner
          </Link>
        </div>
      </main>
    );
  }

  const evals =
    (data as { id: string; score: number | null; created_at: string | null }[]) ??
    [];
  const total = count ?? evals.length;
  const shown = evals.length;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      {/* RETUR-LINK ØVERST – bevarer scope= i URL'en */}
      <div>
        <Link
          href={backHref}
          className="text-xs text-zinc-600 hover:underline"
        >
          ← Tilbage til Træner
        </Link>
      </div>

      <header>
        <h1 className="text-lg font-semibold text-zinc-900">
          Træner-evalueringer (seneste {shown} af {total})
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Evalueringer fra Træner-øvelser. Klik for at se detaljer.
        </p>
      </header>

      {!evals.length ? (
        <p className="text-sm text-slate-600">
          Ingen evalueringer endnu. Lav et par øvelser under Træner.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
          {evals.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between px-4 py-2 text-sm"
            >
              <div>
                <div className="font-medium text-zinc-900">
                  Score: {e.score ?? 0}/100
                </div>
                <div className="text-[11px] text-zinc-500">
                  {fmt(e.created_at)}
                </div>
              </div>
              <Link
                href={
                  qs
                    ? `/traener/evalueringer/${e.id}?${qs}`
                    : `/traener/evalueringer/${e.id}`
                }
                className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
              >
                Åbn
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2">
        <Link
          href={backHref}
          className="text-xs text-zinc-600 hover:underline"
        >
          ← Tilbage til Træner
        </Link>
      </div>
    </main>
  );
}
