// app/traener/_helpers/scope.ts

export type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
};

export type ScopeInfo = {
  activeFolderId: string | null;
  scopeIds: string[];
};

/**
 * Tager enten:
 *  - Next.js ReadonlyURLSearchParams (med .get)
 *  - eller et plain objekt { folder, scope }
 * og udleder aktiv mappe + scope-mapper.
 */
export function parseScopeFromSearchParamsLike(raw: any): ScopeInfo {
  let folderId: string | null = null;
  let scopeRaw = "";

  if (raw) {
    const maybeGet = (raw as any).get;
    if (typeof maybeGet === "function") {
      // URLSearchParams / ReadonlyURLSearchParams
      folderId = maybeGet.call(raw, "folder");
      scopeRaw = maybeGet.call(raw, "scope") ?? "";
    } else {
      // Plain objekt: { folder, scope }
      const folderVal = (raw as any).folder;
      if (typeof folderVal === "string" && folderVal.length > 0) {
        folderId = folderVal;
      }

      const scopeVal = (raw as any).scope;
      if (typeof scopeVal === "string" && scopeVal.length > 0) {
        scopeRaw = scopeVal;
      }
    }
  }

  const scopeIds =
    scopeRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean) ?? [];

  return {
    activeFolderId: folderId,
    scopeIds,
  };
}

/**
 * Finder tekst til "Du træner lige nu på..."-boksene.
 */
export function computeScopeSummary(
  allFolders: FolderRow[],
  scopeIds: string[],
  activeFolderId: string | null
): { selectedNames: string[]; rootName: string | null } {
  const byId = new Map<string, FolderRow>();
  for (const f of allFolders) byId.set(f.id, f);

  const selected: FolderRow[] = [];

  if (scopeIds.length > 0) {
    for (const id of scopeIds) {
      const f = byId.get(id);
      if (f) selected.push(f);
    }
  } else if (activeFolderId) {
    const f = byId.get(activeFolderId);
    if (f) selected.push(f);
  }

  const selectedNames = selected.map((f) => f.name);

  let rootName: string | null = null;
  const first = selected[0];
  if (first) {
    let cur: FolderRow | undefined = first;
    while (cur && cur.parent_id) {
      cur = byId.get(cur.parent_id);
    }
    rootName = cur?.name ?? null;
  }

  return { selectedNames, rootName };
}
