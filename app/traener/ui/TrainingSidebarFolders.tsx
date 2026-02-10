"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  start_date?: string | null;
  end_date?: string | null;
  archived_at?: string | null;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function parseScope(raw: string | null) {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildUrl(pathname: string, sp: URLSearchParams, patch: Record<string, string | null | undefined>) {
  const params = new URLSearchParams(sp.toString());

  for (const [k, v] of Object.entries(patch)) {
    const vv = String(v ?? "").trim();
    if (!vv) params.delete(k);
    else params.set(k, vv);
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function TrainingSidebarFolders({ folders }: { folders: FolderRow[] }) {
  const pathname = usePathname() || "/traener";
  const sp = useSearchParams();
  const router = useRouter();

  const activeFolderId = sp?.get("folder") || "";

  // ✅ ESLint-friendly deps (ingen join("|") i deps)
  const scopeRaw = sp?.get("scope") ?? "";
  const scopeIds = useMemo(() => parseScope(scopeRaw ? scopeRaw : null), [scopeRaw]);
  const scopeSet = useMemo(() => new Set(scopeIds), [scopeIds]);

  const { roots, childrenByParent } = useMemo(() => {
    const byParent = new Map<string, FolderRow[]>();
    const root: FolderRow[] = [];

    for (const f of folders ?? []) {
      if (f.archived_at) continue;
      if (!f.parent_id) root.push(f);
      else {
        const arr = byParent.get(f.parent_id) ?? [];
        arr.push(f);
        byParent.set(f.parent_id, arr);
      }
    }

    const sortByName = (a: FolderRow, b: FolderRow) => String(a.name).localeCompare(String(b.name), "da");
    root.sort(sortByName);
    for (const [k, arr] of byParent.entries()) {
      arr.sort(sortByName);
      byParent.set(k, arr);
    }

    return { roots: root, childrenByParent: byParent };
  }, [folders]);

  function toggleScope(folderId: string) {
    const next = new Set(scopeSet);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);

    const nextScope = Array.from(next.values()).join(",");

    const url = buildUrl(pathname, new URLSearchParams(sp?.toString() ?? ""), {
      scope: nextScope || null,
    });

    router.push(url, { scroll: false });
  }

  function folderHref(folderId: string) {
    return buildUrl(pathname, new URLSearchParams(sp?.toString() ?? ""), { folder: folderId });
  }

  const baseRow = "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs";
  const nameCls = (isActive: boolean) =>
    cn("truncate", isActive ? "font-semibold text-zinc-900" : "text-zinc-800");

  const totalSelected = scopeIds.length;

  return (
    <div className="space-y-1 px-2">
      {roots.map((f) => {
        const isActive = activeFolderId === f.id;
        const checked = scopeSet.has(f.id);
        const kids = childrenByParent.get(f.id) ?? [];

        return (
          <div key={f.id} className="space-y-1">
            <div className={cn(baseRow, isActive ? "bg-zinc-50" : "hover:bg-zinc-50")}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-black"
                checked={checked}
                onChange={() => toggleScope(f.id)}
                aria-label={`Vælg ${f.name}`}
              />
              <Link href={folderHref(f.id)} scroll={false} className={nameCls(isActive)}>
                {f.name}
              </Link>
            </div>

            {kids.length ? (
              <div className="space-y-1 pl-5">
                {kids.map((c) => {
                  const isActiveChild = activeFolderId === c.id;
                  const checkedChild = scopeSet.has(c.id);

                  return (
                    <div key={c.id} className={cn(baseRow, isActiveChild ? "bg-zinc-50" : "hover:bg-zinc-50")}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-black"
                        checked={checkedChild}
                        onChange={() => toggleScope(c.id)}
                        aria-label={`Vælg ${c.name}`}
                      />
                      <Link href={folderHref(c.id)} scroll={false} className={nameCls(isActiveChild)}>
                        {c.name}
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="pt-2 text-[11px] text-zinc-500">
        Valgt til træning: {totalSelected} {totalSelected === 1 ? "mappe" : "mapper"}.
      </div>
    </div>
  );
}
