"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function OverviewSidebarFolders({
  folders,
}: {
  folders: FolderRow[];
}) {
  const sp = useSearchParams();
  const activeId = sp.get("folder") || "";

  const roots = folders.filter((f) => !f.parent_id);
  const byParent = new Map<string, FolderRow[]>();

  for (const f of folders) {
    if (!f.parent_id) continue;
    if (!byParent.has(f.parent_id)) byParent.set(f.parent_id, []);
    byParent.get(f.parent_id)!.push(f);
  }

  // sortér alfabetisk indenfor hver gruppe
  roots.sort((a, b) => a.name.localeCompare(b.name, "da"));
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "da"));
  }

  return (
    <div className="px-2 pb-2 pt-1 text-sm">
      {roots.map((root) => {
        const children = byParent.get(root.id) ?? [];
        const isActiveRoot = activeId === root.id;

        return (
          <div key={root.id} className="mb-2 last:mb-0">
            <Link
              href={
                activeId === root.id
                  ? "/overblik"
                  : `/overblik?folder=${encodeURIComponent(root.id)}`
              }
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-zinc-50",
                isActiveRoot && "bg-zinc-100"
              )}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" />
              <span className="truncate">{root.name}</span>
            </Link>

            {children.length > 0 && (
              <ul className="mt-1 space-y-1 pl-5 text-xs text-zinc-600">
                {children.map((ch) => {
                  const isActiveChild = activeId === ch.id;
                  return (
                    <li key={ch.id}>
                      <Link
                        href={
                          isActiveChild
                            ? "/overblik"
                            : `/overblik?folder=${encodeURIComponent(ch.id)}`
                        }
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1 hover:bg-zinc-50",
                          isActiveChild && "bg-zinc-100"
                        )}
                      >
                        <span className="inline-block h-[6px] w-[6px] rounded-full bg-zinc-300" />
                        <span className="truncate">{ch.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      {!folders.length && (
        <p className="px-2 py-1 text-xs text-zinc-500">
          Ingen fag endnu – opret en mappe i Træner.
        </p>
      )}
    </div>
  );
}
