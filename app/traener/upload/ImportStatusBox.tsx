// app/traener/upload/ImportStatusBox.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  usableFilesTotal?: number;
  failedFilesExcluded?: number;
  latestFile?: { name?: string; uploadedAt?: string | null; updated_at?: string | null } | null;
  latestUsableFile?: { name?: string; uploadedAt?: string | null; updated_at?: string | null } | null;
  activeJob?: {
    status?: string | null;
    stage?: string | null;
  } | null;
  folderReadinessSummary?: {
    ready: number;
    processing: number;
    background?: number;
    failed: number;
  } | null;

  error?: string;
  details?: string;
};

type QuotaCurrentResponse = {
  ok: boolean;
  plan?: string;
  resetAt?: string | null;
  import?: {
    usedThisMonth?: number | null;
    limitPerMonth?: number | null;
  };
  error?: string;
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

function sameImportStatusData(a: ImportStatusResponse | null, b: ImportStatusResponse | null) {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function ImportStatusBox(props: { folderId?: string | null; refreshMs?: number }) {
  const folderId = props.folderId ?? null;
  void props.refreshMs;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ImportStatusResponse | null>(null);
  const [uploadActive, setUploadActive] = useState(false);
  const uploadActiveRef = useRef(false);

  const url = useMemo(() => {
    const qs = folderId ? `folder_id=${encodeURIComponent(folderId)}` : "";
    return qs ? `/api/import-status?${qs}` : `/api/import-status`;
  }, [folderId]);

  useEffect(() => {
    uploadActiveRef.current = uploadActive;
  }, [uploadActive]);

  const setStableErr = useCallback((nextErr: string | null) => {
    setErr((prev) => (prev === nextErr ? prev : nextErr));
  }, []);

  const setStableData = useCallback((nextData: ImportStatusResponse | null) => {
    setData((prev) => (sameImportStatusData(prev, nextData) ? prev : nextData));
  }, []);

  const load = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading === true;
    try {
      if (showLoading) {
        setLoading(true);
      }
      setStableErr(null);

      const [statusRes, quotaRes] = await Promise.all([
        fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
        uploadActiveRef.current
          ? Promise.resolve(null)
          : fetch("/api/quota/current", {
              method: "GET",
              cache: "no-store",
              headers: { Accept: "application/json" },
            }),
      ]);

      const statusJson = (await safeJson(statusRes)) as ImportStatusResponse | null;
      const quotaJson = quotaRes ? ((await safeJson(quotaRes)) as QuotaCurrentResponse | null) : null;

      if (statusRes.status === 401 || statusRes.status === 429 || quotaRes?.status === 401 || quotaRes?.status === 429) {
        setStableErr("Upload-status opdateres lige nu.");
        return;
      }

      if (!statusRes.ok || !statusJson) {
        setStableData(null);
        setStableErr("Upload-status opdateres lige nu.");
        return;
      }

      if (statusJson.ok === false) {
        setStableData(null);
        setStableErr("Upload-status opdateres lige nu.");
        return;
      }

      const merged: ImportStatusResponse =
        quotaRes?.ok && quotaJson?.ok
          ? {
              ...statusJson,
              plan: quotaJson.plan ?? statusJson.plan,
              resetAt: quotaJson.resetAt ?? statusJson.resetAt ?? statusJson.quota?.resetAt ?? null,
              usedThisMonth: n0(quotaJson.import?.usedThisMonth ?? statusJson.usedThisMonth ?? statusJson.quota?.usedThisMonth ?? 0),
              monthlyLimit:
                (quotaJson.import?.limitPerMonth ?? statusJson.monthlyLimit ?? statusJson.quota?.limitPerMonth ?? null) as number | null,
              quota: {
                usedThisMonth: n0(quotaJson.import?.usedThisMonth ?? statusJson.quota?.usedThisMonth ?? 0),
                limitPerMonth:
                  (quotaJson.import?.limitPerMonth ?? statusJson.quota?.limitPerMonth ?? null) as number | null,
                resetAt: quotaJson.resetAt ?? statusJson.quota?.resetAt,
                plan: quotaJson.plan ?? statusJson.quota?.plan,
              },
            }
          : statusJson;

      setStableData(merged);
    } catch (e) {
      console.error("[ImportStatusBox] load error", e);
      setStableErr("Upload-status opdateres lige nu.");
    } finally {
      setLoading((prev) => (showLoading || prev ? false : prev));
    }
  }, [setStableData, setStableErr, url]);

  useEffect(() => {
    void load({ showLoading: true });

    const onRefresh = () => void load();
    const onUploadActivity = (event: Event) => {
      const customEvent = event as CustomEvent<{ active?: boolean }>;
      const nextActive = Boolean(customEvent.detail?.active);
      setUploadActive((prev) => {
        if (prev === nextActive) return prev;
        return nextActive;
      });
      if (!nextActive) {
        void load();
      }
    };
    window.addEventListener("notely:import-status-refresh", onRefresh);
    window.addEventListener("notely-quota-changed", onRefresh);
    window.addEventListener("notely:upload-activity", onUploadActivity as EventListener);

    return () => {
      window.removeEventListener("notely:import-status-refresh", onRefresh);
      window.removeEventListener("notely-quota-changed", onRefresh);
      window.removeEventListener("notely:upload-activity", onUploadActivity as EventListener);
    };
  }, [load]);

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

  const filesTotal = n0(data?.usableFilesTotal ?? data?.filesTotal ?? data?.files?.total ?? 0);
  const failedFilesExcluded = n0(data?.failedFilesExcluded ?? 0);
  const latestName = data?.latestUsableFile?.name ?? data?.latestFile?.name ?? data?.files?.latest?.name ?? null;
  const latestAt =
    data?.latestUsableFile?.uploadedAt ??
    data?.latestUsableFile?.updated_at ??
    data?.latestFile?.uploadedAt ??
    data?.latestFile?.updated_at ??
    data?.files?.latest?.updated_at ??
    null;
  const folderReadinessSummary = data?.folderReadinessSummary ?? null;

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
          <div className="text-sm font-semibold text-zinc-900">Uploadede filer</div>
          <div className="text-sm font-semibold text-zinc-900">{filesTotal}</div>
        </div>

        <div className="mt-1 text-xs text-zinc-600">
          {latestName ? (
            <>
              Senest: {latestName}
              {latestAt ? ` · ${fmtDa(latestAt)}` : ""}
            </>
          ) : null}
        </div>
        {failedFilesExcluded > 0 ? (
          <div className="mt-2 text-[11px] text-zinc-500">Fejlede uploads vises stadig i listen, men tæller ikke med her.</div>
        ) : null}
        {folderReadinessSummary ? (
          <div className="mt-2 text-[11px] text-zinc-500">
            Klar: {folderReadinessSummary.ready} · Behandles: {folderReadinessSummary.processing}
            {typeof folderReadinessSummary.background === "number" ? ` · Forbedres: ${folderReadinessSummary.background}` : ""}
            {" · "}Fejlede: {folderReadinessSummary.failed}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-3 text-xs text-zinc-500">Indlæser…</div> : null}
      {err ? <div className="mt-3 text-xs text-zinc-600">{err}</div> : null}
    </div>
  );
}
