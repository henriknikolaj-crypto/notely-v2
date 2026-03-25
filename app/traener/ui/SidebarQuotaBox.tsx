// app/traener/ui/SidebarQuotaBox.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchQuotaCurrent } from "@/lib/quota/current-client";

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
  notes_summary_generate?: FeatureQuota;
  notes_focus_generate?: FeatureQuota;

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

export default function SidebarQuotaBox({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  async function load(force = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const json = (await fetchQuotaCurrent({ force })) as ApiResponse | null;

      if (!json) {
        setData(null);
        setError(null);
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

    const onQuotaChanged = () => void load(true);
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
    body = <div className="text-[11px] text-zinc-500">{error ?? "Forbrug opdateres snart."}</div>;
  } else {
    const planNorm = normalizePlan(data.plan);
    const isPaid = planNorm === "basis" || planNorm === "pro";
    const isFreemium = planNorm === "freemium";

    const planLabel =
      planNorm === "pro" ? "Pro" : planNorm === "basis" ? "Basis" : planNorm === "freemium" ? "Freemium" : data.plan ?? "";

    const importQ = data.import ?? asQuota();
    const trainerRoundQ = data.trainer_round ?? asQuota();
    const mcQ = data.mc_generate ?? asQuota();
    const flashGenQ = data.flashcards_generate ?? asQuota();
    const summaryNotesQ = data.notes_summary_generate ?? asQuota();
    const focusNotesQ = data.notes_focus_generate ?? asQuota();

    body = (
      <>
        <div className="mb-1 text-[12px] font-semibold text-zinc-800">
          Månedligt forbrug{planLabel ? ` (${planLabel})` : ""}
        </div>

        <p>{formatLine("Upload / ret materiale", importQ)}</p>

        {!isPaid ? (
          <>
            <p>{formatLine("Træner (runder)", trainerRoundQ)}</p>
            <p>{formatLine("Multiple Choice (generering)", mcQ)}</p>
            <p>{formatLine("Flashcards (generering)", flashGenQ)}</p>
            {isFreemium ? <p>{formatLine("Resuméer", summaryNotesQ)}</p> : null}
            {isFreemium ? <p>{formatLine("Fokus-noter", focusNotesQ)}</p> : null}
          </>
        ) : null}
      </>
    );
  }

  return (
    <div
      id="notely-quota-box"
      className={
        compact
          ? "text-[11px] text-zinc-600"
          : "mt-3 border-t border-zinc-200 pt-3 text-[11px] text-zinc-600"
      }
    >
      {body}
    </div>
  );
}
