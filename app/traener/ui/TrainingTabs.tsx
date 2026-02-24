"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type TabDef = {
  label: string;
  href: string;
  pro?: boolean;
  activePrefixes?: string[];
};

const TABS: TabDef[] = [
  { label: "Noter", href: "/traener/noter", activePrefixes: ["/traener/noter"] },
  { label: "Multiple Choice", href: "/traener/mc", activePrefixes: ["/traener/mc"] },
  { label: "Flashcards", href: "/traener/flashcards", activePrefixes: ["/traener/flashcards"] },
  { label: "Træner", href: "/traener" },

  // Eksamen samler Skrift + Mundtlig
  {
    label: "Eksamen",
    href: "/exam",
    pro: true,
    activePrefixes: ["/exam", "/traener/simulator", "/traener/mundtlig"],
  },
];

export default function TrainingTabs({ isPro = false }: { isPro?: boolean }) {
  const pathname = (usePathname() || "").replace(/\/+$/, "");
  const sp = useSearchParams();

  // Skjul tabs på upload + historik-sider
  const hideTabs =
    !pathname ||
    pathname === "/traener/overblik" ||
    pathname.startsWith("/traener/mappe/") ||
    pathname.startsWith("/traener/upload") ||
    pathname.includes("/historik");

  if (hideTabs) return null;

  const baseParams = new URLSearchParams(sp.toString());
  const qs = baseParams.toString();
  const withQs = (href: string) => (qs ? `${href}?${qs}` : href);

  // ✅ Vis alle tabs (inkl. Pro). Pro-tabs styles som locked hvis !isPro
  const visibleTabs = TABS;

  return (
    <div className="mb-4 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden px-3 py-2">
        {visibleTabs.map((tab) => {
          const isActive = tab.activePrefixes?.length
            ? tab.activePrefixes.some(
                (pre) =>
                  pathname === pre ||
                  pathname.startsWith(pre + "/") ||
                  pathname.startsWith(pre)
              )
            : pathname === tab.href;

          const locked = !!tab.pro && !isPro;

          return (
            <Link
              key={tab.href}
              href={withQs(tab.href)} // ✅ stadig klikbar -> paywall/disabled inde på siden
              title={locked ? "Kræver Pro" : undefined}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-2 text-sm border inline-flex items-center",
                isActive
                  ? locked
                    ? "border-zinc-300 bg-zinc-50 text-zinc-700"
                    : "border-black bg-black text-white"
                  : locked
                    ? "border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-50"
                    : "border-zinc-300 bg-white text-black hover:bg-zinc-50"
              )}
              aria-disabled={locked ? true : undefined}
            >
              {tab.label}

              {tab.pro && (
                <span
                  className={cn(
                    "ml-2 rounded border px-1 py-[1px] text-[11px]",
                    locked
                      ? "border-zinc-200 text-zinc-500"
                      : isActive
                        ? "border-white/60 text-white/90"
                        : "border-zinc-300 text-zinc-700"
                  )}
                >
                  Pro
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
