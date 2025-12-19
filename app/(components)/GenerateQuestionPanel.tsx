 
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GenerateQuestionPanel() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const router = useRouter();

  async function handleGenerate() {
    setLoading(true);
    setErr(null);
    setQuestion(null);

    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground: false }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Ukendt fejl");

      setQuestion(data.question);
      router.refresh(); // <-- v7-refresh efter succes
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-50"
      >
        {loading ? "Genererer..." : "Generér spørgsmål"}
      </button>

      {err && <div className="text-red-600 text-sm">Fejl: {err}</div>}

      {question && (
        <div className="p-4 rounded-xl border">
          <div className="text-xs opacity-60 mb-1">AI-spørgsmål</div>
          <div className="font-medium">{question}</div>
        </div>
      )}
    </div>
  );
}



