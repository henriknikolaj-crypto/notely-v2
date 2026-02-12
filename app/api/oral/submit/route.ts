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
  return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function parseScopeFolderIds(form: FormData): string[] {
  const raw = String(form.get("scopeFolderIds") ?? "").trim();
  if (!raw) return [];
  try {
    return normalizeStringArray(JSON.parse(raw));
  } catch {
    return raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
}

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

function parseDurationMin(form: FormData): 20 | 40 | 60 {
  const n = Number(form.get("durationMin"));
  if (n === 40 || n === 60) return n;
  return 20;
}

function parseEpochMs(raw: FormDataEntryValue | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function asFile(form: FormData, key: string): File | null {
  const v = form.get(key);
  if (!(v instanceof File)) return null;
  return v;
}

function shouldUseVerboseJson(model: string) {
  const m = model.toLowerCase();
  // Nogle transcribe-varianter (fx diarize og visse mini-varianter) understøtter kun json/text
  if (m.includes("transcribe-diarize")) return false;
  if (m.includes("gpt-4o-mini-transcribe")) return false;
  if (m.includes("gpt-4o-mini-transcribe-api")) return false;
  return true;
}

type TurnForMeta = {
  questionText: string;
  transcriptText: string;
  notes?: string;
  kind?: "followup" | "new";
  threadId?: string | null;
  followupCount?: number;
};

function safeParseTurns(raw: string): TurnForMeta[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    if (!Array.isArray(v)) return [];
    return v
      .map((t: any) => ({
        questionText: String(t?.questionText ?? "").trim(),
        transcriptText: String(t?.transcriptText ?? "").trim(),
        notes: String(t?.notes ?? "").trim() || undefined,
        kind: t?.kind === "followup" ? "followup" : t?.kind === "new" ? "new" : undefined,
        threadId: typeof t?.threadId === "string" ? t.threadId : null,
        followupCount: Number.isFinite(Number(t?.followupCount)) ? Number(t.followupCount) : undefined,
      }))
      .filter((t) => t.questionText || t.transcriptText);
  } catch {
    return [];
  }
}

function buildConversationText(turns: TurnForMeta[]) {
  const blocks: string[] = [];
  for (const t of turns) {
    if (t.questionText) blocks.push(`Spørgsmål: ${t.questionText}`);
    if (t.transcriptText) blocks.push(`Svar: ${t.transcriptText}`);
  }
  return blocks.join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const transcribeModel = String(process.env.OPENAI_TRANSCRIBE_MODEL ?? "").trim();
    if (!transcribeModel) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_TRANSCRIBE_MODEL." }, { status: 500 });
    }

    const form = await req.formData();

    const isFinal = String(form.get("final") ?? "").trim() === "1";
    const audio = asFile(form, "audio"); // må være null ved final=1 (finalize uden lyd)

    if (!audio && !isFinal) {
      return NextResponse.json({ ok: false, error: "Mangler lydfil (audio)." }, { status: 400 });
    }

    const question = String(form.get("question") ?? form.get("questionText") ?? "").trim();
    const durationMin = parseDurationMin(form);
    const startedAt = parseEpochMs(form.get("startedAt"));
    const endedAt = parseEpochMs(form.get("endedAt")) ?? Date.now();
    const notes = String(form.get("notes") ?? "").trim() || null;
    const sessionId = String(form.get("sessionId") ?? "").trim() || null;
    const turnIndexRaw = Number(form.get("turnIndex"));
    const turnIndex = Number.isFinite(turnIndexRaw) ? Math.max(0, Math.floor(turnIndexRaw)) : null;

    const folderIdRaw = String(form.get("folderId") ?? "").trim();
    const folderId = folderIdRaw || null;
    const scopeFolderIds = parseScopeFolderIds(form);
    const effectiveFolderIds = normalizeStringArray(folderId ? [...scopeFolderIds, folderId] : scopeFolderIds);
    const sessionFolderId = effectiveFolderIds.length === 1 ? effectiveFolderIds[0] : null;
    const folderIdsMeta = effectiveFolderIds.length > 1 ? effectiveFolderIds : undefined;

    const priorTurns = safeParseTurns(String(form.get("turns") ?? ""));

    const { sb, id: ownerId } = await requireUser(req);

    // Rate limit: turns må ske ofte; final eval skal være strammere
    const rl = await enforceRateLimit(
      ownerId,
      isFinal ? "oral_final" : "oral_turn",
      isFinal
        ? { limit: 6, windowSeconds: 600, minIntervalMs: 4000 }
        : { limit: 60, windowSeconds: 600, minIntervalMs: 1200 },
      isFinal ? "Mundtlig evaluering" : "Mundtlig tur",
    );
    if (!rl.ok) {
      const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      return NextResponse.json(
        { ok: false, error: rl.message, retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
      );
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1) Transcribe (hvis vi har audio)
    let transcriptText = "";
    let transcriptSegments: Segment[] = [];

    if (audio) {
      const useVerbose = shouldUseVerboseJson(transcribeModel);

      const transcriptionReq: any = {
        file: audio,
        model: transcribeModel,
        language: "da",
        response_format: useVerbose ? "verbose_json" : "json",
      };

      if (useVerbose) {
        // verbose_json kræves for timestamps, og segment/word er tilladt når modellen understøtter det
        transcriptionReq.timestamp_granularities = ["segment"];
      }

      const transcript = (await openai.audio.transcriptions.create(transcriptionReq)) as any;

      transcriptText = String(transcript?.text ?? "").trim();
      if (!transcriptText) {
        return NextResponse.json({ ok: false, error: "Kunne ikke udtrække afskrift fra lydfilen." }, { status: 422 });
      }

      transcriptSegments = useVerbose ? normalizeSegments(transcript?.segments) : [];
    }

    // Hvis ikke final: returnér kun transkript (ingen evaluering, ingen DB insert)
    if (!isFinal) {
      return NextResponse.json({
        ok: true,
        transcript: {
          text: transcriptText,
          segments: transcriptSegments,
        },
      });
    }

    // 2) Final evaluering (samlet samtale)
    const allTurns: TurnForMeta[] = [
      ...priorTurns,
      ...(question || transcriptText
        ? [
            {
              questionText: question,
              transcriptText,
              notes: notes ?? undefined,
            },
          ]
        : []),
    ];

    const conversationText = buildConversationText(allTurns).trim();
    if (!conversationText) {
      return NextResponse.json({ ok: false, error: "Mangler samtale-indhold til evaluering." }, { status: 400 });
    }

    const ctx = await buildOralContext({
      sb,
      ownerId,
      input: { scopeFolderIds, folderId },
      maxChars: 8000,
    });

    const model = requireFlowModel("oral"); // OPENAI_MODEL_ORAL = gpt-5.2
    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Du er en dansk censor for mundtlig eksamen.",
            "Du evaluerer hele samtalen (flere spørgsmål/svar) samlet.",
            "Vurder ud fra samtaletekst, noter og kontekst. Giv én samlet karakter.",
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
            conversation: conversationText,
            notes,
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
      "Du viser gode takter. Løft svaret med mere præcis fagterminologi og tydeligere struktur.";
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
      question: "Mundtlig eksamen (samtale)",
      answer: conversationText,
      feedback: feedbackText,
      score,
      folder_id: sessionFolderId,
      source_type: "oral",
      meta: {
        ...(folderIdsMeta ? { folder_ids: folderIdsMeta } : {}),
        durationMin,
        startedAt,
        endedAt,
        notes,
        turns: allTurns,
        // segments for sidste tur (hvis vi fik dem)
        transcriptSegmentsLast: transcriptSegments,
        session_id: sessionId,
        turn_index: turnIndex,
        citations: ctx.citations,
        usedFileId: ctx.usedFileId,
        contextChunkCount: ctx.contextChunkCount,
        transcription_model: transcribeModel,
        evaluation_model: model,
      },
    });

    if (insertError) {
      console.error("[oral/submit] insert error:", insertError);
      return NextResponse.json({ ok: false, error: "Kunne ikke gemme mundtlig evaluering." }, { status: 500 });
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
          text: conversationText,
          segments: [],
        },
      },
    });
  } catch (err: any) {
    console.error("[oral/submit] route error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Uventet fejl i mundtlig aflevering." }, { status: 500 });
  }
}
