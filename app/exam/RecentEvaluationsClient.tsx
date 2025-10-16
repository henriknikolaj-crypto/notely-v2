/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"
import Link from "next/link";
import { useEffect, useState } from "react";

type Item = { id: string; question: string; score: number; created_at: string };

export default function RecentEvaluationsClient() {
  const [items, setItems] = useState<Item[]|null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/recent-evals", { cache: "no-store" });
      const json = await res.json();
      setItems(json.items ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    const onDone = () => load();
    window.addEventListener("eval:completed", onDone);
    return () => window.removeEventListener("eval:completed", onDone);
  }, []);

  async function onDelete(id: string) {
    if (!confirm("Slet denne vurdering?")) return;
    const prev = items ?? [];
    setItems(prev.filter(i => i.id !== id)); // optimistisk UI
    const res = await fetch(`/api/exam-sessions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Kunne ikke slette.");
      setItems(prev); // rollback
    }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold mb-2">Seneste vurderinger</h2>
        <Link href="/exam/history" className="text-sm underline">Se alle</Link>
      </div>
      {loading && <div>Henter…</div>}
      {!loading && (!items || items.length === 0) && <div>Ingen vurderinger endnu.</div>}
      <ul className="space-y-2">
        {items?.map((it) => (
          <li key={it.id} className="rounded-xl border p-3 hover:bg-gray-50 flex items-start justify-between gap-4">
            <Link href={`/exam/${it.id}`} className="block flex-1">
              <div className="text-sm text-gray-600">{new Date(it.created_at).toLocaleString()}</div>
              <div className="font-medium underline">Score: {it.score}/100</div>
              <div className="text-sm underline line-clamp-2">{it.question}</div>
            </Link>
            <button onClick={() => onDelete(it.id)} className="text-sm underline">Slet</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

