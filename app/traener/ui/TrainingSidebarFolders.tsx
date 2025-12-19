// app/traener/ui/TrainingSidebarFolders.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { ReactElement } from "react";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
};

type Props = {
  folders: FolderRow[];
};

type TreeNode = FolderRow & {
  children: TreeNode[];
};

function buildTree(rows: FolderRow[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  rows.forEach((r) => {
    map.set(r.id, { ...r, children: [] });
  });

  const roots: TreeNode[] = [];

  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

export default function TrainingSidebarFolders({ folders }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const tree = useMemo(() => buildTree(folders), [folders]);

  // Hvilke sider må styre scope? (Noter / Træner / MC / Flashcards)
  const showScopeControls =
    pathname?.startsWith("/traener/noter") ||
    pathname?.startsWith("/traener/mc") ||
    pathname?.startsWith("/traener/flashcards") ||
    pathname === "/traener" ||
    pathname?.startsWith("/traener/traener");

  // Parse scope=…,… fra URL
  const scopeFromUrl = useMemo(() => {
    const raw = searchParams?.get("scope");
    if (!raw) return [] as string[];
    return raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }, [searchParams]);

  const updateScopeInUrl = useCallback(
    (nextScope: string[]) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");

      if (nextScope.length) {
        params.set("scope", nextScope.join(","));
      } else {
        params.delete("scope");
      }

      const qs = params.toString();
      const base = pathname || "/traener";
      const url = qs ? `${base}?${qs}` : base;

      router.push(url, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const toggleInScope = useCallback(
    (id: string) => {
      if (!showScopeControls) return;

      const current = new Set(scopeFromUrl);
      if (current.has(id)) {
        current.delete(id);
      } else {
        current.add(id);
      }
      updateScopeInUrl(Array.from(current));
    },
    [showScopeControls, scopeFromUrl, updateScopeInUrl]
  );

  function renderNode(node: TreeNode, isChild: boolean): ReactElement {
    const checked = scopeFromUrl.includes(node.id);

    return (
      <li key={node.id} className="mb-1">
        <div
          className="flex items-center gap-2 text-xs text-zinc-800"
          style={{ paddingLeft: isChild ? 16 : 0 }}
        >
          {showScopeControls && (
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border border-zinc-400 bg-white accent-zinc-800"
              checked={checked}
              onChange={() => toggleInScope(node.id)}
            />
          )}

          <span className="truncate">{node.name}</span>
        </div>

        {node.children.length > 0 && (
          <ul className="mt-0.5 list-none pl-0">
            {node.children.map((child) => renderNode(child, true))}
          </ul>
        )}
      </li>
    );
  }

  const selectedCount = scopeFromUrl.length;
  const label =
    selectedCount === 1
      ? "1 mappe"
      : `${selectedCount} mapper`;

  return (
    <div className="mt-4 text-xs text-zinc-800">
      <p className="mb-2 font-semibold">Dine fag</p>

      <ul className="mb-2 list-none pl-0">
        {tree.map((node) => renderNode(node, false))}
      </ul>

      {showScopeControls ? (
        <p className="mt-2 text-[11px] text-zinc-500">
          Valgt til træning: <span className="font-medium">{label}</span>.
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-zinc-500">
          Mappevalg til træning kan ændres under{" "}
          <span className="font-medium">Træner</span>.
        </p>
      )}
    </div>
  );
}
