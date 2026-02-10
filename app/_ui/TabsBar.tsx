// app/_ui/TabsBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ActiveKey = "noter" | "mc" | "flash" | "traener" | "exam";

function getActiveFromPath(pathname: string): ActiveKey {
  const p = (pathname || "/").replace(/\/+$/, "");
  if (p === "/app/noter" || p.startsWith("/app/noter/")) return "noter";
  if (p === "/app/mc" || p.startsWith("/app/mc/")) return "mc";
  if (p === "/app/flashcards" || p.startsWith("/app/flashcards/")) return "flash";
  if (p === "/app/traener" || p.startsWith("/app/traener/")) return "traener";
  if (p === "/app/simulator" || p.startsWith("/app/simulator/")) return "exam";
  if (p === "/app/mundtlig" || p.startsWith("/app/mundtlig/")) return "exam";
  return "noter";
}

function tabCls(active: boolean) {
  const base =
    "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition";
  const on = "bg-black text-white border-black";
  const off = "bg-white text-zinc-800 border-zinc-200 hover:bg-zinc-50";
  return `${base} ${active ? on : off}`;
}

function ProBadge() {
  return (
    <span className="ml-1 rounded-full border border-zinc-200 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-zinc-700">
      Pro
    </span>
  );
}

export default function TabsBar() {
  const pathname = usePathname() || "/";
  const active = getActiveFromPath(pathname);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const examActive = active === "exam";

  return (
    <div className="flex flex-wrap gap-2">
      <Link className={tabCls(active === "noter")} href="/app/noter">
        Noter
      </Link>
      <Link className={tabCls(active === "mc")} href="/app/mc">
        Multiple Choice
      </Link>
      <Link className={tabCls(active === "flash")} href="/app/flashcards">
        Flashcards
      </Link>
      <Link className={tabCls(active === "traener")} href="/app/traener">
        Træner
      </Link>

      {/* Eksamen dropdown (Skrift/Tale) */}
      <div ref={ref} className="relative">
        <button
          type="button"
          className={tabCls(examActive)}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Eksamen <ProBadge />
          <span className="ml-1 text-xs opacity-80">▾</span>
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-44 rounded-2xl border border-zinc-200 bg-white p-1 text-sm shadow-sm"
          >
            <Link
              role="menuitem"
              className="block rounded-xl px-3 py-2 hover:bg-zinc-50"
              href="/app/simulator"
              onClick={() => setOpen(false)}
            >
              Skrift
            </Link>
            <Link
              role="menuitem"
              className="block rounded-xl px-3 py-2 hover:bg-zinc-50"
              href="/app/mundtlig"
              onClick={() => setOpen(false)}
            >
              Tale
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
