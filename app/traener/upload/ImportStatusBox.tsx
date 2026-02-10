// app/traener/upload/ImportStatusBox.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LimitNotice from "@/app/traener/_ui/LimitNotice";

type ImportStatusResponse = {
  ok: boolean;

  // optional (nyere API)
  plan?: string;
  usedThisMonth?: number;
  monthlyLimit?: number | null;
  resetAt?: string | null;

  // optional (ældre/nestet)
  folderId?: string | null;
  quota?: {
    usedThisMonth: number;
    limitPerMonth: number | null;
    resetAt?: string;
    plan?: string;
  };

  files?: {
    total: number;
    hasFile: boolean;
    latest: { id: string; name: string; folder_id: string | null; updated_at: string | null } | null;
  };

  // optional (nyere “flat” helpers)
  filesTotal?: number;
  latestFile?: { name?: string; uploadedAt?: string | null; updated_at?: string | null } | null;

  error?: string;
  details?: string;
};

function n0(x: any) {
  const n = typeof x === "number" ? x : Number(x);
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

function prettyPlan(plan: string) {
  const p = (plan || "freemium").toLowerCase();
  if (p === "freemium") return "Freemium";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

async function safeJson(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default function ImportStatusBox(props: { folderId?: string | null; refreshMs?: number }) {
  const folderId = props.folderId ?? null;
  const refreshMs = typeof props.refreshMs === "number" ? props.refreshMs : 10_000;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ImportStatusResponse | null>(null);

  const url = useMemo(() => {
    const qs = folderId ? `folder_id=${encodeURIComponent(folderId)}` : "";
    return qs ? `/api/import-status?${qs}` : `/api/import-status`;
  }, [folderId]);

  const load = useCallback(async () => {
    try {
      setErr(null);

      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const json = (await safeJson(res)) as ImportStatusResponse | null;

      if (!res.ok || !json) {
        setData(null);
        setErr(`Kunne ikke hente status (${res.status}).`);
        return;
      }

      if (json.ok === false) {
        setData(null);
        setErr(String(json.error ?? "Kunne ikke hente status."));
        return;
      }

      setData(json);
    } catch (e) {
      console.error("[ImportStatusBox] load error", e);
      setData(null);
      setErr("Kunne ikke hente status.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    setLoading(true);
    void load();

    const onRefresh = () => void load();
    window.addEventListener("notely:import-status-refresh", onRefresh);

    const t = setInterval(() => void load(), Math.max(5000, refreshMs));

    return () => {
      window.removeEventListener("notely:import-status-refresh", onRefresh);
      clearInterval(t);
    };
  }, [load, refreshMs]);

  // ✅ robust udlæsning (nestet + flat)
  const planRaw = (data?.quota?.plan ?? data?.plan ?? "freemium").toString();
  const used = n0(data?.quota?.usedThisMonth ?? data?.usedThisMonth ?? (data as any)?.used ?? 0);
  const limit =
    (data?.quota?.limitPerMonth ?? data?.monthlyLimit ?? (data as any)?.limit ?? null) as number | null;
  const resetAt = (data?.quota?.resetAt ?? data?.resetAt ?? null) as string | null;

  const hasLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0;
  const remaining = hasLimit ? Math.max(0, (limit as number) - used) : null;

  const atOrOverLimit = hasLimit ? used >= (limit as number) : false;

  const pct = useMemo(() => {
    if (!hasLimit) return 0;
    return Math.min(1, Math.max(0, used / (limit as number)));
  }, [used, limit, hasLimit]);

  const filesTotal = n0(data?.files?.total ?? data?.filesTotal ?? 0);
  const latestName = data?.files?.latest?.name ?? data?.latestFile?.name ?? null;
  const latestAt =
    data?.files?.latest?.updated_at ?? data?.latestFile?.uploadedAt ?? data?.latestFile?.updated_at ?? null;

  // ✅ info-tekst om slet (frigiver ikke sider)
  const showDeleteWarning = true;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-zinc-900">Plan: {prettyPlan(planRaw)}</div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm font-semibold text-zinc-900">Materiale gjort klar denne måned</div>
        <div className="text-sm font-semibold text-zinc-900">
          {hasLimit ? `${used} / ${limit}` : `${used}`}
        </div>
      </div>

      <div className="mt-2 h-2 w-full rounded-full bg-zinc-100">
        <div className="h-2 rounded-full bg-zinc-900" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>

      {/* ✅ tilbage-tæller */}
      {hasLimit ? (
        <div className="mt-2 text-xs text-zinc-600">Tilbage denne måned: {remaining} sider</div>
      ) : null}

      <div className="mt-1 text-xs text-zinc-500">{resetAt ? `Nulstilles: ${fmtDa(resetAt)}` : ""}</div>

      {showDeleteWarning ? (
        <div className="mt-2 text-[11px] text-zinc-500">
          Bemærk: Hvis du sletter en fil, frigiver det ikke sider tilbage i denne måned.
          {planRaw.toLowerCase() === "freemium" ? " Freemium: maks. 10 sider pr. PDF." : ""}
        </div>
      ) : null}

      {atOrOverLimit ? (
        <LimitNotice className="mt-3">
          Grænse nået. Du kan uploade igen efter nulstilling{resetAt ? ` (${fmtDa(resetAt)})` : ""}.
        </LimitNotice>
      ) : null}

      <div className="mt-4 rounded-xl bg-zinc-50 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-900">Filer i alt</div>
          <div className="text-sm font-semibold text-zinc-900">{filesTotal}</div>
        </div>

        <div className="mt-1 text-xs text-zinc-600">
          {latestName ? (
            <>
              Senest: {latestName}
              {latestAt ? ` · ${fmtDa(latestAt)}` : ""}
            </>
          ) : (
            "Ingen filer endnu."
          )}
        </div>
      </div>

      {loading ? <div className="mt-3 text-xs text-zinc-500">Indlæser…</div> : null}
      {err ? <div className="mt-3 text-xs text-red-600">{err}</div> : null}
    </div>
  );
}
