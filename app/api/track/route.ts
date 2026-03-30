import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { trackProductEvent } from "@/lib/server/trackProductEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "signup_completed",
  "login_completed",
  "demo_started",
  "trainer_question_generated",
  "trainer_answer_evaluated",
]);

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: false as const, error: "Tom request body." };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<{ eventName?: string; metadata?: Record<string, unknown>; ownerId?: string }>(req);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const body = parsed.value ?? {};
  const eventName = String(body.eventName ?? "").trim();
  if (!ALLOWED_EVENTS.has(eventName)) {
    return NextResponse.json({ ok: false, error: "Ugyldigt event." }, { status: 400 });
  }

  let ownerId = "";

  try {
    const user = await requireUser(req);
    ownerId = String(user.id ?? "").trim();
  } catch {
    ownerId = String(body.ownerId ?? "").trim();
  }

  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await trackProductEvent({
    ownerId,
    eventName,
    metadata: body.metadata ?? {},
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
