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
  scope_label?: string | null;
};

type SessionsResp = {
  ok: boolean;
  sessions?: SessionRow[];
  scope?: {
    requested?: boolean;
    applied?: boolean;
    hadInvalidValues?: boolean;
    label?: string | null;
  };
  error?: string;
};

type StatsResp = {
  ok: boolean;
  todayUsed?: number;
  lastSessionAt?: string | null;
  dayStartDK?: string;
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

async function readJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 140);
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
}

function buildQs(base: Record<string, string> = {}) {
  const qs = new URLSearchParams(base);
  return qs.toString();
}

async function fetchSessions() {
  const r = await fetch(
    `/api/flashcards/sessions?${buildQs({ limit: "3" })}`,
    { cache: "no-store" }
  );
  const j = (await readJsonSafe(r)) as SessionsResp;
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j.sessions ?? [];
}

async function fetchStats() {
  const r = await fetch(
    `/api/flashcards/stats`,
    { cache: "no-store" }
  );
  const j = (await readJsonSafe(r)) as StatsResp;
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return {
    todayUsed: Math.max(0, Math.round(Number(j?.todayUsed ?? 0) || 0)),
    lastSessionAt: j?.lastSessionAt ?? null,
  };
}

function dedupeSessionsById(rows: SessionRow[]): SessionRow[] {
  const map = new Map<string, SessionRow>();
  const noId: SessionRow[] = [];
  for (const row of rows) {
    const id = String(row?.id ?? "").trim();
    if (!id) {
      noId.push(row);
      continue;
    }
    if (!map.has(id)) map.set(id, row);
  }
  return [...Array.from(map.values()), ...noId];
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

  const [done, setDone] = React.useState(0);
  const [sessions, setSessions] = React.useState<SessionRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [lastSessionAt, setLastSessionAt] = React.useState<string | null>(null);

  const historyHref = React.useMemo(() => {
    const qs = sp?.toString() ?? "";
    return qs ? `/traener/flashcards/historik?${qs}` : "/traener/flashcards/historik";
  }, [sp]);

  const refresh = React.useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const [latestRows, stats] = await Promise.all([fetchSessions(), fetchStats()]);
      const uniqueSessions = dedupeSessionsById(latestRows).sort((a, b) =>
        String(b?.created_at ?? "").localeCompare(String(a?.created_at ?? "")),
      );
      setSessions(uniqueSessions);
      setDone(stats.todayUsed);
      setLastSessionAt(stats.lastSessionAt);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

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
        <div className="mb-1 font-semibold text-zinc-800">Genererede kort i dag</div>

        <div className="space-y-1 text-zinc-700">
          <div>
            I dag: <span className="font-semibold">{done}</span> kort
          </div>
          <div>
            Seneste session:{" "}
            <span className="font-semibold">{fmtDMY(lastSessionAt)}</span>
          </div>
        </div>

        {loading ? <div className="mt-2 text-[11px] text-zinc-400">Henter…</div> : null}

        {err ? <div className="mt-2 text-[11px] text-red-600">{err}</div> : null}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="font-semibold text-zinc-800">Seneste sessions</div>
          {sessions.length > 0 ? (
            <Link
              href={historyHref}
              className="text-[11px] text-zinc-500 hover:text-zinc-700"
            >
              Se alle
            </Link>
          ) : null}
        </div>

        {sessions.length === 0 ? (
          <div className="text-[11px] text-zinc-400">Ingen sessions endnu.</div>
        ) : (
          <ul className="space-y-1">
            {sessions.slice(0, 3).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 py-1"
              >
                <div className="min-w-0">
                  <div className="text-[11px] text-zinc-500">
                    {fmtDMY(s.created_at)} — {s.returned} kort
                  </div>
                  {s.scope_label ? (
                    <div className="truncate text-[11px] text-zinc-400">{s.scope_label}</div>
                  ) : null}
                </div>

                <button
                  className="shrink-0 text-[11px] text-slate-700 hover:text-slate-900 disabled:opacity-50"
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
