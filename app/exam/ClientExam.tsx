"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Minimal, indbygget Toast så vi undgår import-problemer
function Toast({ text, show, onClose }: { text: string; show: boolean; onClose: () => void }) {
  if (!show) return null;
  return (
    <div
      className="fixed top-4 right-4 z-[2000] bg-black text-white px-3 py-2 rounded shadow cursor-pointer"
      onClick={onClose}
      role="status"
      aria-live="polite"
      title="Klik for at lukke"
    >
      {text}
    </div>
  );
}

export default function ClientExam() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loadingGen, setLoadingGen] = useState(false);
  const [loadingEval, setLoadingEval] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  const MIN_LEN = 120;

  // (Valgfrit) Hent sidste spørgsmål, hvis rute findes – stiltiende fallback
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/last-question", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json().catch(() => ({} as any));
        if (j?.question && typeof j.question === "string") setQuestion(j.question);
      } catch {}
    })();
  }, []);

  async function onGenerate() {
    if (loadingGen) return;
    setLoadingGen(true);
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground: false, count: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Kunne ikke generere spørgsmål");
      const q = String(data?.question ?? "");
      setQuestion(q);
      setToast("Nyt spørgsmål genereret");
      // router.refresh();  // slået fra for at undgå blank side                 // opdater SSR-lister
      setTimeout(() => answerRef.current?.focus(), 50);
    } catch (e: any) {
      setToast(e?.message || "Fejl ved generering");
    } finally {
      setLoadingGen(false);
    }
  }

  async function onEvaluate() {
    if (!question.trim()) {
      setToast("Skriv eller generér et eksamensspørgsmål først.");
      return;
    }
    if (answer.trim().length < MIN_LEN) {
      setToast(`Dit svar er meget kort. Skriv mindst ${MIN_LEN} tegn.`);
      answerRef.current?.focus();
      return;
    }
    setLoadingEval(true);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Evaluate failed");
      const scoreNum = typeof data?.score === "number" ? Math.round(data.score) : 0;
      setToast(`Vurdering gemt · Score: ${scoreNum}/100`);
      setAnswer("");
      // router.refresh();  // slået fra for at undgå blank side
    } catch (e: any) {
      setToast(e?.message || "Fejl under evaluering");
    } finally {
      setLoadingEval(false);
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Eksamensspørgsmål</h2>
          <button
            type="button"
            onClick={onGenerate}
            disabled={loadingGen}
            className="rounded-xl border px-3 py-2 text-sm font-semibold bg-black text-white disabled:opacity-60"
            title="Generér nyt spørgsmål"
          >
            {loadingGen ? "Genererer…" : "Generér nyt spørgsmål"}
          </button>
        </div>

        <p className="text-sm">
          Forklar forskellen mellem differenskvotienten og differentialkvotienten, og hvordan de relaterer sig til sekantlinjen og tangenten.
        </p>

        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="mt-1 w-full rounded-xl border px-3 py-2"
          placeholder="Skriv eller generér et eksamensspørgsmål…"
        />

        <div>
          <label className="block text-sm font-medium">Dit svar</label>
          <textarea
            ref={answerRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="mt-1 w-full min-h-[160px] rounded-xl border px-3 py-2"
            placeholder="Indsæt eller skriv dit svar…"
          />
          <p className="mt-1 text-xs text-neutral-500">
            {answer.trim().length}/{MIN_LEN} tegn
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onEvaluate}
            disabled={loadingEval}
            className="rounded-xl border px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-60"
          >
            {loadingEval ? "Vurderer…" : "Evaluer mit svar"}
          </button>
        </div>
      </div>

      <Toast text={toast ?? ""} show={!!toast} onClose={() => setToast(null)} />
    </>
  );
}

