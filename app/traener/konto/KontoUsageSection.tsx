"use client";

import { useEffect, useState } from "react";

type FeatureQuota = {
  usedThisMonth?: number | null;
  limitPerMonth?: number | null;
};

type QuotaPayload = {
  ok?: boolean;
  plan?: string;
  import?: FeatureQuota;
  trainer_round?: FeatureQuota;
  mc_generate?: FeatureQuota;
  flashcards_generate?: FeatureQuota;
  error?: string;
};

function formatUsage(feature: FeatureQuota | undefined, fallbackUnlimited = false) {
  if (fallbackUnlimited) return "Ubegrænset";
  const used = typeof feature?.usedThisMonth === "number" ? feature.usedThisMonth : 0;
  const limit = typeof feature?.limitPerMonth === "number" ? feature.limitPerMonth : null;
  return limit == null ? "Ubegrænset" : `${used} / ${limit}`;
}

function normalizeQuotaError(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "").trim().toLowerCase();
  if (!msg) return "Forbrug opdateres snart.";
  if (msg.includes("unauthorized") || msg.includes("login")) return "Forbrug opdateres snart.";
  return "Forbrug opdateres snart.";
}

export default function KontoUsageSection({
  plan,
}: {
  plan: "freemium" | "basis" | "pro";
}) {
  const [data, setData] = useState<QuotaPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const res = await fetch("/api/quota/current", { method: "GET", cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as QuotaPayload;
        if (!res.ok || json?.ok === false) {
          throw new Error(String(json?.error ?? `quota/current ${res.status}`));
        }
        if (!active) return;
        setData(json);
      } catch (err: any) {
        if (!active) return;
        setError(normalizeQuotaError(err));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const isPaid = plan === "basis" || plan === "pro";
  const rows = [
    { label: "Upload", value: formatUsage(data?.import, false) },
    { label: "Træner", value: formatUsage(data?.trainer_round, isPaid) },
    { label: "Multiple Choice", value: formatUsage(data?.mc_generate, isPaid) },
    { label: "Flashcards", value: formatUsage(data?.flashcards_generate, isPaid) },
  ];

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Forbrug denne måned</h2>
      </div>

      {loading ? <p className="text-sm text-zinc-600">Henter forbrug...</p> : null}
      {error ? <p className="text-sm text-zinc-600">{error}</p> : null}

      {!loading && !error ? (
        <dl className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-3 last:border-b-0 last:pb-0">
              <dt className="text-sm text-zinc-600">{row.label}</dt>
              <dd className="text-sm font-medium text-zinc-900">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
