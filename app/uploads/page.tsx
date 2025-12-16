// app/uploads/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type FileRow = { name: string; id?: string; publicUrl?: string };

export default function UploadsPage() {
  const supabase = createBrowserClient();
  const bucket = "uploads";

  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const { data, error: listErr } = await supabase.storage
      .from(bucket)
      .list("", { limit: 100, sortBy: { column: "name", order: "asc" } });

    if (listErr) {
      setError(listErr.message);
      return;
    }

    const mapped = (data ?? []).map((f) => {
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(f.name);
      return { name: f.name, publicUrl: pub?.publicUrl };
    });

    setFiles(mapped);
  }, [supabase, bucket]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;

    setBusy(true);
    setError(null);

    try {
      for (const f of Array.from(e.target.files)) {
        const path = `${Date.now()}-${f.name}`;
        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, f, { upsert: false });

        if (upErr) throw upErr;
      }

      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Upload fejlede.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">Uploads</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
        >
          Opdater
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input type="file" multiple onChange={onChange} disabled={busy} />
        {busy ? <span className="text-sm text-zinc-600">Uploader…</span> : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ul className="space-y-1">
        {files.map((f) => (
          <li key={f.name} className="text-sm">
            {f.publicUrl ? (
              <a className="underline" href={f.publicUrl} target="_blank" rel="noreferrer">
                {f.name}
              </a>
            ) : (
              f.name
            )}
          </li>
        ))}
      </ul>

      {!files.length && !error ? (
        <p className="text-sm text-zinc-500">Ingen filer endnu.</p>
      ) : null}
    </div>
  );
}
