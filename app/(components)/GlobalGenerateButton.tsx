 
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GlobalGenerateButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground: false, count: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Kunne ikke generere spørgsmål");
      const q = String(data?.question ?? "");
      // Fortæl ClientExam at der er nyt spørgsmål
      window.dispatchEvent(new CustomEvent("question:updated", { detail: q }));
      router.refresh(); // opdater "Seneste vurderinger"
    } catch (e: any) {
      alert(e?.message || "Fejl ved generering");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Generér nyt spørgsmål"
      className="fixed bottom-4 right-4 z-[1000] rounded-full px-4 py-3 bg-black text-white shadow-lg hover:opacity-90 disabled:opacity-50"
      style={{ fontWeight: 600 }}
      disabled={loading}
    >
      {loading ? "Genererer…" : "Nyt spørgsmål"}
    </button>
  );
}



