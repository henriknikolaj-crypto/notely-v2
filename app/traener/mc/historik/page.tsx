// app/traener/mc/historik/page.tsx
import "server-only";
import Link from "next/link";
import { getHistoryWindowForPlan } from "@/lib/plan/history";
import { getUserPlan } from "@/lib/plan/limits";
import { getTrainerSession } from "@/lib/auth/trainer-session";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

const LIMIT = 50;

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

export default async function MCHistoryPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sb = await supabaseServerRSC();
  const { ownerId } = await getTrainerSession();

  const sp = (await searchParams) ?? {};
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value);
  }
  const qs = params.toString();
  const backHref = qs ? `/traener/mc?${qs}` : "/traener/mc";

  if (!ownerId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Du skal være logget ind for at se MC-historik.</p>
      </main>
    );
  }

  const { data, error } = await sb
    .from("exam_sessions")
    .select("id, score, created_at, source_type, folder_id", { count: "exact" })
    .eq("owner_id", ownerId)
    .eq("source_type", "mc")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error("mc/historik:", error);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Kunne ikke hente MC-historik.</p>
        <div className="mt-4">
          <Link
            href={backHref}
            className="text-xs text-zinc-600 hover:underline"
          >
            ← Tilbage til Multiple Choice
          </Link>
        </div>
      </main>
    );
  }

  const plan = await getUserPlan(sb, ownerId);
  const historyWindow = getHistoryWindowForPlan(plan);

  const sessions =
    (data as { id: string; score: number | null; created_at: string | null; folder_id: string | null }[]) ??
    [];

  const visibleSessions = sessions.slice(0, historyWindow.mcVisibleItems);
  const folderIds = Array.from(
    new Set(
      visibleSessions
        .map((session) => session.folder_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  );

  let folderNameById = new Map<string, string>();
  if (folderIds.length > 0) {
    const { data: folders } = await sb
      .from("folders")
      .select("id, name")
      .in("id", folderIds);
    folderNameById = new Map(
      ((folders ?? []) as Array<{ id: string; name: string | null }>)
        .map((folder) => [folder.id, String(folder.name ?? "").trim()] as const)
        .filter((entry) => entry[0] && entry[1]),
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      {/* RETUR-LINK ØVERST */}
      <div>
        <Link
          href={backHref}
          className="text-xs text-zinc-600 hover:underline"
        >
          ← Tilbage til Multiple Choice
        </Link>
      </div>

      <header>
        <h1 className="text-lg font-semibold text-zinc-900">MC-historik (seneste 20)</h1>
      </header>

      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-600">
          Du har endnu ingen gemte MC-forsøg.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
          {visibleSessions.map((s) => (
            <li
              key={s.id}
              className="px-4 py-2 text-sm"
            >
              <div>
                <div className="font-medium text-zinc-900">
                  Score: {s.score ?? 0}/100
                </div>
                <div className="text-[11px] text-zinc-500">{fmt(s.created_at)}</div>
                {s.folder_id && folderNameById.get(s.folder_id) ? (
                  <div className="text-[11px] text-zinc-500">{folderNameById.get(s.folder_id)}</div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2">
        <Link
          href={backHref}
          className="text-xs text-zinc-600 hover:underline"
        >
          ← Tilbage til Multiple Choice
        </Link>
      </div>
    </main>
  );
}
