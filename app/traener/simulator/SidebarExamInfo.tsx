"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const SIDEBAR_SEE_ALL_CLASS = "text-[11px] text-zinc-500 hover:text-zinc-700";

type Item = {
  id: string;
  created_at: string | null;
  score: number | null;
  folder_id: string | null;
  folder_name: string | null;
};

type ApiOk = { ok: true; mode: "skrift" | "mundtlig"; items: Item[]; total: number };
type ApiErr = { ok: false; error?: string };
type ApiResponse = ApiOk | ApiErr;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit" });
}

function formatScore(score: number | null): string {
  if (score == null) return "–";
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return `${s}%`;
}

function labelForItem(s: Item): string {
  const name = (s.folder_name ?? "").trim();
  if (name) return name;
  return "Valgte mapper";
}

export default function SidebarExamInfo({ mode: modeProp }: { mode?: "skrift" | "mundtlig" }) {
  const pathname = usePathname() || "";
  const sp = useSearchParams();

  const mode: "skrift" | "mundtlig" =
    modeProp ?? (pathname.startsWith("/traener/mundtlig") ? "mundtlig" : "skrift");

  const qs = useMemo(() => (sp ? sp.toString() : ""), [sp]);
  const withQS = (href: string) => (qs ? `${href}?${qs}` : href);

  const historyHref =
    mode === "mundtlig"
      ? withQS("/traener/mundtlig/historik")
      : withQS("/traener/simulator/historik");

  const [items, setItems] = useState<Item[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const url = `/api/recent-exam-rounds?mode=${encodeURIComponent(mode)}&limit=5`;
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        const data = (await res.json().catch(() => null)) as ApiResponse | null;
        if (cancelled) return;

        if (!res.ok || !data || (data as any).ok === false) {
          const msg = (data as any)?.error ?? `Kunne ikke hente runder (${res.status}).`;
          setError(String(msg));
          setItems([]);
          setTotal(0);
          return;
        }

        const ok = data as ApiOk;
        const list = ok.items ?? [];
        const rawTotal = typeof ok.total === "number" ? ok.total : list.length;

        setItems(list);
        setTotal(Math.min(rawTotal, 50));
        setError(null);
      } catch (err) {
        console.error("SidebarExamInfo fetch error:", err);
        if (!cancelled) {
          setError("Kunne ikke hente runder.");
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    function handleRefresh() {
      load();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("notely:exam-updated", handleRefresh);
      window.addEventListener("notely:simulator-updated", handleRefresh);
    }

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("notely:exam-updated", handleRefresh);
        window.removeEventListener("notely:simulator-updated", handleRefresh);
      }
    };
  }, [mode]);

  return (
    <div className="space-y-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="font-semibold text-zinc-800">Seneste runder</div>
        {(total ?? 0) > 0 ? (
          <Link href={historyHref} className={SIDEBAR_SEE_ALL_CLASS}>
            Se alle
          </Link>
        ) : null}
      </div>

      {loading ? <p className="text-[11px] text-zinc-500">Henter runder …</p> : null}
      {error && !loading ? <p className="text-[11px] text-red-600">{error}</p> : null}

      {!loading && !error ? (
        (items ?? []).length ? (
          <div className="text-[11px] text-zinc-700">
            <ul className="space-y-1">
              {(items ?? []).slice(0, 5).map((s) => (
                <li key={s.id} className="truncate">
                  {formatDate(s.created_at)} · {labelForItem(s)} · {formatScore(s.score)}
                </li>
              ))}
            </ul>

            <div className="mt-1 text-[10px] text-zinc-400">
              I alt {total ?? (items ?? []).length} runder
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">Ingen runder endnu.</p>
        )
      ) : null}
    </div>
  );
}
