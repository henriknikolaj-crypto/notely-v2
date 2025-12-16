"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function RegenerateOverlay() {
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const loadingRef = useRef(false);
  const router = useRouter();

  // hold ref i sync, så generate kan være stabil uden at have "loading" i deps
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const generate = useCallback(async () => {
    if (busy.current || loadingRef.current) return;

    busy.current = true;
    setLoading(true);

    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground: false, count: 1 }),
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        alert(`Fejl ved generering: ${data?.error ?? res.statusText}`);
      } else {
        router.refresh();
        try {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch {}
      }
    } catch (e: any) {
      alert(`Uventet fejl: ${e?.message ?? e}`);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [router]);

  // Genvej: Alt+N (ikke Ctrl+N, som browseren tager)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        void generate();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [generate]);

  // Fast overlay-knap nederst til højre
  return (
    <button
      onClick={() => void generate()}
      disabled={loading}
      title="Generér nyt spørgsmål (Alt+N)"
      className="fixed bottom-4 right-4 z-50 rounded-full px-4 py-3 shadow-lg bg-black text-white disabled:opacity-50"
      style={{ fontWeight: 600 }}
    >
      {loading ? "Genererer…" : "Nyt spørgsmål (Alt+N)"}
    </button>
  );
}
