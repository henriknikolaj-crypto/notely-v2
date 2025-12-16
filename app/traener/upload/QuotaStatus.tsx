// app/traener/upload/QuotaStatus.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  feature: "import" | "evaluate";
  upgradeHref?: string;
  refreshMs?: number;
};

type QuotaBlock = {
  usedThisMonth: number;
  totalAllTime?: number;
  limitPerMonth: number | null;
};

type QuotaResp = {
  ok: boolean;
  mode?: string;
  plan?: "freemium" | "basis" | "pro" | string;
  monthEnd?: string; // sidste ms i måneden (debug)
  resetAt?: string; // næste måneds start (rigtig nulstilling)
  import?: QuotaBlock;
  evaluate?: QuotaBlock;
  message?: string;
  error?: string;
};

function fmtDaDate(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("da-DK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function QuotaStatus({
  feature,
  upgradeHref = "/pricing",
  refreshMs = 15000,
}: Props) {
  const pathname = usePathname();

  const [data, setData] = useState<QuotaResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setErr(null);

      const res = await fetch("/api/quota-status", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as QuotaResp | null;

      if (!res.ok || !json?.ok) {
        setData(json);
        setErr(
          json?.message ||
            json?.error ||
            `Kunne ikke hente kvote (status ${res.status}).`,
        );
        return;
      }

      setData(json);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Kunne ikke hente kvote (ukendt fejl).";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      if (!alive) return;
      await load();
    };

    void run();

    const intervalMs = Math.max(5000, Number(refreshMs || 0));
    const t =
      intervalMs > 0 ? setInterval(() => void run(), intervalMs) : null;

    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [load, refreshMs, feature]);

  // Upload-siden har allerede ImportStatusBox (kvote + filer + seneste),
  // så vi skjuler import-kortet her for at undgå dobbelt UI.
  const hideOnUploadPage =
    feature === "import" && (pathname ?? "").includes("/traener/upload");

  const planLabel = useMemo(() => {
    const p = (data?.plan ?? "freemium").toLowerCase();
    if (p === "pro") return "Pro";
    if (p === "basis") return "Basis";
    return "Freemium";
  }, [data?.plan]);

  const block = feature === "import" ? data?.import : data?.evaluate;
  const used = Number(block?.usedThisMonth ?? 0);
  const limit = typeof block?.limitPerMonth === "number" ? block.limitPerMonth : null;

  const pct = useMemo(() => {
    if (!limit || limit <= 0) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  }, [used, limit]);

  const title =
    feature === "import"
      ? `Din månedlige upload-kvote (${planLabel})`
      : `Din månedlige evaluering-kvote (${planLabel})`;

  const subtitle =
    feature === "import"
      ? "Gælder materiale der gøres klar til brug i Træner, Noter og Multiple Choice."
      : "Træner-evalueringer (skriftlig feedback). Hver vurdering tæller som én evaluering.";

  const resetLabel =
    data?.resetAt ? fmtDaDate(data.resetAt) : data?.monthEnd ? fmtDaDate(data.monthEnd) : "";

  const metricLabel =
    feature === "import" ? "Materiale gjort klar denne måned" : "Evalueringer denne måned";

  const showUpgrade = (data?.plan ?? "freemium").toLowerCase() !== "pro";

  if (hideOnUploadPage) return null;

  if (loading) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-2 text-xs text-zinc-500">Henter kvote…</div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-1 text-xs text-zinc-600">{subtitle}</p>
          {resetLabel ? (
            <p className="mt-2 text-[11px] text-zinc-500">
              Nulstilles omkring {resetLabel}.
            </p>
          ) : null}
        </div>

        {showUpgrade ? (
          <Link
            href={upgradeHref}
            className="inline-flex items-center rounded-full bg-black px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            Opgrader nu
          </Link>
        ) : null}
      </div>

      {err ? (
        <p className="mt-3 text-xs font-medium text-red-600">{err}</p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between text-xs text-zinc-600">
            <span>{metricLabel}</span>
            {limit ? <span>{used} / {limit}</span> : <span>{used}</span>}
          </div>

          {limit ? (
            <div className="mt-2 h-2 w-full rounded-full bg-zinc-100">
              <div
                className="h-2 rounded-full bg-black"
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}

          {limit && used >= limit ? (
            <p className="mt-3 text-xs font-medium text-red-600">
              Du har nået din {feature === "import" ? "upload" : "evaluering"}-grænse:{" "}
              {used}/{limit} denne måned.
              {resetLabel ? ` Nulstilles omkring ${resetLabel}.` : ""}
            </p>
          ) : null}

          {limit && used < limit ? (
            <p className="mt-2 text-[11px] text-zinc-500">{pct}% brugt</p>
          ) : null}
        </>
      )}
    </section>
  );
}
