/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegenerateQuestionFab() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
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
        alert("Nyt spørgsmål genereret ✅");
        router.refresh();
        // valgfrit: scroll op til overskriften
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
      }
    } catch (e: any) {
      alert(`Uventet fejl: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title="Generér nyt spørgsmål"
      className="fixed bottom-4 right-4 z-50 rounded-full px-4 py-3 shadow-lg bg-black text-white disabled:opacity-50"
      style={{ fontWeight: 600 }}
    >
      {loading ? "Genererer…" : "Nyt spørgsmål"}
    </button>
  );
}



