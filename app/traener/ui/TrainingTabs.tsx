// app/traener/ui/TrainingTabs.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type TabDef = {
  label: string;
  href: string; // fx "/traener/noter"
  pro?: boolean;
};

const TABS: TabDef[] = [
  { label: "Noter", href: "/traener/noter" },
  { label: "Multiple Choice", href: "/traener/mc" },
  { label: "Flashcards", href: "/traener/flashcards" },
  // Træner bruger /traener-siden (PoC)
  { label: "Træner", href: "/traener", pro: true },
  { label: "Simulator", href: "/traener/simulator", pro: true },
];

export default function TrainingTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();

  // Skjul tabs på særlige sider (upload + historik-lister)
  const hideTabs =
    !pathname ||
    pathname.startsWith("/traener/upload") ||
    pathname.startsWith("/traener/evalueringer/historik") ||
    pathname.startsWith("/traener/mc/historik");

  if (hideTabs) return null;

  // Bevar alle query-parametre (folder, scope, osv.)
  const baseParams = new URLSearchParams(sp.toString());

  return (
    <div className="mb-4 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;

          const params = new URLSearchParams(baseParams.toString());
          const qs = params.toString();
          const url = qs ? `${tab.href}?${qs}` : tab.href;

          return (
            <Link
              key={tab.href}
              href={url}
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
                    isActive
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
