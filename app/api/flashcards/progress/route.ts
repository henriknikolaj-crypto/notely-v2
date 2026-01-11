import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

async function getOwnerId(req: NextRequest, sb: any): Promise<string | null> {
  // 1) Real auth
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) return data.user.id as string;
  } catch {}

  // 2) Dev fallback for browser (ingen headers)
  if (process.env.NODE_ENV !== "production" && process.env.DEV_USER_ID) {
    return process.env.DEV_USER_ID;
  }

  // 3) Header bypass (PowerShell)
  const expected = process.env.DEV_BYPASS_SECRET;
  const h = req.headers.get("x-dev-secret") || req.headers.get("x-shared-secret");
  if (expected && h && h === expected) return process.env.DEV_USER_ID ?? null;

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
  const sb = await supabaseServerRoute(); // ✅ vigtig
  const ownerId = await getOwnerId(req, sb);

  if (!ownerId) {
    return json(401, { ok: false, error: "Unauthorized (mangler login eller dev-bypass)." });
  }

  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const sinceIso = since && !Number.isNaN(Date.parse(since)) ? since : null;

  const dailyGoal = 20;

  if (!sinceIso) {
    return json(200, { ok: true, doneToday: 0, dailyGoal });
  }

  const scopeFolderIds = parseScope(req);

  // Scope-aware: count reviews for cards in sessions that overlap scope
  if (scopeFolderIds.length > 0) {
    const { data: sess, error: sErr } = await sb
      .from("flashcard_sessions")
      .select("id")
      .eq("owner_id", ownerId)
      .overlaps("scope_folder_ids", scopeFolderIds)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (sErr) {
      return json(500, { ok: false, error: "Kunne ikke hente sessions for scope.", detail: String(sErr.message ?? sErr) });
    }

    const sessionIds = (sess ?? []).map((r: any) => String(r.id));
    if (sessionIds.length === 0) return json(200, { ok: true, doneToday: 0, dailyGoal });

    const { data: cards, error: cErr } = await sb
      .from("flashcard_cards")
      .select("id")
      .eq("owner_id", ownerId)
      .in("session_id", sessionIds)
      .limit(5000);

    if (cErr) {
      return json(500, { ok: false, error: "Kunne ikke hente cards for scope.", detail: String(cErr.message ?? cErr) });
    }

    const cardIds = (cards ?? []).map((r: any) => String(r.id));
    if (cardIds.length === 0) return json(200, { ok: true, doneToday: 0, dailyGoal });

    const { count, error: rErr } = await sb
      .from("flashcard_reviews")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .gte("created_at", sinceIso)
      .in("card_id", cardIds);

    if (rErr) {
      return json(500, { ok: false, error: "Kunne ikke hente doneToday (scope).", detail: String(rErr.message ?? rErr) });
    }

    return json(200, { ok: true, doneToday: count ?? 0, dailyGoal });
  }

  // No scope: count all reviews since
  const { count, error } = await sb
    .from("flashcard_reviews")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .gte("created_at", sinceIso);

  if (error) {
    return json(500, { ok: false, error: "Kunne ikke hente doneToday.", detail: String(error.message ?? error) });
  }

  return json(200, { ok: true, doneToday: count ?? 0, dailyGoal });
}
