// app/traener/ui/SidebarQuotaBox.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type FeatureQuota = {
  usedThisMonth: number;
  limitPerMonth: number | null; // null => ubegrænset
};

type ApiResponse = {
  ok: boolean;
  plan?: string;

  import?: FeatureQuota;
  trainer_round?: FeatureQuota;
  mc_generate?: FeatureQuota;
  flashcards_generate?: FeatureQuota;

  error?: string;
};

function asQuota(used?: number | null, limit?: number | null): FeatureQuota {
  return {
    usedThisMonth: typeof used === "number" ? used : 0,
    limitPerMonth: typeof limit === "number" ? limit : null,
  };
}

function formatLine(label: string, fq?: FeatureQuota) {
  if (!fq) return `${label}: ingen data`;

  const usedRaw = fq.usedThisMonth ?? 0;
  const limit = fq.limitPerMonth;

  const used = typeof limit === "number" && limit > 0 ? Math.min(usedRaw, limit) : usedRaw;

  if (typeof limit === "number" && limit > 0) return `${label}: ${used} af ${limit} denne måned`;
  return `${label}: ${used} denne måned`;
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

export default function SidebarQuotaBox() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const res = await fetch("/api/quota/current", {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });

      const json = (await res.json().catch(() => null)) as ApiResponse | null;

      if (!res.ok) {
        setData(json);
        setError(json?.error ?? `HTTP ${res.status}`);
        return;
      }

      setData(json);
      if (!json?.ok) setError(json?.error ?? "Kunne ikke hente forbrug.");
      else setError(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("SidebarQuotaBox fetch error:", e);
      setError("Kunne ikke hente forbrug endnu.");
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    const safeLoad = async () => {
      if (cancelled) return;
      await load();
    };

    void safeLoad();

    const onQuotaChanged = () => void safeLoad();
    window.addEventListener("notely-quota-changed", onQuotaChanged);

    const onFocus = () => void safeLoad();
    window.addEventListener("focus", onFocus);

    const onVis = () => {
      if (document.visibilityState === "visible") void safeLoad();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.removeEventListener("notely-quota-changed", onQuotaChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let body: ReactNode = null;

  if (!data && !error) {
    body = <div className="text-[11px] text-zinc-500">Henter månedligt forbrug …</div>;
  } else if (error || !data?.ok) {
    body = <div className="text-[11px] text-red-600">{error ?? "Kunne ikke hente forbrug."}</div>;
  } else {
    const planNorm = normalizePlan(data.plan);
    const isPaid = planNorm === "basis" || planNorm === "pro";

    const planLabel =
      planNorm === "pro" ? "Pro" : planNorm === "basis" ? "Basis" : planNorm === "freemium" ? "Freemium" : data.plan ?? "";

    const importQ = data.import ?? asQuota();
    const trainerRoundQ = data.trainer_round ?? asQuota();
    const mcQ = data.mc_generate ?? asQuota();
    const flashGenQ = data.flashcards_generate ?? asQuota();

    body = (
      <>
        <div className="mb-1 text-[12px] font-semibold text-zinc-800">
          Månedligt forbrug{planLabel ? ` (${planLabel})` : ""}
        </div>

        <p>{formatLine("Upload / ret materiale", importQ)}</p>

        {!isPaid ? (
          <>
            <p>{formatLine("Træner (runder)", trainerRoundQ)}</p>
            <p>{formatLine("Multiple Choice", mcQ)}</p>
            <p>{formatLine("Flashcards (generering)", flashGenQ)}</p>
          </>
        ) : null}
      </>
    );
  }

  return (
    <div id="notely-quota-box" className="mt-3 border-t border-zinc-200 pt-3 text-[11px] text-zinc-600">
      {body}
    </div>
  );
}
