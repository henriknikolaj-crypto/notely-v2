import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Segment = { start: number; end: number; text: string };

function normalizeSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return [];
  const out: Segment[] = [];
  for (const item of raw) {
    const start = Number((item as any)?.start);
    const end = Number((item as any)?.end);
    const text = String((item as any)?.text ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue;
    out.push({ start: Math.max(0, start), end: Math.max(0, end), text });
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }
    const model = String(process.env.OPENAI_TRANSCRIBE_MODEL ?? "").trim();
    if (!model) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_TRANSCRIBE_MODEL." }, { status: 500 });
    }

    const { id: ownerId } = await requireUser(req);
    const rl = await enforceRateLimit(
      ownerId,
      "oral_transcribe_turn",
      { limit: 8, windowSeconds: 60, minIntervalMs: 1200 },
      "Mundtlig transskription",
    );
    if (!rl.ok) {
      const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      return NextResponse.json(
        { ok: false, error: rl.message, retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
      );
    }

    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) {
      return NextResponse.json({ ok: false, error: "Mangler lydfil (audio)." }, { status: 400 });
    }
    const language = String(form.get("language") ?? "da").trim() || "da";

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcript = (await openai.audio.transcriptions.create({
      file: audio,
      model,
      language,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    })) as any;

    const text = String(transcript?.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ ok: false, error: "Kunne ikke udtrække afskrift fra lydfilen." }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      transcript: {
        text,
        segments: normalizeSegments(transcript?.segments),
      },
    });
  } catch (err: any) {
    console.error("[oral/transcribe-turn] route error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Uventet fejl i oral transcribe-turn." }, { status: 500 });
  }
}
