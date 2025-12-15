/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";

type Props = {
  job: {
    id: string;
    status: "queued" | "succeeded" | "failed";
    tokens_used?: number | null;
    latency_ms?: number | null;
    error?: string | null;
  };
  isAdmin?: boolean;
};

export default function JobStatusChip({ job, isAdmin = false }: Props) {
  const [pending, setPending] = useState(false);
  const dev = process.env.NODE_ENV !== "production";

  const canRetry = (dev || isAdmin) && (job.status === "failed" || job.status === "queued");

  async function onRetry() {
    setPending(true);
    try {
      const secret = (process as any).env.NEXT_PUBLIC_IMPORT_SHARED_SECRET ?? "";
      const res = await fetch("/api/dev/retry-job", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shared-secret": secret,
        },
        body: JSON.stringify({ id: job.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      // TODO: refresh view (router.refresh() eller SWR revalidate)
    } catch (e) {
      console.warn("retry failed", e);
      alert("Retry fejlede (se console).");
    } finally {
      setPending(false);
    }
  }

  const color =
    job.status === "succeeded" ? "bg-emerald-600"
    : job.status === "failed"   ? "bg-rose-600"
    : "bg-amber-600";

  return (
    <div className="flex items-center gap-2">
      <span className={`text-white text-xs px-2 py-1 rounded ${color}`}>{job.status}</span>
      <span className="text-xs text-zinc-500">
        {job.tokens_used ?? "-"} tok  {job.latency_ms ?? "-"} ms
      </span>
      {job.status === "failed" && job.error ? (
        <span className="text-xs text-zinc-400 truncate max-w-[280px]" title={job.error}>
          {job.error}
        </span>
      ) : null}
      {canRetry && (
        <button
          onClick={onRetry}
          disabled={pending}
          className="text-xs px-2 py-1 rounded border border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
          title="Dev/admin only"
        >
          {pending ? "Retry..." : "Retry"}
        </button>
      )}
    </div>
  );
}


