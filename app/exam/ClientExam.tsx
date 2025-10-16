/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import dynamic from "next/dynamic";
import { useMemo, useState, useEffect } from "react";

const RecentEvaluationsClient = dynamic(() => import("./RecentEvaluationsClient"), { ssr: false });
const MAX_CHARS = 400;

function hash(s: string) { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))|0; return h.toString(); }

type RefItem = { title:string; author?:string; year?:string; venue?:string; url?:string; peer_reviewed?:boolean };

export default function ClientExam() {
  const [question, setQuestion] = useState("Hvad er forskellen på differenskvotient og differentialkvotient?");
  const [answer, setAnswer] = useState("");
  const [useContext, setUseContext] = useState(false); // eneste valg for brugeren

  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [refs, setRefs] = useState<RefItem[]|null>(null);
  const [loadingEval, setLoadingEval] = useState(false);
  const [loadingGen, setLoadingGen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const key = useMemo(() => `exam_answer:${hash(question)}`, [question]);
  useEffect(() => { try { const s = localStorage.getItem(key); setAnswer(s ?? ""); } catch {} }, [key]);
  useEffect(() => { try { localStorage.setItem(key, answer); } catch {} }, [key, answer]);

  const used = useMemo(() => Math.min(answer.length, MAX_CHARS), [answer]);
  function onChangeAnswer(v: string) { if (v.length <= MAX_CHARS) setAnswer(v); }

  async function onEvaluateClick() {
    setLoadingEval(true); setFeedback(null); setRefs(null); setErrorMsg(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, useContext }),
      });
      if (!res.ok) throw new Error("Evaluate fejlede");
      const json = await res.json();
      setScore(typeof json?.score === "number" ? json.score : 0);
      setFeedback(json?.feedback ?? "Ingen feedback modtaget.");
      setRefs(Array.isArray(json?.references) ? json.references : null);
      try { localStorage.removeItem(key); } catch {}
      window.dispatchEvent(new CustomEvent("eval:completed"));
    } catch (e:any) {
      setScore(0); setFeedback(null); setErrorMsg(e?.message ?? "Ukendt fejl under evaluering.");
    } finally { setLoadingEval(false); }
  }

  async function onGenerateClick() {
    setLoadingGen(true); setErrorMsg(null);
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useContext }),
      });
      if (!res.ok) throw new Error("Generering fejlede");
      const json = await res.json();
      setQuestion(json?.question ?? "Beskriv grænsebegrebet kort.");
      setAnswer(""); setScore(null); setFeedback(null); setRefs(null);
    } catch (e:any) {
      setErrorMsg(e?.message ?? "Ukendt fejl under generering.");
    } finally { setLoadingGen(false); }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {errorMsg && <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm">{errorMsg}</div>}

      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Eksamensspørgsmål</h1>
        <button type="button" onClick={onGenerateClick} disabled={loadingGen}
          className="rounded-2xl px-4 py-2 shadow-sm border hover:shadow transition disabled:opacity-60">
          {loadingGen ? "Genererer…" : "Generér nyt spørgsmål"}
        </button>
      </header>

      <div className="mb-3 rounded-2xl border bg-white p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useContext} onChange={(e)=>setUseContext(e.target.checked)} />
          Vis kilder og henvisninger i feedback
        </label>
      </div>

      <section className="mb-3 rounded-2xl border bg-white p-4 shadow-sm">
        <p className="text-lg leading-relaxed">{question}</p>
      </section>

      <label className="block text-sm font-medium mb-2">Dit svar</label>
      <textarea className="w-full min-h-40 rounded-xl border bg-white p-3 shadow-sm focus:outline-none focus:ring-2"
        placeholder="Indsæt eller skriv dit svar…" value={answer} onChange={(e) => onChangeAnswer(e.target.value)} />

      <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
        <span>{used}/{MAX_CHARS} tegn</span>
        <button type="button" onClick={onEvaluateClick}
          disabled={loadingEval || answer.trim().length === 0}
          className="rounded-2xl px-4 py-2 shadow-sm border hover:shadow transition disabled:opacity-60">
          {loadingEval ? "Evaluerer…" : "Evaluer mit svar"}
        </button>
      </div>

      {score !== null && (
        <div className="mt-4 text-base">
          <div className="font-medium">Vurdering gemt · Score: {score}/100</div>
          {feedback && <div className="mt-1 whitespace-pre-wrap">{feedback}</div>}
          {refs && refs.length > 0 && (
            <div className="mt-3">
              <div className="font-medium mb-1">Litteratur</div>
              <ul className="list-disc pl-5 text-sm">
                {refs.map((r, i) => (
                  <li key={i}>
                    {r.author ? `${r.author}: ` : ""}{r.title}{r.year ? ` (${r.year})` : ""}{r.venue ? `, ${r.venue}` : ""}{r.peer_reviewed ? " [peer-reviewed]" : ""}{r.url ? ` – ${r.url}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <RecentEvaluationsClient />
    </div>
  );
}


