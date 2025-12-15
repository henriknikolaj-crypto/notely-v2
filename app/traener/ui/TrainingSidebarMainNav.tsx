// app/traener/ui/TrainingSidebarMainNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TrainingSidebarMainNav() {
  const raw = usePathname() || "/";
  const p = raw.replace(/\/+$/, ""); // fjern trailing slash

  const onOverview = p === "/overblik";
  const onTraining =
    p === "/traener" ||
    p.startsWith("/traener/noter") ||
    p.startsWith("/traener/mc") ||
    p.startsWith("/traener/flashcards") ||
    p.startsWith("/traener/simulator");
  const onUpload = p.startsWith("/traener/upload");
  const onAccount = p === "/konto" || p.startsWith("/konto/");

  const base = "block rounded-lg px-3 py-2";
  const active = "bg-black text-white";
  const inactive = "text-zinc-700 hover:bg-zinc-50";

  return (
    <nav className="space-y-1 px-2 text-xs">
      <Link
        href="/overblik"
        className={`${base} ${onOverview ? active : inactive}`}
        aria-current={onOverview ? "page" : undefined}
      >
        Overblik
      </Link>

      {/* Samler alle træningssider under én aktiv tilstand */}
      <Link
        href="/traener/noter"
        className={`${base} ${onTraining ? active : inactive}`}
        aria-current={onTraining ? "page" : undefined}
      >
        Noter / træning
      </Link>

      <Link
        href="/traener/upload"
        className={`${base} ${onUpload ? active : inactive}`}
        aria-current={onUpload ? "page" : undefined}
      >
        Upload / ret materiale
      </Link>

      <Link
        href="/konto"
        className={`${base} ${onAccount ? active : inactive}`}
        aria-current={onAccount ? "page" : undefined}
      >
        Konto
      </Link>
    </nav>
  );
}

