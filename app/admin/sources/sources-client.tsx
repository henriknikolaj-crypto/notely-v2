"use client";
import { useState } from "react";

type Row = { domain: string; first_seen?: string; last_seen?: string; hit_count?: number };
const TIER_DEFAULTS: Record<"A"|"B"|"C", number> = { A: 1.0, B: 0.6, C: 0.3 };

export default function SourcesClient({ initialItems }: { initialItems: Row[] }) {
  const [items, setItems] = useState<Row[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/sources/candidates", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
      else alert(data?.error ?? "Kunne ikke hente kandidater");
    } finally {
      setLoading(false);
    }
  }

  async function promote(d: string, tier: "A"|"B"|"C") {
    setLoading(true);
    try {
      const res = await fetch("/api/sources/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d, tier, weight: TIER_DEFAULTS[tier] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error ?? "Promote fejlede");
        return;
      }
      setItems(prev => prev.filter(x => x.domain !== d));
    } finally {
      setLoading(false);
    }
  }

  const shown = items.filter(r => r.domain.toLowerCase().includes(filter.toLowerCase()));

  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">Kilde-kandidater</h1>

      <div className="flex gap-3 items-center mb-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter domæne"
          className="border rounded px-2 py-1"
        />
        <button onClick={refresh} disabled={loading} className="border rounded px-3 py-1">
          {loading ? "Henter" : "Opdatér"}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="opacity-70">Ingen kandidater.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-100">
              <th className="text-left p-2 border">Domæne</th>
              <th className="text-left p-2 border">Hits</th>
              <th className="text-left p-2 border">Sidst set</th>
              <th className="text-left p-2 border">Promote</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.domain}>
                <td className="p-2 border font-mono">{r.domain}</td>
                <td className="p-2 border">{r.hit_count ?? 0}</td>
                <td className="p-2 border">{r.last_seen ? new Date(r.last_seen).toLocaleString() : ""}</td>
                <td className="p-2 border">
                  <div className="flex gap-2">
                    <button onClick={() => promote(r.domain, "A")} className="border rounded px-2 py-1">Promote A</button>
                    <button onClick={() => promote(r.domain, "B")} className="border rounded px-2 py-1">B</button>
                    <button onClick={() => promote(r.domain, "C")} className="border rounded px-2 py-1">C</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}


