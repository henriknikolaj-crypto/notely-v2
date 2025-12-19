// app/traener/upload/FoldersManager.tsx
"use client";

import { useState } from "react";

type Folder = {
  id: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
};

type Props = {
  folders: Folder[];
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10); // YYYY-MM-DD
}

function formatPeriod(f: Folder): string {
  const start = formatDate(f.start_date);
  const end = formatDate(f.end_date);

  if (!start && !end) return "Ingen periode angivet";
  if (start && !end) return `Fra ${start}`;
  if (!start && end) return `Til ${end}`;
  return `${start} → ${end}`;
}

export default function FoldersManager({ folders }: Props) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // --- Opret ny mappe ---

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError("Skriv et navn til mappen.");
      setCreating(false);
      return;
    }

    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          start_date: start || null,
          end_date: end || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null as unknown);
        throw new Error(
          (data && (data.error as string)) ||
            `Kunne ikke oprette mappe (status ${res.status}).`
        );
      }

      // Simpelt: reload siden, så både venstrekolonne og dropdowns får den nye mappe
      window.location.reload();
    } catch (err: any) {
      console.error("handleCreate error", err);
      setCreateError(
        err?.message ?? "Kunne ikke oprette mappe (ukendt fejl)."
      );
    } finally {
      setCreating(false);
    }
  }

  // --- Redigér eksisterende mappe ---

  function startEdit(folder: Folder) {
    setEditingId(folder.id);
    setEditName(folder.name);
    setEditStart(formatDate(folder.start_date));
    setEditEnd(formatDate(folder.end_date));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditStart("");
    setEditEnd("");
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError("Navnet må ikke være tomt.");
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(editingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          start_date: editStart || null,
          end_date: editEnd || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null as unknown);
        throw new Error(
          (data && (data.error as string)) ||
            `Kunne ikke gemme ændringer (status ${res.status}).`
        );
      }

      window.location.reload();
    } catch (err: any) {
      console.error("handleSaveEdit error", err);
      setEditError(
        err?.message ?? "Kunne ikke gemme ændringer (ukendt fejl)."
      );
    } finally {
      setSavingEdit(false);
    }
  }

  // --- Slet (arkivér) mappe ---

  async function handleDelete(id: string) {
    if (!window.confirm("Er du sikker på, at du vil slette denne mappe?")) {
      return;
    }

    setDeletingId(id);
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null as unknown);
        throw new Error(
          (data && (data.error as string)) ||
            `Kunne ikke slette mappe (status ${res.status}).`
        );
      }

      window.location.reload();
    } catch (err: any) {
      console.error("handleDelete error", err);
      alert(err?.message ?? "Kunne ikke slette mappen (ukendt fejl).");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-semibold">Mapper og perioder</h2>
        <p className="mt-1 text-xs text-zinc-600">
          Her kan du oprette og redigere fag/mapper samt tilknytte start- og
          slutdato. Perioder kan senere bruges til planlægning og overblik.
        </p>
      </div>

      {/* Opret ny mappe */}
      <form onSubmit={handleCreate} className="mb-6 space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-800">
            Ny mappe / fag
          </label>
          <input
            type="text"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            placeholder="Fx Eksamen 2025"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-800">
              Startdato (valgfri)
            </label>
            <input
              type="date"
              className="rounded-xl border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-800">
              Slutdato (valgfri)
            </label>
            <input
              type="date"
              className="rounded-xl border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={creating}
            className="rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {creating ? "Opretter…" : "Opret mappe"}
          </button>
          {createError && (
            <p className="text-[11px] font-medium text-red-600">
              {createError}
            </p>
          )}
        </div>
      </form>

      {/* Eksisterende mapper */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-800">
          Eksisterende mapper
        </div>

        {folders.length === 0 ? (
          <p className="text-[11px] text-zinc-500">
            Du har endnu ikke oprettet nogen mapper.
          </p>
        ) : (
          <ul className="space-y-2 text-xs">
            {folders.map((f) => {
              const isEditing = editingId === f.id;

              if (isEditing) {
                return (
                  <li
                    key={f.id}
                    className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                  >
                    <form
                      onSubmit={handleSaveEdit}
                      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          className="w-full rounded-xl border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />

                        <div className="mt-1 flex flex-wrap gap-2">
                          <input
                            type="date"
                            className="rounded-xl border border-zinc-300 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-black"
                            value={editStart}
                            onChange={(e) => setEditStart(e.target.value)}
                          />
                          <input
                            type="date"
                            className="rounded-xl border border-zinc-300 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-black"
                            value={editEnd}
                            onChange={(e) => setEditEnd(e.target.value)}
                          />
                        </div>
                        {editError && (
                          <p className="mt-1 text-[11px] text-red-600">
                            {editError}
                          </p>
                        )}
                      </div>

                      <div className="mt-2 flex gap-2 sm:mt-0">
                        <button
                          type="submit"
                          disabled={savingEdit}
                          className="rounded-full bg-black px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                        >
                          {savingEdit ? "Gemmer…" : "Gem"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-full border border-zinc-300 px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Annuller
                        </button>
                      </div>
                    </form>
                  </li>
                );
              }

              return (
                <li
                  key={f.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-800">
                      {f.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {formatPeriod(f)}
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(f)}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      Rediger
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(f.id)}
                      disabled={deletingId === f.id}
                      className="rounded-full border border-red-200 px-3 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      {deletingId === f.id ? "Sletter…" : "Slet"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
