"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";

type EvalResult = { ok?: boolean; score?: number; feedback?: string; error?: string };

export default function ClientExam() {
  const [question, setQuestion] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [loadingGen, setLoadingGen] = useState(false);
  const [loadingEval, setLoadingEval] = useState(false);
  const [result, setResult] = useState<EvalResult | null>(null);

  async function generateQuestion() {
    try {
      setLoadingGen(true);
      setResult(null);
      const res = await fetch("/api/generate-question", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error ?? "Generering fejlede");
        return;
      }
      setQuestion(data.question ?? null);
      setSessionId(data.sessionId ?? null);
      setAnswer("");
    } finally {
      setLoadingGen(false);
    }
  }

  async function evaluate() {
    if (!question) {
      alert("Der er ikke noget spørgsmål endnu.");
      return;
    }
    try {
      setLoadingEval(true);
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, sessionId }),
      });
      const data = (await res.json()) as EvalResult;
      if (!res.ok) {
        alert(data?.error ?? "Evaluering fejlede");
        return;
      }
      setResult({ ok: true, score: data.score ?? 0, feedback: data.feedback ?? "" });
    } finally {
      setLoadingEval(false);
    }
  }

  function resetAnswer() {
    setAnswer("");
    setResult(null);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Eksamensøvelse</h1>
        <button
          className="border px-3 py-1 rounded disabled:opacity-60"
          onClick={generateQuestion}
          disabled={loadingGen}
        >
          {loadingGen ? "Genererer..." : "Generér nyt spørgsmål"}
        </button>
      </div>

      <div>
        {question ? (
          <p>
            <strong>Spørgsmål:</strong> {question}
          </p>
        ) : (
          <p>Ingen aktiv opgave. Klik Generér nyt spørgsmål.</p>
        )}
      </div>

      <div>
        <textarea
          className="w-full min-h-[140px] border rounded p-2"
          placeholder="Skriv dit svar her"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button
            className="border px-3 py-1 rounded disabled:opacity-60"
            onClick={evaluate}
            disabled={loadingEval || !question}
          >
            {loadingEval ? "Evaluerer..." : "Evaluer svar"}
          </button>
          <button className="border px-3 py-1 rounded" onClick={resetAnswer}>
            Ryd
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-4 space-y-2">
          <h2 className="text-xl font-semibold">Feedback</h2>

          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-bold">{typeof result.score === "number" ? result.score : ""}</div>
            <div className="opacity-70">/ 100</div>
          </div>

          <div
            className="whitespace-pre-wrap leading-relaxed"
            // feedback som almindelig tekst med linjeskift
          >
            {result.feedback ?? ""}
          </div>
        </div>
      )}
    </section>
  );
}
