// app/traener/NewFolderButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewFolderButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    if (loading) return;

    const name = window.prompt("Navn på ny mappe?");
    const trimmed = (name || "").trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || "Kunne ikke oprette mappe");
        return;
      }

      // Hent mapper + counts igen
      router.refresh();
    } catch (e: any) {
      alert(e?.message || "Kunne ikke oprette mappe");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="text-[11px] text-zinc-500 hover:text-zinc-900 disabled:opacity-60"
    >
      {loading ? "Opretter..." : "+ Ny mappe"}
    </button>
  );
}
