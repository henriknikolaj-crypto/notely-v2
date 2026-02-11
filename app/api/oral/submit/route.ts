import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireFlowModel } from "@/lib/openai/requireModel";
import { danish7ToScore100, type Danish7Grade } from "@/lib/grading/danish7";
import { buildOralContext } from "@/lib/oral/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Grade = "-3" | "00" | "02" | "4" | "7" | "10" | "12";
type Segment = { start: number; end: number; text: string };

type TurnInput = {
  questionText: string;
  answerTranscript: {
    text: string;
    segments: Segment[];
  };
};

type SubmitBody = {
  durationMin: 20 | 40 | 60;
  startedAt: number;
  endedAt: number;
  folderId: string | null;
  scopeFolderIds: string[];
  notes: string | null;
  turns: TurnInput[];
};

const ALLOWED_GRADES = new Set<Grade>(["-3", "00", "02", "4", "7", "10", "12"]);

function normalizeGrade(raw: unknown): Grade {
  const s = String(raw ?? "").trim();
  if (ALLOWED_GRADES.has(s as Grade)) return s as Grade;
  if (s === "0") return "00";
  if (s === "2" || s === "+2") return "02";
  if (s === "04") return "4";
  return "02";
}

function normalizeScore(raw: unknown, fallbackGrade: Grade): number {
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  return danish7ToScore100(fallbackGrade as Danish7Grade);
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
}

function normalizeSegment(item: any): Segment | null {
  const start = Number(item?.start);
  const end = Number(item?.end);
  const text = String(item?.text ?? "").trim();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !text) return null;
  return { start: Math.max(0, start), end: Math.max(0, end), text };
}

function normalizeTurns(raw: unknown): TurnInput[] {
  if (!Array.isArray(raw)) return [];
  const out: TurnInput[] = [];
  for (const t of raw) {
    const questionText = String((t as any)?.questionText ?? "").trim();
    const transcriptText = String((t as any)?.answerTranscript?.text ?? "").trim();
    const rawSegments = Array.isArray((t as any)?.answerTranscript?.segments)
      ? (t as any).answerTranscript.segments
      : [];
    const segments: Segment[] = [];
    for (const s of rawSegments) {
      const seg = normalizeSegment(s);
      if (seg) segments.push(seg);
    }
    if (!questionText && !transcriptText) continue;
    out.push({
      questionText,
      answerTranscript: {
        text: transcriptText,
        segments,
      },
    });
  }
  return out;
}

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: false as const, error: "Tom request body." };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

function flattenSegments(turns: TurnInput[]) {
  const out: Segment[] = [];
  let offset = 0;
  for (const turn of turns) {
    const segments = turn.answerTranscript.segments;
    if (segments.length === 0 && turn.answerTranscript.text) {
      out.push({ start: offset, end: offset, text: turn.answerTranscript.text });
      continue;
    }
    let maxEnd = 0;
    for (const s of segments) {
      out.push({
        start: offset + s.start,
        end: offset + s.end,
        text: s.text,
      });
      if (s.end > maxEnd) maxEnd = s.end;
    }
    offset += maxEnd;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const parsed = await readJsonBody<SubmitBody>(req);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const body = parsed.value;
    const turns = normalizeTurns(body.turns);
    if (!turns.length) {
      return NextResponse.json({ ok: false, error: "Mangler turns." }, { status: 400 });
    }

    const durationMin = body.durationMin === 40 || body.durationMin === 60 ? body.durationMin : 20;
    const startedAt = Number(body.startedAt);
    const endedAt = Number(body.endedAt);
    const notes = body.notes ? String(body.notes).trim() : null;
    const folderId = body.folderId ? String(body.folderId).trim() : null;
    const scopeFolderIds = normalizeStringArray(body.scopeFolderIds);

    const effectiveFolderIds = normalizeStringArray(folderId ? [...scopeFolderIds, folderId] : scopeFolderIds);
    const sessionFolderId = effectiveFolderIds.length === 1 ? effectiveFolderIds[0] : null;
    const folderIdsMeta = effectiveFolderIds.length > 1 ? effectiveFolderIds : undefined;

    const { sb, id: ownerId } = await requireUser(req);
    const rl = await enforceRateLimit(
      ownerId,
      "oral_submit",
      { limit: 3, windowSeconds: 60, minIntervalMs: 8000 },
      "Mundtlig aflevering",
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
        scopeFolderIds,
        folderId,
      },
      maxChars: 8000,
    });

    const fullTranscriptText = turns
      .map((t, i) => {
        const q = t.questionText ? `Spørgsmål ${i + 1}: ${t.questionText}` : `Spørgsmål ${i + 1}`;
        const a = t.answerTranscript.text || "(ingen afskrift)";
        return `${q}\nSvar: ${a}`;
      })
      .join("\n\n");
    const transcriptSegments = flattenSegments(turns);

    const model = requireFlowModel("oral");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Du er en dansk censor for mundtlig eksamen.",
            "Vurder elevens samlede mundtlige præstation på tværs af alle turns.",
            "Svar KUN som JSON i format:",
            '{"grade":"7","score":70,"summary":"...","strengths":["..."],"improvements":["..."]}',
            'grade skal være en af "-3","00","02","4","7","10","12".',
            "score skal være 0-100.",
            "summary skal være kort og konkret på dansk.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            durationMin,
            notes,
            turns: turns.map((t) => ({
              question: t.questionText,
              answer: t.answerTranscript.text,
            })),
            transcript: fullTranscriptText,
            context: ctx.contextText || null,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let evalJson: any = {};
    try {
      evalJson = JSON.parse(raw);
    } catch {
      evalJson = {};
    }

    const grade = normalizeGrade(evalJson?.grade);
    const score = normalizeScore(evalJson?.score, grade);
    const summary =
      String(evalJson?.summary ?? "").trim() ||
      "Du viser gode takter. Løft svaret med mere præcis fagterminologi og tydeligere struktur i argumentationen.";
    const strengths = normalizeStringArray(evalJson?.strengths).slice(0, 6);
    const improvements = normalizeStringArray(evalJson?.improvements).slice(0, 6);

    const feedbackText = [
      `Samlet vurdering: ${summary}`,
      strengths.length ? `\nStyrker:\n- ${strengths.join("\n- ")}` : "",
      improvements.length ? `\nForbedringer:\n- ${improvements.join("\n- ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const { error: insertError } = await sb.from("exam_sessions").insert({
      owner_id: ownerId,
      question: turns.map((t) => t.questionText).filter(Boolean).join("\n\n"),
      answer: fullTranscriptText,
      feedback: feedbackText,
      score,
      folder_id: sessionFolderId,
      source_type: "oral",
      meta: {
        ...(folderIdsMeta ? { folder_ids: folderIdsMeta } : {}),
        durationMin,
        startedAt: Number.isFinite(startedAt) ? Math.round(startedAt) : null,
        endedAt: Number.isFinite(endedAt) ? Math.round(endedAt) : Date.now(),
        notes,
        turns,
        transcriptSegments,
        citations: ctx.citations,
        usedFileId: ctx.usedFileId,
        contextChunkCount: ctx.contextChunkCount,
        evaluation_model: model,
      },
    });

    if (insertError) {
      console.error("[oral/submit] insert error:", insertError);
      return NextResponse.json({ ok: false, error: "Kunne ikke gemme mundtlig aflevering." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      result: {
        grade,
        score,
        summary,
        strengths,
        improvements,
        transcript: {
          text: fullTranscriptText,
          segments: transcriptSegments,
        },
      },
    });
  } catch (err: any) {
    console.error("[oral/submit] route error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Uventet fejl i mundtlig aflevering." }, { status: 500 });
  }
}
