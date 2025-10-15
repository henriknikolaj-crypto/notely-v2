"use client";
import { useEffect, useState } from "react";

type SessionItem = {
  id: string;
  created_at: string;
  question?: string | null;
  feedback?: string | null;
  model?: string | null;
};

const KEY = "/api/exam-sessions?limit=5";

export default function SenesteVurderinger() {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const r = await fetch(KEY, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setItems(data?.sessions ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Kunne ikke hente data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("exam:updated", h);
    return () => window.removeEventListener("exam:updated", h);
  }, []);

  if (loading) return <p className="text-sm text-gray-500">Henter…</p>;
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!items.length) return <p className="text-sm text-gray-500">Ingen tidligere vurderinger.</p>;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">De seneste 5 vurderinger</p>
        <button onClick={load} className="text-xs underline text-gray-600 hover:text-gray-900">
          Opdater
        </button>
      </div>
      {items.map((s) => (
        <article key={s.id} className="border rounded-lg p-3 bg-white shadow-sm">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">{s.question?.slice(0, 100) || "Eksamensspørgsmål"}</div>
            <div className="text-xs text-gray-500">{new Date(s.created_at).toLocaleString()} · {s.model || "–"}</div>
          </header>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap mt-1">
            {s.feedback?.slice(0, 200)}{s.feedback && s.feedback.length > 200 ? "…" : ""}
          </pre>
        </article>
      ))}
    </div>
  );
}
