 
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function BetterQuestionPanel() {
  const [question, setQuestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function loadLatest() {
    try {
      const r = await fetch("/api/last-question", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setQuestion(j?.question ?? null);
    } catch {}
  }

  useEffect(() => {
    loadLatest();
  }, []);

  async function handleGenerate() {
    if (loading) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground: false, count: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error ?? "Ukendt fejl");
      } else {
        setQuestion(data?.question ?? null);
        // Opdater resten af siden (seneste vurderinger m.m.)
        router.refresh();
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
      }
    } catch (e:any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Eksamensspørgsmål</h1>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-black text-white text-sm disabled:opacity-50"
        >
          {loading ? "Genererer…" : "Generér nyt spørgsmål"}
        </button>
      </div>

      {err && <div className="mt-3 text-sm text-red-600">Fejl: {err}</div>}

      <div className="mt-3 text-[15px] leading-6">
        {question ? question : <span className="opacity-60">Ingen spørgsmål endnu – klik “Generér nyt spørgsmål”.</span>}
      </div>
    </div>
  );
}



