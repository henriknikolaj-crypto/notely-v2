"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchQuotaCurrent } from "@/lib/quota/current-client";

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
    href: "/traener/simulator",
    pro: true,
    activePrefixes: ["/traener/simulator", "/traener/mundtlig"],
  },
];

function normalizePlan(raw: unknown): "pro" | "basis" | "freemium" | null {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return null;
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  if (p === "pro" || p === "basis" || p === "freemium") return p;
  return null;
}

export default function TrainingTabs({ isPro: _isPro = false }: { isPro?: boolean }) {
  const pathname = (usePathname() || "").replace(/\/+$/, "");
  const sp = useSearchParams();
  const [planFromApi, setPlanFromApi] = useState<"pro" | "basis" | "freemium" | null>(null);

  useEffect(() => {
    let active = true;

    if (typeof window !== "undefined") {
      const cached = normalizePlan(window.sessionStorage.getItem("notely_plan"));
      if (cached && active) setPlanFromApi(cached);
    }

    async function refreshPlan() {
      try {
        const payload = (await fetchQuotaCurrent()) as { ok?: boolean; plan?: unknown } | null;
        const normalized = payload?.ok && typeof payload?.plan === "string"
          ? normalizePlan(payload.plan)
          : null;
        if (normalized) {
          if (active) setPlanFromApi(normalized);
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem("notely_plan", normalized);
          }
        } else {
          if (active) setPlanFromApi(null);
        }
      } catch {
        if (active) setPlanFromApi(null);
      }
    }

    const onFocus = () => {
      void refreshPlan();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshPlan();
      }
    };

    void refreshPlan();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshPlan();
      }
    }, 30_000);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(intervalId);
    };
  }, []);

  const effectiveIsPro = planFromApi ? planFromApi === "pro" : !!_isPro;
  const examActive =
    pathname.startsWith("/traener/simulator") || pathname.startsWith("/traener/mundtlig");
  const examLocked = !effectiveIsPro;

  if (process.env.NODE_ENV !== "production") {
    console.log("[TrainingTabs]", {
      planFromApi,
      effectiveIsPro,
      pathname,
      locked: examLocked,
      isActive: examActive,
    });
  }

  // Skjul tabs på upload + historik-sider
  const hideTabs =
    !pathname ||
    pathname === "/traener/overblik" ||
    pathname.startsWith("/traener/konto") ||
    pathname.startsWith("/traener/mappe/") ||
    pathname.startsWith("/traener/upload") ||
    pathname.includes("/historik");

  if (hideTabs) return null;

  const baseParams = new URLSearchParams(sp.toString());
  const qs = baseParams.toString();
  const withQs = (href: string) => (qs ? `${href}?${qs}` : href);

  // ✅ Vis alle tabs (inkl. Pro). Pro-tabs styles som locked hvis !isPro
  const visibleTabs = TABS;
  const ACTIVE_CLASSES = "border-black bg-black text-white";
  const INACTIVE_CLASSES = "border-zinc-300 bg-white text-black hover:bg-zinc-50";
  const LOCKED_CLASSES = "border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-50";

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

          const locked = !!tab.pro && !effectiveIsPro;
          const tabClasses = locked ? LOCKED_CLASSES : isActive ? ACTIVE_CLASSES : INACTIVE_CLASSES;

          return (
            <Link
              key={tab.href}
              href={withQs(tab.href)} // ✅ stadig klikbar -> paywall/disabled inde på siden
              title={locked ? "Kræver Pro" : undefined}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-2 text-sm border inline-flex items-center",
                tabClasses
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
