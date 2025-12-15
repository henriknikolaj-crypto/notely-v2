/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MinimalGenerateButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    console.log("[UI] Klik på 'Nyt spørgsmål'…");
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground: false, count: 1 }),
      });
      console.log("[UI] /api/generate-question status:", res.status);
      let data: any = {};
      try { data = await res.json(); } catch {}
      console.log("[UI] /api/generate-question body:", data);
      if (!res.ok) {
        alert(`Fejl: ${data?.error ?? res.statusText}`);
      } else {
        // vis spørgsmålet i DOM mens vi refresher resten
        const el = document.getElementById("min-last-question");
        if (el) el.textContent = data?.question ?? "(ingen)";
        router.refresh();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e: any) {
      console.error("[UI] Uventet fejl:", e?.message ?? e);
      alert(`Uventet fejl: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{marginBottom: 12}}>
      <button onClick={handleClick} disabled={busy} style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #000",
        background: "#000",
        color: "#fff",
        fontWeight: 600
      }}>
        {busy ? "Genererer…" : "Nyt spørgsmål"}
      </button>
      <div id="min-last-question" style={{marginTop: 8, fontSize: 15}}></div>
    </div>
  );
}



