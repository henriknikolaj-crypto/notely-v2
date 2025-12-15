// app/traener/ui/FolderModal.tsx
"use client";

import { useEffect, useState } from "react";

type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  start_date: string | null;
  end_date: string | null;
  archived_at?: string | null;
};

export default function FolderModal(props: {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  folder?: Folder | null;
  parentId?: string | null; // ved "create" undermappe
  roots: Folder[]; // kandidater til parent (root)
}) {
  const isEdit = props.mode === "edit";

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | "">(props.parentId || "");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Åbn/reset
  useEffect(() => {
    if (!props.open) return;
    setErr(null);

    if (isEdit && props.folder) {
      setName(props.folder.name || "");
      setParentId(props.folder.parent_id || "");
      setStartDate(props.folder.start_date || "");
      setEndDate(props.folder.end_date || "");
    } else {
      setName("");
      setParentId(props.parentId || "");
      setStartDate("");
      setEndDate("");
    }
  }, [props.open, isEdit, props.folder, props.parentId]);

  // Afledt
  const isRoot = parentId === "";

  // Skift parent → ryd datoer hvis den bliver undermappe
  const onChangeParent = (val: string) => {
    setParentId(val);
    if (val !== "") {
      setStartDate("");
      setEndDate("");
    }
  };

  const save = async () => {
    try {
      setErr(null);
      setSaving(true);

      // Valider
      const trimmed = name.trim();
      if (!trimmed) {
        setErr("Navn er påkrævet");
        return;
      }
      if (isEdit && props.folder && parentId === props.folder.id) {
        setErr("En mappe kan ikke være parent for sig selv");
        return;
      }
      if (isRoot && startDate && endDate && startDate > endDate) {
        setErr("Slutdato kan ikke være før startdato");
        return;
      }

      // Payload
      const body = {
        name: trimmed,
        parent_id: parentId || null,
        // datoer sendes kun for root
        start_date: isRoot ? (startDate || null) : null,
        end_date: isRoot ? (endDate || null) : null,
      };

      if (isEdit && props.folder) {
        const res = await fetch(`/api/folders/${props.folder.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error || "Kunne ikke opdatere mappe");
      } else {
        const res = await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error || "Kunne ikke oprette mappe");
      }

      props.onClose(); // parent refresher selv
    } catch (e: any) {
      setErr(e?.message || "Ukendt fejl");
    } finally {
      setSaving(false);
    }
  };

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
        <div className="mb-2 text-sm font-semibold">
          {isEdit ? "Redigér mappe" : "Ny mappe"}
        </div>

        <label className="mt-2 block text-[11px] text-zinc-500">Navn</label>
        <input
          className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Fx Biologi – 1. pensum"
        />

        <label className="mt-3 block text-[11px] text-zinc-500">
          Placering (vælg parent for undermappe)
        </label>
        <select
          className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
          value={parentId}
          onChange={(e) => onChangeParent(e.target.value)}
        >
          <option value="">Hovedmappe</option>
          {props.roots
            .filter((r) => !isEdit || r.id !== props.folder?.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>

        {/* Datoer kun for hovedmapper (skjult helt for undermapper) */}
        {isRoot && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-zinc-500">Startdato</label>
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500">Slutdato</label>
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {err && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
            {err}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={props.onClose}
            className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
          >
            Annullér
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-black disabled:opacity-60"
          >
            {saving ? "Gemmer…" : "Gem"}
          </button>
        </div>
      </div>
    </div>
  );
}
