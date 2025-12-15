"use client";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type FileRow = { name: string; id?: string; publicUrl?: string };

export default function UploadsPage() {
  const supabase = createBrowserClient();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);
  const bucket = "uploads";

  async function refresh() {
    const { data, error } = await supabase.storage.from(bucket).list("", { limit: 100, sortBy: { column: "name", order: "asc" } });
    if (error) return;
    const mapped = (data ?? []).map((f) => {
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(f.name);
      return { name: f.name, publicUrl: pub?.publicUrl };
    });
    setFiles(mapped);
  }

  useEffect(() => { refresh(); }, []);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(e.target.files)) {
        const path = `${Date.now()}-${f.name}`;
        const { error } = await supabase.storage.from(bucket).upload(path, f, { upsert: false });
        if (error) throw error;
      }
      await refresh();
    } finally { setBusy(false); if (e.target) e.target.value = ""; }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Uploads</h1>
      <input type="file" multiple onChange={onChange} disabled={busy} />
      <ul className="space-y-1">
        {files.map((f) => (
          <li key={f.name}>
            {f.publicUrl ? <a className="underline" href={f.publicUrl} target="_blank">{f.name}</a> : f.name}
          </li>
        ))}
      </ul>
    </div>
  );
}


