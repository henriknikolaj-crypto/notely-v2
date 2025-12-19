 
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegenerateInline() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground: false, count: 1 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Fejl ved generering: ${data?.error ?? res.statusText}`);
      } else {
        router.refresh();
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
      }
    } catch (e: any) {
      alert(`Uventet fejl: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={onClick}
        disabled={loading}
        className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {loading ? "Genererer…" : "Generér nyt spørgsmål"}
      </button>
    </div>
  );
}



