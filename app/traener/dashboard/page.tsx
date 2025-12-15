// app/traener/dashboard/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

function scoreToColor(score: number) {
  if (score >= 75) return "#10b981";
  if (score >= 50) return "#facc15";
  return "#ef4444";
}

type FolderRow = { id: string; name: string };
type NoteRow = { id: string; folder_id: string | null };
type SessionRow = {
  id: string;
  score: number | null;
  created_at: string;
  meta: any | null;
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {}
  return process.env.DEV_USER_ID ?? null;
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const ONE_DAY = 86_400_000;
  return Math.max(0, Math.floor(diffMs / ONE_DAY));
}

function friendlySince(iso?: string | null): string {
  const ds = daysSince(iso);
  if (ds === null) return "";
  if (ds === 0) return "i dag";
  if (ds === 1) return "for 1 dag siden";
  return `for ${ds} dage siden`;
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, n) => a + n, 0) / nums.length;
}

function sessionsForFolder(
  folderId: string,
  all: SessionRow[],
  noteIdsByFolder: Map<string, Set<string>>
): SessionRow[] {
  const noteSet = noteIdsByFolder.get(folderId) ?? new Set<string>();
  return all.filter((s) => {
    if (typeof s.score !== "number") return false;
    const meta = s.meta ?? {};
    if (meta.folder_id && meta.folder_id === folderId) return true;
    if (Array.isArray(meta.selected_note_ids)) {
      for (const nid of meta.selected_note_ids) {
        if (noteSet.has(nid)) return true;
      }
    }
    return false;
  });
}

function summarizeFolderSessions(sessions: SessionRow[]) {
  if (!sessions.length) {
    return {
      line:
        "Ingen data endnu. Lav 2–3 hurtige øvelser for at komme i gang.",
      badgeLabel: "Kom i gang",
      badgeClass:
        "bg-neutral-100 text-neutral-600 border border-neutral-200",
      pctNow: 0,
      lastAt: null,
      attemptCount: 0,
    };
  }

  const last5 = sessions.slice(0, 5);
  const prev5 = sessions.slice(5, 10);

  const nowScores = last5
    .map((s) => (typeof s.score === "number" ? s.score : null))
    .filter((n): n is number => n !== null);

  const prevScores = prev5
    .map((s) => (typeof s.score === "number" ? s.score : null))
    .filter((n): n is number => n !== null);

  const avgNow = nowScores.length ? mean(nowScores) : null;
  const avgPrev = prevScores.length ? mean(prevScores) : null;

  const roundedNow = avgNow === null ? null : Math.round(avgNow);
  const delta =
    avgPrev === null || avgNow === null ? 0 : avgNow - avgPrev;
  const deltaAbs = Math.round(Math.abs(delta));

  const latest = sessions[0];
  const since = friendlySince(latest?.created_at);

  let statusType: "baseline" | "up" | "stable" | "down";
  if (avgPrev === null) statusType = "baseline";
  else if (Math.abs(delta) < 3) statusType = "stable";
  else if (delta > 0) statusType = "up";
  else statusType = "down";

  let line: string;
  let badgeLabel: string;
  let badgeClass: string;

  switch (statusType) {
    case "baseline":
      line = `Baseline (${roundedNow}). Tag et par øvelser mere for at løfte næste trin. Sidst ${since}.`;
      badgeLabel = "Ny";
      badgeClass =
        "bg-neutral-100 text-neutral-600 border border-neutral-200";
      break;
    case "up":
      line = `Fremskridt (+${deltaAbs}). Bliv ved – det går den rigtige vej. Sidst ${since}.`;
      badgeLabel = "På vej op";
      badgeClass =
        "bg-green-100 text-green-700 border border-green-200";
      break;
    case "stable":
      line = `Stabilt (${roundedNow}). Du holder niveau. Sidst ${since}.`;
      badgeLabel = "Stabilt";
      badgeClass =
        "bg-yellow-100 text-yellow-700 border border-yellow-200";
      break;
    case "down":
    default:
      line = `Fokuspunkt (-${deltaAbs}). Brug lidt ekstra tid her. Sidst ${since}.`;
      badgeLabel = "Brug lidt fokus";
      badgeClass =
        "bg-red-100 text-red-700 border border-red-200";
      break;
  }

  let pctNow = 0;
  if (last5.length) {
    const nowMean = mean(
      last5
        .map((s) => (typeof s.score === "number" ? s.score : null))
        .filter((n): n is number => n !== null)
    );
    pctNow = Math.max(0, Math.min(100, Math.round(nowMean ?? 0)));
  }

  return {
    line,
    badgeLabel,
    badgeClass,
    pctNow,
    lastAt: latest?.created_at ?? null,
    attemptCount: sessions.length,
  };
}

function daysBoxValue(lastAt: string | null): string {
  const d = daysSince(lastAt);
  return d === null ? "" : String(d);
}

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-3xl font-semibold mb-2">Overblik</h1>
        <p>Mangler bruger-id (hverken login eller DEV_USER_ID sat).</p>
      </main>
    );
  }

  const { data: folders, error: fErr } = await sb
    .from("folders")
    .select("id,name")
    .eq("owner_id", ownerId)
    .order("name", { ascending: true });

  if (fErr) {
    return (
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-3xl font-semibold mb-2">Overblik</h1>
        <p className="text-red-600 text-sm">
          Fejl ved hentning af mapper: {fErr.message}
        </p>
      </main>
    );
  }

  const { data: notes } = await sb
    .from("notes")
    .select("id,folder_id")
    .eq("owner_id", ownerId);

  const noteIdsByFolder = new Map<string, Set<string>>();
  for (const n of (notes ?? []) as NoteRow[]) {
    if (!n.folder_id) continue;
    if (!noteIdsByFolder.has(n.folder_id)) {
      noteIdsByFolder.set(n.folder_id, new Set());
    }
    noteIdsByFolder.get(n.folder_id)!.add(n.id);
  }

  const { data: sessionsRaw } = await sb
    .from("exam_sessions")
    .select("id,score,created_at,meta")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(200);

  const allSessions = (sessionsRaw ?? []) as SessionRow[];

  const cards =
    (folders ?? []).map((folder: FolderRow) => {
      const sess = sessionsForFolder(
        folder.id,
        allSessions,
        noteIdsByFolder
      );
      const summary = summarizeFolderSessions(sess);
      const barColor = summary.attemptCount
        ? scoreToColor(summary.pctNow)
        : "#e5e7eb";

      return {
        id: folder.id,
        name: folder.name,
        attemptCount: summary.attemptCount,
        line: summary.line,
        badgeLabel: summary.badgeLabel,
        badgeClass: summary.badgeClass,
        barPct: summary.pctNow,
        barColor,
        dageVal: daysBoxValue(summary.lastAt),
      };
    }) ?? [];

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="mb-2">
        <Link
          href="/traener"
          className="text-xs underline text-zinc-600"
        >
          &larr; Tilbage til Træner
        </Link>
      </div>
      <h1 className="text-3xl font-semibold mb-1">Overblik</h1>
      <p className="text-[13px] text-black/70 mb-6">
        Dine fag samlet ét sted – klik Træner for at vælge øvelse.
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.id}
            href={`/traener?folder_id=${encodeURIComponent(card.id)}`}
            className="block rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm min-h-[240px] hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold leading-tight">
                {card.name}
              </h2>
              <span className="text-[11px] text-black/40 whitespace-nowrap">
                {card.attemptCount === 0
                  ? "ingen data"
                  : `${card.attemptCount} forsøg`}
              </span>
            </div>

            <div className="mt-2">
              <span
                className={`inline-block text-[10px] px-2 py-[2px] rounded-full font-medium ${card.badgeClass}`}
              >
                {card.badgeLabel}
              </span>
            </div>

            <div className="text-[12px] text-black/60 leading-snug mt-2 max-w-[90%]">
              {card.line}
            </div>

            <div className="mt-4 mb-4">
              <div className="h-2 w-full rounded bg-neutral-200 overflow-hidden">
                <div
                  className="h-2 rounded"
                  style={{
                    width: `${card.barPct}%`,
                    backgroundColor: card.barColor,
                    transition: "width .25s ease",
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 text-center">
              <div className="rounded-xl border border-neutral-200 p-3">
                <div className="text-xl font-semibold tracking-tight">
                  {card.dageVal}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-black/50">
                  DAGE
                </div>
              </div>
            </div>

            <div className="mt-4 text-sm text-black/60">
              Klik for at træne →
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}



