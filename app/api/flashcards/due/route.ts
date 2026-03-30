import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function parseScope(req: NextRequest): string[] {
  const url = new URL(req.url);
  const a = url.searchParams.getAll("scopeFolderIds[]").filter(Boolean);
  if (a.length > 0) return a;

  return (url.searchParams.get("scopeFolderIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
  const limitRaw = Number(url.searchParams.get("limit") ?? 20);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 20));

  const scopeFolderIds = parseScope(req);

  // Hvis scope er sat, find sessionIds der overlapper scope
  let sessionIds: string[] | null = null;

  if (scopeFolderIds.length > 0) {
    const { data: sess, error: sErr } = await sb
      .from("flashcard_sessions")
      .select("id")
      .eq("owner_id", ownerId)
      .overlaps("scope_folder_ids", scopeFolderIds)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (sErr) {
      return json(500, {
        ok: false,
        error: "Kunne ikke hente sessions for scope.",
        detail: String(sErr.message ?? sErr),
      });
    }

    const resolvedSessionIds = (sess ?? []).map((r: any) => String(r.id));
    if (resolvedSessionIds.length === 0) {
      return json(200, { ok: true, dueCount: 0, cards: [] });
    }
    sessionIds = resolvedSessionIds;
  }

  const nowIso = new Date().toISOString();

  // Hent due cards (forfalden <= nu)
  let q = sb
    .from("flashcard_cards")
    .select(
      "id,session_id,front,back,citation_file_id,citation_title,citation_url,box,due_at,last_reviewed_at",
      { count: "exact" }
    )
    .eq("owner_id", ownerId)
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(limit);

  if (sessionIds) q = q.in("session_id", sessionIds);

  const { data, error, count } = await q;

  if (error) {
    return json(500, {
      ok: false,
      error: "Kunne ikke hente due cards.",
      detail: String(error.message ?? error),
    });
  }

  return json(200, {
    ok: true,
    dueCount: count ?? (data?.length ?? 0),
    cards: (data ?? []).map((r: any) => ({
      id: String(r.id),
      session_id: String(r.session_id),
      front: String(r.front ?? ""),
      back: String(r.back ?? ""),
      citation: {
        file_id: r.citation_file_id ?? null,
        title: r.citation_title ?? null,
        url: r.citation_url ?? null,
      },
      box: typeof r.box === "number" ? r.box : 1,
      due_at: r.due_at ?? null,
      last_reviewed_at: r.last_reviewed_at ?? null,
    })),
  });
}
