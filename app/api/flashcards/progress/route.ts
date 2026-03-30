import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { hasScopeOverlap, parseScopeFolderIds } from "../_scope";

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
  const since = url.searchParams.get("since");
  const sinceIso = since && !Number.isNaN(Date.parse(since)) ? since : null;

  const dailyGoal = 20;

  if (!sinceIso) {
    return json(200, { ok: true, doneToday: 0, todayUsed: 0, dailyGoal, lastSessionAt: null });
  }

  const scope = parseScopeFolderIds(req);
  const scopeFolderIds = scope.scopeFolderIds;
  if (scope.hadInvalidScope && process.env.NODE_ENV !== "production") {
    console.warn("[flashcards/progress] invalid scope values ignored:", scope.rawScopeFolderIds);
  }
  const q = sb
    .from("flashcard_sessions")
    .select("id, scope_folder_ids, returned, requested, created_at")
    .eq("owner_id", ownerId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1000);

  const { data: sessions, error } = await q;
  if (error) {
    return json(500, { ok: false, error: "Kunne ikke hente flashcards-progress.", detail: String(error.message ?? error) });
  }

  const allRows = (sessions ?? []) as Array<{
    id?: string | null;
    scope_folder_ids?: string[] | null;
    returned?: number | null;
    requested?: number | null;
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

  let todayUsed = 0;
  for (const row of deduped) {
    const returned = Number(row?.returned);
    const requested = Number(row?.requested);
    if (Number.isFinite(returned)) {
      todayUsed += Math.max(0, Math.round(returned));
    } else if (Number.isFinite(requested)) {
      todayUsed += Math.max(0, Math.round(requested));
    }
  }

  if (process.env.NODE_ENV !== "production" && scopeFolderIds.length > 1) {
    console.log("[flashcards/progress] multi-scope dedupe", {
      scopeFolderIds,
      rowsBefore: allRows.length,
      rowsAfterFilter: rows.length,
      rowsAfterDedupe: deduped.length,
      usedToday: todayUsed,
    });
  }

  const lastSessionAt = deduped[0]?.created_at ?? null;
  return json(200, { ok: true, doneToday: todayUsed, todayUsed, dailyGoal, lastSessionAt });
}
