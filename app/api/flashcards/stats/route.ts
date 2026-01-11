import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

async function getOwnerId(req: NextRequest, sb: ReturnType<typeof supabaseServerRoute>) {
  try {
    const { data } = await (sb as any).auth.getUser();
    if (data?.user?.id) return data.user.id as string;
  } catch {}

  const expected = process.env.DEV_BYPASS_SECRET;
  const devHeader = req.headers.get("x-dev-secret") || req.headers.get("x-shared-secret");
  if (expected && devHeader && devHeader === expected) return process.env.DEV_USER_ID ?? null;

  return null;
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
  const sb = supabaseServerRoute();
  const ownerId = await getOwnerId(req, sb);
  if (!ownerId) return json(401, { ok: false, error: "Unauthorized (mangler login eller dev-bypass)." });

  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const sinceIso = since && !Number.isNaN(Date.parse(since)) ? since : null;

  const scopeFolderIds = parseScope(req);

  // sessions (seneste 5) – scope-aware
  let qSess = (sb as any)
    .from("flashcard_sessions")
    .select("id,scope_folder_ids,difficulty,requested,returned,created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (scopeFolderIds.length > 0) qSess = qSess.overlaps("scope_folder_ids", scopeFolderIds);

  const { data: sessions, error: sessErr } = await qSess;
  if (sessErr) return json(500, { ok: false, error: "Kunne ikke hente sessions.", detail: sessErr.message });

  const sessionIds = (sessions ?? []).map((s: any) => String(s.id));
  const lastSessionAt = (sessions ?? [])[0]?.created_at ?? null;

  // dueCount (scope-aware hvis vi har sessions)
  const nowIso = new Date().toISOString();
  let qDue = (sb as any)
    .from("flashcard_cards")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .lte("due_at", nowIso);

  if (scopeFolderIds.length > 0 && sessionIds.length > 0) qDue = qDue.in("session_id", sessionIds);

  const { count: dueCount, error: dueErr } = await qDue;
  if (dueErr) return json(500, { ok: false, error: "Kunne ikke hente dueCount.", detail: dueErr.message });

  // doneToday = antal reviews siden "since" (scope-aware hvis muligt)
  let doneToday = 0;

  if (sinceIso) {
    if (scopeFolderIds.length > 0 && sessionIds.length > 0) {
      // v1: hent card ids i de sessions (cap)
      const { data: cards, error: cErr } = await (sb as any)
        .from("flashcard_cards")
        .select("id")
        .eq("owner_id", ownerId)
        .in("session_id", sessionIds)
        .limit(2000);

      if (cErr) return json(500, { ok: false, error: "Kunne ikke hente cards for scope.", detail: cErr.message });

      const cardIds = (cards ?? []).map((r: any) => String(r.id));
      if (cardIds.length > 0) {
        const { count, error: rErr } = await (sb as any)
          .from("flashcard_reviews")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", ownerId)
          .gte("created_at", sinceIso)
          .in("card_id", cardIds);

        if (rErr) return json(500, { ok: false, error: "Kunne ikke hente doneToday (scope).", detail: rErr.message });
        doneToday = count ?? 0;
      }
    } else {
      const { count, error: rErr } = await (sb as any)
        .from("flashcard_reviews")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .gte("created_at", sinceIso);

      if (rErr) return json(500, { ok: false, error: "Kunne ikke hente doneToday.", detail: rErr.message });
      doneToday = count ?? 0;
    }
  }

  return json(200, {
    ok: true,
    dailyGoal: 20,
    dueCount: dueCount ?? 0,
    doneToday,
    lastSessionAt,
    sessions: sessions ?? [],
  });
}
