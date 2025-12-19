// app/overblik/OverblikClient.tsx
"use client";

type FolderRow = {
  id: string;
  name: string;
  parent_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  archived_at?: string | null;
};

export default function OverblikClient({
  folders,
}: {
  folders: FolderRow[];
}) {
  // folders er her kun hvis du vil vise et lille summary i indholdet.
  // Selve venstresiden styres af /overblik/layout.tsx.
  const folderCount = Array.isArray(folders) ? folders.length : 0;

  return (
    <div className="px-6 py-8 lg:px-10">
      <div className="max-w-4xl">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Overblik</h1>
        <p className="text-sm text-zinc-600">
          Her kommer grafer, status og “er du klar?”-overblik. (Mapper:{" "}
          {folderCount})
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">Status</div>
            <div className="mt-1 text-sm text-zinc-600">
              Placeholder – vi fylder på i næste step.
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">Næste</div>
            <div className="mt-1 text-sm text-zinc-600">
              Placeholder – fx “Seneste aktivitet”, “Svagheder”, osv.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
