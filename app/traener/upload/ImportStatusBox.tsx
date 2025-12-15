// app/traener/upload/ImportStatusBox.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ImportStatusResponse = {
  ok: boolean;
  folderId: string | null;
  quota: {
    usedThisMonth: number;
    totalAllTime: number;
    limitPerMonth: number | null;
    monthStart: string;
    monthEnd: string;
    resetAt: string;
    plan: string;
  };
  files: {
    total: number;
    hasFile: boolean;
    latest: null | {
      id: string;
      name: string;
      folder_id: string | null;
      updated_at: string | null;
    };
  };
  error?: string;
  details?: string;
};

function formatDa(dt: string | null | undefined) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function pct(used: number, limit: number | null) {
  if (!limit || limit <= 0) return 0;
  const p = Math.round((used / limit) * 100);
  return Math.max(0, Math.min(100, p));
}

export default function ImportStatusBox(props: {
  folderId?: string | null;
  refreshKey?: string | number;
  refreshMs?: number;
  className?: string;
}) {
  const { folderId = null, refreshKey, refreshMs = 15000, className } = props;

  const [data, setData] = useState<ImportStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (folderId) params.set("folder_id", folderId);
    const qs = params.toString();
    return qs ? `/api/import-status?${qs}` : `/api/import-status`;
  }, [folderId]);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = (await r.json()) as ImportStatusResponse;
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;

    const safeLoad = async () => {
      if (!alive) return;
      await load();
    };

    void safeLoad();

    const onRefresh = () => void safeLoad();
    window.addEventListener("notely:import-status-refresh", onRefresh);

    const t = setInterval(() => void safeLoad(), Math.max(5000, refreshMs));

    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("notely:import-status-refresh", onRefresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, refreshKey, refreshMs]);

  const used = data?.quota?.usedThisMonth ?? 0;
  const limit = data?.quota?.limitPerMonth ?? null;
  const progress = pct(used, limit);

  const latestName = data?.files?.latest?.name ?? null;
  const latestAt = data?.files?.latest?.updated_at ?? null;

  return (
    <section
      className={[
        "rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-sm",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Plan: {data?.quota?.plan ? String(data.quota.plan).toUpperCase().slice(0,1) + String(data.quota.plan).slice(1) : "—"}</div>
        </div>
        {loading ? <div className="text-xs text-neutral-500">Opdaterer…</div> : null}
      </div>

      {err ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-medium">Materiale gjort klar denne måned</div>
            <div className="text-sm tabular-nums">
              {used}
              {typeof limit === "number" ? ` / ${limit}` : ""}
            </div>
          </div>

          {typeof limit === "number" ? (
            <div className="mt-2 h-2 w-full rounded-full bg-neutral-100">
              <div className="h-2 rounded-full bg-neutral-900" style={{ width: `${progress}%` }} />
            </div>
          ) : null}

          <div className="mt-1 text-xs text-neutral-500">
            Nulstilles: {formatDa(data?.quota?.resetAt ?? null) || "—"}
          </div>
        </div>

        <div className="rounded-xl bg-neutral-50 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-medium">Filer i alt</div>
            <div className="text-sm tabular-nums">{data?.files?.total ?? 0}</div>
          </div>

          <div className="mt-1 text-xs text-neutral-600">
            {latestName ? (
              <>
                Senest: <span className="font-medium">{latestName}</span>
                {latestAt ? <span className="text-neutral-500"> · {formatDa(latestAt)}</span> : null}
              </>
            ) : (
              "Ingen filer fundet."
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
