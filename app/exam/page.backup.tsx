/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";

export default function ExamPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [out, setOut] = useState<{feedback:string;score:number|null}|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);

  async function evaluate() {
    setLoading(true); setErr(null); setOut(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: process.env.NEXT_PUBLIC_DEV_USER_ID ?? "DEV_USER_ID",
          question, answer
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Ukendt fejl");
      setOut({ feedback: data.feedback, score: data.score ?? null });
    } catch (e:any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6 mt-10 bg-white rounded-2xl shadow">
      <h1 className="text-2xl font-semibold mb-2">Eksamensfeedback</h1>
      <p className="text-sm text-gray-600 mb-6">
        Indsæt dit spørgsmål (valgfrit) og dit svar. Retrieval henter dine noter i baggrunden.
      </p>

      <label className="block text-sm font-medium text-gray-700 mb-1">Spørgsmål (valgfrit)</label>
      <textarea className="w-full border rounded-lg p-3 mb-4" rows={3}
        value={question} onChange={e=>setQuestion(e.target.value)}
        placeholder="Fx: Redegør for begrebet ..." />

      <label className="block text-sm font-medium text-gray-700 mb-1">Dit svar</label>
      <textarea className="w-full border rounded-lg p-3 mb-4" rows={8}
        value={answer} onChange={e=>setAnswer(e.target.value)}
        placeholder="Skriv eller indsæt dit svar her..." />

      <button onClick={evaluate} disabled={loading || !answer.trim()}
        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
        {loading ? "Vurderer..." : "Få feedback"}
      </button>

      {err && <div className="mt-4 text-red-600">{err}</div>}

      {out && (
        <section className="mt-6 border-t pt-4">
          <h2 className="font-semibold mb-2">Feedback</h2>
          <pre className="whitespace-pre-wrap text-gray-800">{out.feedback}</pre>
          {out.score!=null && <p className="mt-3 text-sm text-gray-600">Vurdering: {out.score}/10</p>}
        </section>
      )}
    </main>
  );
}

