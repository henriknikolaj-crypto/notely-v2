 
"use client";
import { useState } from "react";

export default function EvaluateDebug() {
  const [input, setInput] = useState("Test 2 test");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null); setResult(null);
    try {
      // Forsøg 1: { answer }
      let res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: input })
      });
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (res.ok && data) { setResult({ attempt: 1, ok: res.ok, data }); return; }

      // Forsøg 2: { answerText }
      res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerText: input })
      });
      try { data = await res.json(); } catch {}
      setResult({ attempt: 2, ok: res.ok, data });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 border rounded p-3">
      <div className="text-sm opacity-70 mb-2">Evaluate Debug</div>
      <textarea
        className="w-full border rounded p-2 mb-2"
        rows={3}
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Skriv et kort svar…"
      />
      <button
        onClick={run}
        disabled={loading}
        className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {loading ? "Tester…" : "Kør evaluate-debug"}
      </button>

      {err && <div className="text-red-600 mt-2 text-sm">Fejl: {err}</div>}
      {result && (
        <pre className="text-xs mt-3 overflow-auto max-h-64 bg-neutral-50 p-2 rounded">
{JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}



