import "server-only";

import type { NextRequest } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(String(v ?? "").trim());
}

function uniq(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function parseScopeFolderIds(req: NextRequest): {
  rawScopeFolderIds: string[];
  scopeFolderIds: string[];
  scopeRequested: boolean;
  hadInvalidScope: boolean;
} {
  const url = new URL(req.url);
  const arr = url.searchParams.getAll("scopeFolderIds[]");
  const raw = arr.length > 0 ? arr : (url.searchParams.get("scopeFolderIds") ?? "").split(",");
  const rawScopeFolderIds = uniq(raw.map((s) => String(s ?? "").trim()).filter(Boolean));
  const scopeRequested = rawScopeFolderIds.length > 0;

  if (!scopeRequested) {
    return { rawScopeFolderIds, scopeFolderIds: [], scopeRequested: false, hadInvalidScope: false };
  }

  const valid = rawScopeFolderIds.filter(isUuid);
  const hadInvalidScope = valid.length !== rawScopeFolderIds.length;
  const scopeFolderIds = hadInvalidScope ? [] : valid;

  return { rawScopeFolderIds, scopeFolderIds, scopeRequested, hadInvalidScope };
}

export function formatScopeLabel(names: string[]): string | null {
  const clean = names.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];
  return `${clean[0]} +${clean.length - 1}`;
}

export function hasScopeOverlap(sessionScope: unknown, selectedScopeIds: string[]): boolean {
  if (selectedScopeIds.length === 0) return true;
  if (!Array.isArray(sessionScope)) return false;
  const set = new Set(selectedScopeIds.map((x) => String(x ?? "").trim()).filter(Boolean));
  for (const raw of sessionScope) {
    const id = String(raw ?? "").trim();
    if (id && set.has(id)) return true;
  }
  return false;
}
