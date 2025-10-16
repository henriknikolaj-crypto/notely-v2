/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";

export default function DeleteButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function onDelete() {
    if (!confirm("Slet denne vurdering?")) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/exam-sessions/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Kunne ikke slette.");
      // tilbage til oversigten
      window.location.href = "/exam";
    } catch (e:any) {
      setErr(e?.message ?? "Ukendt fejl");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4">
      {err && <div className="mb-2 text-sm border border-red-300 bg-red-50 rounded p-2">{err}</div>}
      <button
        onClick={onDelete}
        disabled={loading}
        className="rounded-2xl px-4 py-2 border shadow-sm hover:shadow disabled:opacity-60"
      >
        {loading ? "Sletter…" : "Slet vurdering"}
      </button>
    </div>
  );
}