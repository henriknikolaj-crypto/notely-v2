"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Status = {
  ok: boolean;

  plan?: string | null;

  usedThisMonth?: number | null;
  monthlyLimit?: number | null;

  // fallback hvis du havde gamle feltnavne
  used?: number | null;
  limit?: number | null;
  month?: { used?: number | null; limit?: number | null } | null;

  resetAt?: string | null;
  resetAtNice?: string | null;

  quotaReached?: boolean | null;

  filesTotal?: number | null;
  latestFile?: { name?: string | null; uploadedAt?: string | null } | null;

  error?: string | null;
};

function n0(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtDa(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function QuotaStatus() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const parseUsedLimit = useCallback((j: Status) => {
    const used =
      j.usedThisMonth ?? j.used ?? j.month?.used ?? 0;

    const limit =
      j.monthlyLimit ?? j.limit ?? j.month?.limit ?? null;

    return { used: n0(used), limit: limit == null ? null : n0(limit) };
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/import-status", { method: "GET", cache: "no-store" });

      const text = await res.text();
      const json: any = (() => {
        try { return text ? JSON.parse(text) : null; } catch { return null; }
      })();

      if (!res.ok || !json) {
        setStatus(null);
        setErr(`Kunne ikke hente status (${res.status}).`);
        return;
      }
      if (json.ok === false) {
        setStatus(json);
        setErr(String(json.error ?? "Kunne ikke hente status."));
        return;
      }

      setStatus(json);
    } catch {
      setStatus(null);
      setErr("Kunne ikke hente status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    const onEvt = () => void load();
    window.addEventListener("notely:import-status-refresh", onEvt);
    window.addEventListener("notely-quota-changed", onEvt);
    return () => {
      clearInterval(t);
      window.removeEventListener("notely:import-status-refresh", onEvt);
      window.removeEventListener("notely-quota-changed", onEvt);
    };
  }, [load]);

  const { used, limit } = useMemo(() => parseUsedLimit(status ?? { ok: false }), [status, parseUsedLimit]);

  const pct = useMemo(() => {
    if (!limit || limit <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
  }, [used, limit]);

  const plan = (status?.plan ?? "Freemium").toString();
  const resetNice = status?.resetAtNice ?? (status?.resetAt ? fmtDa(status.resetAt) : "");

  const quotaReached =
    typeof status?.quotaReached === "boolean"
      ? status!.quotaReached
      : (limit != null && limit > 0 ? used >= limit : false);

  const latestName = status?.latestFile?.name ?? null;
  const latestAt = status?.latestFile?.uploadedAt ?? null;
  const filesTotal = status?.filesTotal ?? 0;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-zinc-900">Plan: {plan}</div>

      <div className="mt-4 text-sm font-semibold text-zinc-900">Materiale gjort klar denne måned</div>

      <div className="mt-1 flex items-center justify-between text-sm text-zinc-700">
        <div />
        <div className="font-medium">
          {limit != null ? `${used} / ${limit}` : `${used}`}
        </div>
      </div>

      <div className="mt-2 h-2 w-full rounded-full bg-zinc-100">
        <div className="h-2 rounded-full bg-zinc-900" style={{ width: `${pct}%` }} />
      </div>

      {resetNice ? <div className="mt-2 text-xs text-zinc-500">Nulstilles: {resetNice}</div> : null}

      {quotaReached ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
          Grænse nået. Du kan uploade igen efter nulstilling ({resetNice || "snart"}).
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-900">Filer i alt</div>
          <div className="text-sm font-semibold text-zinc-900">{n0(filesTotal)}</div>
        </div>
        <div className="mt-1 text-xs text-zinc-600">
          {latestName ? (
            <>Senest: {latestName}{latestAt ? ` · ${fmtDa(latestAt)}` : ""}</>
          ) : (
            <>Ingen filer endnu.</>
          )}
        </div>
      </div>

      {loading ? null : err ? <div className="mt-3 text-xs text-red-600">{err}</div> : null}
    </div>
  );
}
