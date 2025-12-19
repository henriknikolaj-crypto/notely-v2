"use client";

import { useState } from "react";

export type TrainingFile = {
  id: string;
  name: string;
};

export default function TrainingScopeBoxClient({
  initialFiles,
}: {
  initialFiles: TrainingFile[];
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const toggle = (id: string) =>
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  const selectedIds = Object.keys(checked).filter((id) => checked[id]);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3">
      <div className="mb-2 text-sm font-medium">Træningsområde</div>

      {!initialFiles.length ? (
        <p className="text-sm opacity-60">
          Ingen filer endnu. Upload dine filer og vælg en mappe.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs uppercase tracking-wide opacity-50">
            Vælg de filer du vil træne på
          </p>
          <ul className="space-y-1">
            {initialFiles.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <input
                  id={`scope-${f.id}`}
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!checked[f.id]}
                  onChange={() => toggle(f.id)}
                />
                <label htmlFor={`scope-${f.id}`} className="truncate">
                  {f.name || f.id}
                </label>
              </li>
            ))}
          </ul>
          {selectedIds.length > 0 && (
            <p className="mt-2 text-xs opacity-60">
              Valgt: {selectedIds.length} fil(er)
            </p>
          )}
        </>
      )}
    </div>
  );
}
