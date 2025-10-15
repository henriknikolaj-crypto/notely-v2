"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function ShortcutGenerateQuestion() {
  const busy = useRef(false);
  const router = useRouter();

  useEffect(() => {
    async function gen() {
      if (busy.current) return;
      busy.current = true;
      try {
        const res = await fetch("/api/generate-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includeBackground: false, count: 1 }),
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
        busy.current = false;
      }
    }

    function onKey(e: KeyboardEvent) {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (ctrlOrMeta && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        gen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return null; // usynlig – kun genvej
}
