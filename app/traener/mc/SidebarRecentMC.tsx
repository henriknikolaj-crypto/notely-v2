// app/traener/mc/SidebarRecentMC.tsx
"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  created_at: string | null;
  score: number | null;
  folder_name: string | null;
};

type ApiResponse = {
  items: Item[];
  // hvis API’et senere returnerer total, bruger vi det – ellers falder vi tilbage til items.length
  total?: number;
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatResult(score: number | null): string {
  if (score == null) return "–";
  if (score >= 100) return "Rigtigt";
  if (score <= 0) return "Forkert";
  return `${score}%`;
}

/**
 * Sidebar-liste med MC-forsøg (kun de seneste 5).
 * Overskrift + "Se alle" håndteres i TrainingSidebarStats.
 */
export default function SidebarRecentMC() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/recent-mc");
        if (!res.ok) throw new Error(`Bad status: ${res.status}`);

        const data = (await res.json()) as ApiResponse;
        if (cancelled) return;

        const list = data.items ?? [];
        setItems(list);

        // Brug total fra API hvis den findes, ellers antal i listen.
        const rawTotal =
          typeof data.total === "number" ? data.total : list.length;

        // Vi viser aldrig højere tal end 50 (vores max-historik).
        setTotal(Math.min(rawTotal, 50));

        setError(null);
        setLoading(false);
      } catch (err) {
        console.error("SidebarRecentMC fetch error:", err);
        if (!cancelled) {
          setError("Kunne ikke hente MC-historik.");
          setItems([]);
          setTotal(0);
          setLoading(false);
        }
      }
    }

    load();

    function handleRefresh() {
      load();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("notely:mc-updated", handleRefresh);
    }

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("notely:mc-updated", handleRefresh);
      }
    };
  }, []);

  if (loading) {
    return (
      <p className="text-[11px] text-zinc-500">
        Henter dine MC-forsøg …
      </p>
    );
  }

  if (error) {
    return <p className="text-[11px] text-red-600">{error}</p>;
  }

  const all = items ?? [];
  const latestFive = all.slice(0, 5);

  if (!latestFive.length) {
    return (
      <p className="text-[11px] text-zinc-500">
        Ingen MC-forsøg endnu. Svar på et par spørgsmål i højre side for at
        komme i gang.
      </p>
    );
  }

  return (
    <div className="text-[11px] text-zinc-700">
      <ul className="space-y-1">
        {latestFive.map((s) => (
          <li key={s.id} className="truncate">
            {formatDate(s.created_at)} · {s.folder_name ?? "Alle mapper"} ·{" "}
            {formatResult(s.score)}
          </li>
        ))}
      </ul>

      <div className="mt-1 text-[10px] text-zinc-400">
        I alt {total ?? all.length} evalueringer
      </div>
    </div>
  );
}
