import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { formatScopeLabel, hasScopeOverlap, parseScopeFolderIds } from "../_scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

export async function GET(req: NextRequest) {
  let sb: any;
  let ownerId: string;
  try {
    const auth = await requireUser(req);
    sb = auth.sb;
    ownerId = auth.id;
  } catch {
    return json(401, { ok: false, error: "Unauthorized (mangler login eller dev-bypass)." });
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 5);
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 5));
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw && Number.isFinite(Date.parse(sinceRaw)) ? sinceRaw : null;

  const scope = parseScopeFolderIds(req);
  const scopeFolderIds = scope.scopeFolderIds;
  if (scope.hadInvalidScope && process.env.NODE_ENV !== "production") {
    console.warn("[flashcards/sessions] invalid scope values ignored:", scope.rawScopeFolderIds);
  }

  let q = sb
    .from("flashcard_sessions")
    .select("id,scope_folder_ids,difficulty,requested,returned,created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (since) {
    q = q.gte("created_at", since);
  }

  const { data, error } = await q;

  if (error) {
    return json(500, { ok: false, error: "Kunne ikke hente sessions.", detail: String(error.message ?? error) });
  }

  const allRows = (data ?? []) as Array<{
    id?: string | null;
    scope_folder_ids?: string[] | null;
    difficulty?: string | null;
    requested?: number | null;
    returned?: number | null;
    created_at?: string | null;
  }>;
  const rows = allRows.filter((r) => hasScopeOverlap(r.scope_folder_ids, scopeFolderIds));

  const dedupedMap = new Map<string, (typeof rows)[number]>();
  const withoutId: (typeof rows)[number][] = [];
  for (const row of rows) {
    const id = String(row?.id ?? "").trim();
    if (!id) {
      withoutId.push(row);
      continue;
    }
    if (!dedupedMap.has(id)) dedupedMap.set(id, row);
  }
  const deduped = [...Array.from(dedupedMap.values()), ...withoutId].sort((a, b) =>
    String(b?.created_at ?? "").localeCompare(String(a?.created_at ?? "")),
  );
  const folderIds = Array.from(
    new Set(
      deduped.flatMap((row) =>
        Array.isArray(row.scope_folder_ids)
          ? row.scope_folder_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          : [],
      ),
    ),
  );

  const folderNameById = new Map<string, string>();
  if (folderIds.length > 0) {
    const { data: folders } = await sb
      .from("folders")
      .select("id,name")
      .eq("owner_id", ownerId)
      .in("id", folderIds);
    for (const folder of (folders ?? []) as Array<{ id: string; name: string | null }>) {
      const id = String(folder?.id ?? "").trim();
      const name = String(folder?.name ?? "").trim();
      if (id && name) folderNameById.set(id, name);
    }
  }

  function labelForRow(scopeIds: string[] | null | undefined): string | null {
    const names = (scopeIds ?? []).map((id) => folderNameById.get(id)).filter((x): x is string => !!x);
    if (names.length === 0) return null;
    return formatScopeLabel(names);
  }

  const sessionsOut = deduped.slice(0, limit).map((row) => ({
    ...row,
    scope_label: labelForRow(row.scope_folder_ids),
  }));

  if (process.env.NODE_ENV !== "production" && scopeFolderIds.length > 1) {
    console.log("[flashcards/sessions] multi-scope dedupe", {
      scopeFolderIds,
      rowsBefore: allRows.length,
      rowsAfterFilter: rows.length,
      rowsAfterDedupe: deduped.length,
    });
  }

  let scopeLabel: string | null = null;
  if (scope.scopeRequested && scopeFolderIds.length > 0) {
    const { data: folders } = await sb
      .from("folders")
      .select("id,name")
      .eq("owner_id", ownerId)
      .in("id", scopeFolderIds);

    const nameById = new Map<string, string>();
    for (const f of (folders ?? []) as Array<{ id: string; name: string }>) {
      const id = String(f?.id ?? "").trim();
      const name = String(f?.name ?? "").trim();
      if (id && name) nameById.set(id, name);
    }
    const names = scopeFolderIds.map((id) => nameById.get(id)).filter((x): x is string => !!x);
    scopeLabel = formatScopeLabel(names);
  }

  return json(200, {
    ok: true,
    sessions: sessionsOut,
    scope: {
      requested: scope.scopeRequested,
      applied: scopeFolderIds.length > 0,
      hadInvalidValues: scope.hadInvalidScope,
      label: scopeLabel,
    },
  });
}
