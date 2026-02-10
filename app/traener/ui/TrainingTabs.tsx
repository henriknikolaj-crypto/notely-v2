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
    href: "/traener/simulator", // Skrift i v1
    pro: true,
    activePrefixes: ["/traener/simulator", "/traener/mundtlig"],
  },
];

export default function TrainingTabs() {
  const pathname = (usePathname() || "").replace(/\/+$/, "");
  const sp = useSearchParams();

  // Skjul tabs på upload + historik-sider
  const hideTabs =
    !pathname ||
    pathname.startsWith("/traener/upload") ||
    pathname.includes("/historik");

  if (hideTabs) return null;

  const baseParams = new URLSearchParams(sp.toString());
  const qs = baseParams.toString();
  const withQs = (href: string) => (qs ? `${href}?${qs}` : href);

  return (
    <div className="mb-4 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden px-3 py-2">
        {TABS.map((tab) => {
          const isActive = tab.activePrefixes?.length
            ? tab.activePrefixes.some((pre) => pathname === pre || pathname.startsWith(pre + "/") || pathname.startsWith(pre))
            : pathname === tab.href;

          return (
            <Link
              key={tab.href}
              href={withQs(tab.href)}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-2 text-sm border",
                isActive
                  ? "border-black bg-black text-white"
                  : "border-zinc-300 bg-white text-black hover:bg-zinc-50"
              )}
            >
              {tab.label}
              {tab.pro && (
                <span
                  className={cn(
                    "ml-2 rounded border px-1 py-[1px] text-[11px]",
                    isActive ? "border-white/60 text-white/90" : "border-zinc-300 text-zinc-700"
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
