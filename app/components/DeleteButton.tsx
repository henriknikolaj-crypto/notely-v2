/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteButton({ id, redirectTo }: { id: string; redirectTo?: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onDelete() {
    if (!confirm("Slet vurdering? Dette kan ikke fortrydes.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/exam/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (e: any) {
      alert(e.message || "Fejl ved sletning");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={loading}
      className="rounded-xl border px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-60"
    >
      {loading ? "Sletter…" : "Slet"}
    </button>
  );
}

