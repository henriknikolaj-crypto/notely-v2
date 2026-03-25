"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type FolderOption = {
  id: string;
  name: string;
};

type Props = {
  selectedNames: string[];
  selectedScopeIds?: string[];
  disabled?: boolean;
  initialFolders?: FolderOption[];
};

function parseJson(text: string) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function buildNextHref(pathname: string, searchParams: URLSearchParams, folderId: string) {
  const next = new URLSearchParams(searchParams.toString());
  next.set("scope", folderId);
  next.delete("folder");
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function toggleScopeHref(pathname: string, searchParams: URLSearchParams, selectedScopeIds: string[], folderId: string) {
  const next = new Set(selectedScopeIds.map((id) => String(id ?? "").trim()).filter(Boolean));
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);

  const params = new URLSearchParams(searchParams.toString());
  const scope = Array.from(next.values()).join(",");
  if (scope) params.set("scope", scope);
  else params.delete("scope");
  params.delete("folder");

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function FeatureScopePicker({
  selectedNames,
  selectedScopeIds = [],
  disabled = false,
  initialFolders,
}: Props) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(() => !Array.isArray(initialFolders));
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderOption[]>(() => (Array.isArray(initialFolders) ? initialFolders : []));

  useEffect(() => {
    if (Array.isArray(initialFolders)) {
      setFolders(initialFolders);
      setLoading(false);
      setError(null);
      return;
    }

    let alive = true;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/folders", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const json = parseJson(await res.text());

        if (!alive) return;

        if (res.status === 401) {
          setFolders([]);
          setError("Mapper kan ikke opdateres i denne browser lige nu.");
          return;
        }

        if (!res.ok || !json?.ok) {
          setFolders([]);
          setError(String(json?.error ?? "Kunne ikke hente mapper."));
          return;
        }

        const nextFolders = Array.isArray(json.folders)
          ? json.folders
              .map((item: any) => {
                const id = String(item?.id ?? "").trim();
                const name = String(item?.name ?? "").trim();
                if (!id || !name) return null;
                return { id, name };
              })
              .filter(Boolean)
          : [];

        setFolders(nextFolders as FolderOption[]);
      } catch {
        if (!alive) return;
        setFolders([]);
        setError("Kunne ikke hente mapper.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const selectedLabel = useMemo(() => {
    const clean = selectedNames.map((name) => String(name ?? "").trim()).filter(Boolean);
    if (clean.length === 0) return null;
    if (clean.length === 1) return clean[0];
    return `${clean[0]} +${clean.length - 1}`;
  }, [selectedNames]);

  const selectedSet = useMemo(() => new Set(selectedScopeIds), [selectedScopeIds]);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-700">
          {selectedLabel
            ? `${selectedScopeIds.length > 1 ? "Valgte mapper" : "Valgt mappe"}: ${selectedLabel}`
            : "Ingen mappe valgt"}
        </span>

        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled || loading || (!!error && folders.length === 0)}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          {selectedLabel ? "Skift mapper" : "Vælg mapper"}
        </button>
      </div>

      {!selectedLabel ? (
        <p className="text-xs text-amber-700">
          Vælg en eller flere mapper her, før du genererer, evaluerer eller starter.
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-zinc-600">{error}</p>
      ) : null}

      {!loading && !error && folders.length === 0 ? (
        <p className="text-xs text-zinc-600">
          Ingen mapper endnu.{" "}
          <Link href="/traener/upload" className="underline underline-offset-2">
            Upload materiale eller opret en mappe
          </Link>
          .
        </p>
      ) : null}

      {open && folders.length > 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="mb-2 text-xs font-medium text-zinc-700">Vælg mapper</div>
          <div className="space-y-2">
            {folders.map((folder) => {
              const active = selectedSet.has(folder.id);
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => {
                    router.push(toggleScopeHref(pathname, new URLSearchParams(searchParams.toString()), selectedScopeIds, folder.id), {
                      scroll: false,
                    });
                  }}
                  className={[
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm",
                    active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
                  ].join(" ")}
                >
                  <span>{folder.name}</span>
                  {active ? <span className="text-xs font-medium">Valgt</span> : <span className="text-xs text-zinc-500">Tilføj</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[11px] text-zinc-500">
              Valgt til træning: {selectedScopeIds.length} {selectedScopeIds.length === 1 ? "mappe" : "mapper"}.
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Færdig
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
