// app/traener/upload/FolderManagerClient.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Folder = {
  id: string;
  name: string;
  parent_id?: string | null;
  archived_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type Props = {
  ownerId: string;
  initialFolders: Folder[];
};

type EditState =
  | { mode: "none" }
  | { mode: "edit"; id: string; name: string; start: string; end: string };

export default function FolderManagerClient({
  ownerId,
  initialFolders,
}: Props) {
  const router = useRouter();

  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  const [edit, setEdit] = useState<EditState>({ mode: "none" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function toInputDate(iso: string | null | undefined): string {
    if (!iso) return "";
    return iso.slice(0, 10);
  }

  function formatPeriod(f: Folder): string {
    const s = f.start_date ? f.start_date.slice(0, 10) : null;
    const e = f.end_date ? f.end_date.slice(0, 10) : null;
    if (!s && !e) return "Ingen periode angivet";
    if (s && !e) return `${s} —`;
    if (!s && e) return `— ${e}`;
    return `${s} — ${e}`;
  }

  // --- Opret mappe ---
  async function handleCreate() {
    if (!newName.trim()) {
      setCreateError("Skriv et navn til mappen.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId,
          name: newName.trim(),
          start_date: newStart || null,
          end_date: newEnd || null,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Bad status: ${res.status} ${txt}`);
      }

      const data = (await res.json()) as { folder: Folder };

      setFolders((prev) => [...prev, data.folder]);
      setNewName("");
      setNewStart("");
      setNewEnd("");

      // opdater venstre kolonne + dropdowns
      router.refresh();
    } catch (err) {
      console.error("create folder error", err);
      setCreateError("Kunne ikke oprette mappen (lokal fejl).");
    } finally {
      setCreating(false);
    }
  }

  // --- Redigér mappe ---
  function beginEdit(f: Folder) {
    setEdit({
      mode: "edit",
      id: f.id,
      name: f.name,
      start: toInputDate(f.start_date),
      end: toInputDate(f.end_date),
    });
    setEditError(null);
  }

  function cancelEdit() {
    setEdit({ mode: "none" });
    setEditError(null);
  }

  async function saveEdit() {
    if (edit.mode !== "edit") return;
    if (!edit.name.trim()) {
      setEditError("Navn må ikke være tomt.");
      return;
    }
    setSavingEdit(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/folders/${edit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: edit.name.trim(),
          start_date: edit.start || null,
          end_date: edit.end || null,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Bad status: ${res.status} ${txt}`);
      }

      const data = (await res.json()) as { folder: Folder };

      setFolders((prev) =>
        prev.map((f) => (f.id === data.folder.id ? data.folder : f)),
      );
      setEdit({ mode: "none" });

      // opdater venstre kolonne + dropdowns
      router.refresh();
    } catch (err) {
      console.error("edit folder error", err);
      setEditError("Kunne ikke gemme ændringerne (lokal fejl).");
    } finally {
      setSavingEdit(false);
    }
  }

  // --- Slet mappe ---
  async function handleDelete(id: string) {
    if (!window.confirm("Er du sikker på, at du vil slette denne mappe?")) {
      return;
    }
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/folders/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Bad status: ${res.status} ${txt}`);
      }
      setFolders((prev) => prev.filter((f) => f.id !== id));

      // opdater venstre kolonne + dropdowns
      router.refresh();
    } catch (err) {
      console.error("delete folder error", err);
      setDeleteError("Kunne ikke slette mappen (lokal fejl).");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-900">Mapper og perioder</h2>
      <p className="mt-1 text-xs text-zinc-600">
        Her kan du oprette og redigere fag/mapper samt tilknytte start- og
        slutdato. Perioder kan senere bruges til planlægning og overblik.
      </p>

      {/* Ny mappe */}
      <div className="mt-4 space-y-2 rounded-2xl bg-zinc-50 p-3">
        <label className="block text-[12px] font-medium text-zinc-800">
          Ny mappe / fag
        </label>
        <input
          type="text"
          className="w-full rounded-xl border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
          placeholder="Fx Eksamens 2025"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />

        <div className="mt-2 flex flex-col gap-2 text-[12px] text-zinc-700 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1">
            <span>Startdato (valgfri)</span>
            <input
              type="date"
              className="rounded-xl border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <span>Slutdato (valgfri)</span>
            <input
              type="date"
              className="rounded-xl border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </div>
        </div>

        {createError && (
          <p className="mt-1 text-[11px] text-red-600">{createError}</p>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {creating ? "Opretter …" : "Opret mappe"}
          </button>
        </div>
      </div>

      {/* Eksisterende mapper */}
      <div className="mt-5">
        <div className="mb-2 text-[12px] font-semibold text-zinc-800">
          Eksisterende mapper
        </div>

        {folders.length === 0 ? (
          <p className="text-[12px] text-zinc-600">
            Du har endnu ingen mapper. Opret den første ovenfor.
          </p>
        ) : (
          <ul className="space-y-2 text-[12px]">
            {folders.map((f) => {
              const isEditing = edit.mode === "edit" && edit.id === f.id;

              if (isEditing) {
                return (
                  <li
                    key={f.id}
                    className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-zinc-50 p-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex-1 space-y-1">
                      <input
                        type="text"
                        className="w-full rounded-xl border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
                        value={edit.name}
                        onChange={(e) =>
                          setEdit((prev) =>
                            prev.mode === "edit"
                              ? { ...prev, name: e.target.value }
                              : prev,
                          )
                        }
                      />
                      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                        <div className="flex flex-1 flex-col gap-1">
                          <span>Startdato</span>
                          <input
                            type="date"
                            className="rounded-xl border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
                            value={edit.start}
                            onChange={(e) =>
                              setEdit((prev) =>
                                prev.mode === "edit"
                                  ? { ...prev, start: e.target.value }
                                  : prev,
                              )
                            }
                          />
                        </div>
                        <div className="flex flex-1 flex-col gap-1">
                          <span>Slutdato</span>
                          <input
                            type="date"
                            className="rounded-xl border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
                            value={edit.end}
                            onChange={(e) =>
                              setEdit((prev) =>
                                prev.mode === "edit"
                                  ? { ...prev, end: e.target.value }
                                  : prev,
                              )
                            }
                          />
                        </div>
                      </div>
                      {editError && (
                        <p className="mt-1 text-[11px] text-red-600">
                          {editError}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex gap-2 sm:mt-0 sm:ml-4">
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={savingEdit}
                        className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                      >
                        {savingEdit ? "Gemmer …" : "Gem"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-[11px] font-medium text-zinc-700"
                      >
                        Annuller
                      </button>
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={f.id}
                  className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-zinc-900">
                      {f.name}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-600">
                      {formatPeriod(f)}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2 sm:mt-0 sm:ml-4">
                    <button
                      type="button"
                      onClick={() => beginEdit(f)}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-[11px] font-medium text-zinc-700"
                    >
                      Rediger
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(f.id)}
                      disabled={deletingId === f.id}
                      className="rounded-full border border-red-200 px-3 py-1 text-[11px] font-medium text-red-600 disabled:opacity-40"
                    >
                      {deletingId === f.id ? "Sletter …" : "Slet"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {deleteError && (
          <p className="mt-2 text-[11px] text-red-600">{deleteError}</p>
        )}
      </div>
    </section>
  );
}
