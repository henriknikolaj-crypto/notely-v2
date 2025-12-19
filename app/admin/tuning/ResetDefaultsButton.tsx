"use client";
import { useState } from "react";

export default function ResetDefaultsButton() {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!confirm("Nulstil dine retrieval-indstillinger til defaults?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/retrieval-config", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error ?? "Kunne ikke nulstille");
        return;
      }
      location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        border: "1px solid #cbd5e1",
        padding: "6px 10px",
        borderRadius: 6,
        opacity: busy ? 0.7 : 1
      }}
    >
      {busy ? "Nulstiller" : "Nulstil til defaults"}
    </button>
  );
}



