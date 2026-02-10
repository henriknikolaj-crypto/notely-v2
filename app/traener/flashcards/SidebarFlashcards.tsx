"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type SessionRow = {
  id: string;
  difficulty: string;
  requested: number;
  returned: number;
  created_at: string;
};

type SessionsResp = {
  ok: boolean;
  sessions?: SessionRow[];
  error?: string;
};

type ProgressResp = {
  ok: boolean;
  doneToday?: number;
  dailyGoal?: number;
  error?: string;
};

function fmtDMY(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("da-DK", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function localMidnightISO() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.toISOString();
}

async function readJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 140);
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
}

// scope kan være "id1,id2" eller enkelt id
function buildQs(scope: string | null, base: Record<string, string> = {}) {
  const qs = new URLSearchParams(base);
  const raw = (scope ?? "").trim();
  if (raw) {
    const ids = raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const id of ids) qs.append("scopeFolderIds[]", id);
  }
  return qs.toString();
}

async function fetchSessions(scope: string | null) {
  const r = await fetch(
    `/api/flashcards/sessions?${buildQs(scope, { limit: "5" })}`,
    { cache: "no-store" }
  );
  const j = (await readJsonSafe(r)) as SessionsResp;
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return { sessions: j.sessions ?? [] };
}

async function fetchProgress(scope: string | null, since: string) {
  const r = await fetch(
    `/api/flashcards/progress?${buildQs(scope, { since })}`,
    { cache: "no-store" }
  );
  const j = (await readJsonSafe(r)) as ProgressResp;
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return { doneToday: j.doneToday ?? 0, dailyGoal: j.dailyGoal ?? 20 };
}

async function deleteSession(id: string) {
  const r = await fetch(`/api/flashcards/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const j = await readJsonSafe(r);
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return true;
}

export default function SidebarFlashcards() {
  const sp = useSearchParams();
  const scope = sp.get("scope");
  const since = React.useMemo(() => localMidnightISO(), []);

  const [done, setDone] = React.useState(0);
  const [goal, setGoal] = React.useState(20);
  const [sessions, setSessions] = React.useState<SessionRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const lastSessionAt = sessions[0]?.created_at ?? null;

  const historyHref = React.useMemo(() => {
    const qs = sp?.toString() ?? "";
    return qs ? `/traener/flashcards/historik?${qs}` : "/traener/flashcards/historik";
  }, [sp]);

  const refresh = React.useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        fetchSessions(scope),
        fetchProgress(scope, since),
      ]);
      setSessions(s.sessions);
      setDone(p.doneToday);
      setGoal(p.dailyGoal);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [scope, since]);

  async function onDelete(id: string) {
    setErr(null);
    setLoading(true);
    try {
      await deleteSession(id);
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    function onChanged() {
      void refresh();
    }
    window.addEventListener("notely-quota-changed", onChanged);
    window.addEventListener("flashcards:changed", onChanged); // legacy
    return () => {
      window.removeEventListener("notely-quota-changed", onChanged);
      window.removeEventListener("flashcards:changed", onChanged);
    };
  }, [refresh]);

  return (
    <div className="mt-4 space-y-4 px-2 text-[12px]">
      <div>
        <div className="mb-1 font-semibold text-zinc-800">Flashcards i dag</div>

        <div className="space-y-1 text-zinc-700">
          <div>
            Dagens flashcards:{" "}
            <span className="font-semibold">{Math.min(done, goal)}</span>/{goal}
          </div>
          <div>
            Seneste session:{" "}
            <span className="font-semibold">{fmtDMY(lastSessionAt)}</span>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            className="text-[11px] text-zinc-500 underline hover:text-zinc-700 disabled:opacity-50"
            onClick={refresh}
            disabled={loading}
            type="button"
          >
            Opdatér
          </button>
          {loading ? <span className="text-[11px] text-zinc-400">Henter…</span> : null}
        </div>

        {err ? <div className="mt-2 text-[11px] text-red-600">{err}</div> : null}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="font-semibold text-zinc-800">Seneste sessions</div>
          <Link
            href={historyHref}
            className="text-[11px] text-zinc-500 hover:text-zinc-700"
          >
            Se alle
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className="text-[11px] text-zinc-400">Ingen sessions endnu.</div>
        ) : (
          <ul className="space-y-2">
            {sessions.slice(0, 5).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 p-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-800">
                    {fmtDMY(s.created_at)} · {s.difficulty}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {s.returned}/{s.requested} kort
                  </div>
                </div>

                <button
                  className="shrink-0 text-[11px] text-red-600 underline hover:text-red-700 disabled:opacity-50"
                  onClick={() => onDelete(s.id)}
                  disabled={loading}
                  type="button"
                >
                  Slet
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
