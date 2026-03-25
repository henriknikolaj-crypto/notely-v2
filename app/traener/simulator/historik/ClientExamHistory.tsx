"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  created_at: string | null;
  score: number | null;
  folder_name: string | null;
};

type ApiResponse =
  | { ok: true; mode: "skrift" | "mundtlig"; items: Array<Item & { folder_id?: string | null }>; total: number }
  | { ok: false; error?: string };

function formatDT(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatScore(score: number | null) {
  if (score == null) return "–";
  return `${Math.round(score)}%`;
}

export default function ClientExamHistory({ mode }: { mode: "skrift" | "mundtlig" }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      try {
        const res = await fetch(`/api/recent-exam-rounds?mode=${encodeURIComponent(mode)}&limit=50`, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        const data = (await res.json()) as ApiResponse;

        if (cancelled) return;

        if (!res.ok || !data || (data as any).ok === false) {
          setItems([]);
          setTotal(0);
          setError(String((data as any)?.error ?? `Kunne ikke hente historik (${res.status}).`));
          return;
        }

        const ok = data as Extract<ApiResponse, { ok: true }>;
        const list = ok.items ?? [];
        setItems(list as any);
        setTotal(typeof ok.total === "number" ? ok.total : list.length);
      } catch (e) {
        console.error("ClientExamHistory error:", e);
        if (!cancelled) {
          setItems([]);
          setTotal(0);
          setError("Kunne ikke hente historik.");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const list = items ?? [];
  const shown = list.slice(0, 50);

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-zinc-900">
        {mode === "mundtlig" ? "Mundtlig-historik" : "Skriftlig-historik"} (seneste {shown.length} af {Math.min(total, 50)})
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      {!error && shown.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          Ingen runder endnu. Start en runde i Eksamen.
        </div>
      ) : null}

      {shown.length > 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-2">
          <ul className="divide-y divide-zinc-100">
            {shown.map((r) => (
              <li key={r.id} className="px-3 py-3">
                <div className="text-sm text-zinc-900">
                  {formatDT(r.created_at)} · {(r.folder_name ?? "").trim() || "Valgte mapper"} · {formatScore(r.score)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
