import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

// Leitner/SM2-lite (simple)
const intervalDaysByBox = [0, 1, 3, 7, 14, 30]; // box 0..5

function clampBox(n: number) {
  return Math.max(0, Math.min(5, n));
}

function computeNextBox(currentBox: number, rating: number) {
  const b = clampBox(currentBox);

  // rating: 0 igen, 1 svær, 2 ok, 3 let
  if (rating === 0) return 0;               // tilbage til "igen nu"
  if (rating === 1) return clampBox(Math.max(1, b)); // hold nede (min 1)
  if (rating === 2) return clampBox(b + 1);
  if (rating === 3) return clampBox(b + 2);
  return b;
}

function addDaysIso(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function POST(req: NextRequest) {
  let sb: any;
  let ownerId: string;

  let body: { cardId?: string; rating?: number };
  try {
    body = (await req.json()) as any;
  } catch {
    return json(400, { ok: false, error: "Bad JSON" });
  }

  try {
    const auth = await requireUser(req);
    sb = auth.sb;
    ownerId = auth.id;
  } catch {
    return json(401, { ok: false, error: "Unauthorized (mangler login eller dev-bypass)." });
  }

  const cardId = String(body.cardId ?? "").trim();
  const rating = Number(body.rating);

  if (!cardId) return json(400, { ok: false, error: "cardId mangler" });
  if (![0, 1, 2, 3].includes(rating)) return json(400, { ok: false, error: "rating skal være 0..3" });

  // Load card (owner-scoped)
  const { data: card, error: cardErr } = await sb
    .from("flashcard_cards")
    .select("id,owner_id,box")
    .eq("id", cardId)
    .eq("owner_id", ownerId)
    .single();

  if (cardErr || !card) {
    return json(404, { ok: false, error: "Card ikke fundet" });
  }

  const currentBox = Number(card.box ?? 1);
  const nextBox = computeNextBox(currentBox, rating);
  const nextDue = addDaysIso(intervalDaysByBox[nextBox] ?? 1);
  const nowIso = new Date().toISOString();

  // 1) Insert review event
  const { error: insErr } = await sb
    .from("flashcard_reviews")
    .insert({
      owner_id: ownerId,
      card_id: cardId,
      rating,
    });

  if (insErr) {
    return json(500, { ok: false, error: "Kunne ikke gemme review.", detail: String(insErr.message ?? insErr) });
  }

  // 2) Update card schedule
  const { error: updErr } = await sb
    .from("flashcard_cards")
    .update({
      box: nextBox,
      due_at: nextDue,
      last_reviewed_at: nowIso,
    })
    .eq("id", cardId)
    .eq("owner_id", ownerId);

  if (updErr) {
    return json(500, { ok: false, error: "Kunne ikke opdatere card.", detail: String(updErr.message ?? updErr) });
  }

  return json(200, {
    ok: true,
    cardId,
    rating,
    next: {
      box: nextBox,
      due_at: nextDue,
    },
  });
}
