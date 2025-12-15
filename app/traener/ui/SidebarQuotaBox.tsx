"use client";

import { useEffect, useState } from "react";

type FeatureQuota = {
  usedThisMonth: number;
  limitPerMonth: number | null;
};

type ApiResponse = {
  ok: boolean;
  plan?: string;
  import?: FeatureQuota;
  evaluate?: FeatureQuota;
  error?: string;
};

function formatLine(label: string, fq?: FeatureQuota) {
  if (!fq) return `${label}: ingen data`;
  const used = fq.usedThisMonth ?? 0;
  const limit = fq.limitPerMonth;
  if (typeof limit === "number" && limit > 0) {
    return `${label}: ${used} af ${limit} denne måned`;
  }
  return `${label}: ${used} denne måned`;
}

export default function SidebarQuotaBox() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/quota/current");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiResponse;

        if (!cancelled) {
          setData(json);
          if (!json.ok) {
            setError(json.error ?? "Kunne ikke hente forbrug.");
          } else {
            setError(null);
          }
        }
      } catch (e) {
        console.error("SidebarQuotaBox fetch error:", e);
        if (!cancelled) {
          setError("Kunne ikke hente forbrug endnu.");
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Simple loading-state
  if (!data && !error) {
    return (
      <div className="mt-3 border-t border-zinc-200 pt-3 text-[11px] text-zinc-500">
        Henter månedligt forbrug …
      </div>
    );
  }

  if (error || !data?.ok) {
    return (
      <div className="mt-3 border-t border-zinc-200 pt-3 text-[11px] text-red-600">
        {error ?? "Kunne ikke hente forbrug."}
      </div>
    );
  }

  const planLabel =
    data.plan === "pro"
      ? "Pro"
      : data.plan === "basis" || data.plan === "basic"
      ? "Basis"
      : data.plan === "freemium"
      ? "Freemium"
      : data.plan ?? "";

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3 text-[11px] text-zinc-600">
      <div className="mb-1 text-[12px] font-semibold text-zinc-800">
        Månedligt forbrug{planLabel ? ` (${planLabel})` : ""}
      </div>
      <p>{formatLine("Upload / ret materiale", data.import)}</p>
      <p>{formatLine("Træner-evalueringer", data.evaluate)}</p>
    </div>
  );
}
