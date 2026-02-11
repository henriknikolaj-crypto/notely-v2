import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireFlowModel } from "@/lib/openai/requireModel";
import { buildOralContext } from "@/lib/oral/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  scopeFolderIds?: string[];
  folderId?: string | null;
  history?: Array<{ role: "assistant" | "user"; text: string }>;
  turnIndex?: number;
};

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: false as const, error: "Tom request body." };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

function normalizeHistory(raw: unknown) {
  if (!Array.isArray(raw)) return [] as Array<{ role: "assistant" | "user"; text: string }>;
  return raw
    .map((x) => {
      const role = (x as any)?.role === "assistant" ? "assistant" : (x as any)?.role === "user" ? "user" : null;
      const text = String((x as any)?.text ?? "").trim();
      if (!role || !text) return null;
      return { role, text };
    })
    .filter((x): x is { role: "assistant" | "user"; text: string } => !!x)
    .slice(-12);
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const parsed = await readJsonBody<Body>(req);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const body = parsed.value;

    const { sb, id: ownerId } = await requireUser(req);
    const rl = await enforceRateLimit(
      ownerId,
      "oral_next_question",
      { limit: 8, windowSeconds: 60, minIntervalMs: 1200 },
      "Mundtlig næste spørgsmål",
    );
    if (!rl.ok) {
      const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      return NextResponse.json(
        { ok: false, error: rl.message, retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
      );
    }

    const ctx = await buildOralContext({
      sb,
      ownerId,
      input: {
        scopeFolderIds: Array.isArray(body.scopeFolderIds) ? body.scopeFolderIds : [],
        folderId: body.folderId ?? null,
      },
      maxChars: 8000,
    });

    const history = normalizeHistory(body.history);
    const model = requireFlowModel("oral");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Du er dansk eksaminator til mundtlig eksamen.",
            "Stil ét kort, klart spørgsmål på dansk (kun ét spørgsmål).",
            "Brug kontekst fra materialet og elevens tidligere svar.",
            "Svar KUN som JSON: {\"question\":\"...\"}.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            turnIndex: Number.isFinite(Number(body.turnIndex)) ? Math.max(0, Math.floor(Number(body.turnIndex))) : 0,
            history,
            context: ctx.contextText || null,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsedQ: any = {};
    try {
      parsedQ = JSON.parse(raw);
    } catch {
      parsedQ = {};
    }
    const questionText =
      String(parsedQ?.question ?? "").trim() || "Forklar kort den vigtigste pointe i materialet med et konkret eksempel.";

    const ttsModel = String(process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts").trim() || "gpt-4o-mini-tts";
    const ttsVoice = String(process.env.OPENAI_TTS_VOICE ?? "marin").trim() || "marin";
    const speech = await openai.audio.speech.create({
      model: ttsModel,
      voice: ttsVoice as any,
      input: questionText,
      response_format: "mp3",
    });
    const ab = await speech.arrayBuffer();
    const audioBase64 = Buffer.from(ab).toString("base64");

    return NextResponse.json({
      ok: true,
      questionText,
      audioBase64,
      mime: "audio/mpeg",
    });
  } catch (err: any) {
    console.error("[oral/next-question] route error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Uventet fejl i oral next-question." }, { status: 500 });
  }
}
