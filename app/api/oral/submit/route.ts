import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit } from "@/lib/rateLimit";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { resolveModelForFeature } from "@/lib/openai/model";
import { buildFeedbackV2, deriveWeakPointTargetsFromFeedbackV2, type LearningIssue } from "@/lib/learning/feedback";
import { resolveEvaluatorDefinition } from "@/lib/learning/evaluator-registry";
import { danish7ToScore100, type Danish7Grade } from "@/lib/grading/danish7";
import { buildOralContext } from "@/lib/oral/context";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Grade = "-3" | "00" | "02" | "4" | "7" | "10" | "12";
type Segment = { start: number; end: number; text: string };
type WeakPointSeverity = "low" | "medium" | "high";
type OralWeakPoint = {
  key: string;
  label: string;
  action?: string;
  summary?: string;
  next_step?: string;
  evidence?: string;
  severity?: WeakPointSeverity;
};
type OralEvalJson = {
  grade?: unknown;
  score?: unknown;
  summary?: unknown;
  strengths?: unknown;
  improvements?: unknown;
  weak_points?: unknown;
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
  return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function normalizeSeverity(raw: unknown): WeakPointSeverity | undefined {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return undefined;
}

function normalizeOralWeakPoints(raw: unknown): OralWeakPoint[] {
  if (!Array.isArray(raw)) return [];

  const out: OralWeakPoint[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const rawLabel = String(obj.label ?? obj.text ?? obj.key ?? "").trim();
    const rawKey = String(obj.key ?? rawLabel).trim().toLowerCase();
    const summary = String(obj.summary ?? "").trim();
    const nextStep = String(obj.next_step ?? obj.nextStep ?? obj.action ?? "").trim();
    const evidence = String(obj.evidence ?? "").trim();
    const severity = normalizeSeverity(obj.severity);
    const key = rawKey || rawLabel.toLowerCase();
    const label = rawLabel || rawKey;

    if (!key || !label) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      key,
      label,
      ...(nextStep ? { action: nextStep } : {}),
      ...(summary ? { summary } : {}),
      ...(nextStep ? { next_step: nextStep } : {}),
      ...(evidence ? { evidence } : {}),
      ...(severity ? { severity } : {}),
    });

    if (out.length >= 3) break;
  }

  return out;
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
        kind: t?.kind === "followup" || t?.kind === "new" ? t.kind : undefined,
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

function supabaseAdminOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p || p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const transcribeModel = resolveModelForFeature("transcribe");
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

    const sb = supabaseServerRouteReadOnly(req);
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

    let ownerId = sessionUserId;
    let getUserError: string | null = null;

    if (!ownerId) {
      const { data: authData, error: authError } = await sb.auth.getUser();
      getUserError = authError?.message ?? null;
      ownerId = authData?.user?.id ? String(authData.user.id) : null;
    }

    if (!ownerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "unauthorized",
          ...(process.env.VERCEL_ENV === "preview"
            ? {
                debug: {
                  hasSession: !!sessionData?.session,
                  sessionUserId,
                  sessionError: sessionError?.message ?? null,
                  getUserError,
                  cookieNames,
                },
              }
            : {}),
        },
        { status: 401 },
      );
    }

    const admin = supabaseAdminOrNull();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Server config mangler." }, { status: 500 });
    }

    // Why: Mundtlig eksamen skal håndhæves server-side som Pro-only, så client-bypass ikke virker.
    const { data: profile } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const plan = normalizePlan((profile as any)?.plan);
    if (plan !== "pro") {
      return NextResponse.json(
        { ok: false, error: "Kræver Pro", code: "PRO_REQUIRED", requestId },
        { status: 403 },
      );
    }

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

    const model = resolveModelForFeature("oral_eval");
    const { completion } = await createChatCompletion(openai, {
      feature: "oral_eval",
      purpose: "json",
      modelOverride: model,
      payload: {
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Du er en dansk censor for mundtlig eksamen.",
              "Du evaluerer hele samtalen (flere spørgsmål/svar) samlet.",
              "Vurder ud fra samtaletekst, noter og kontekst. Giv én samlet karakter.",
              "Svar KUN som JSON i format:",
              '{"grade":"7","score":70,"summary":"...","strengths":["..."],"improvements":["..."],"weak_points":[{"key":"begrebsbrug","label":"Begrebsbrug","summary":"...","next_step":"...","evidence":"...","severity":"medium"}]}',
              'grade skal være en af "-3","00","02","4","7","10","12".',
              "score skal være 0-100.",
              "summary skal være kort og konkret på dansk.",
              "weak_points skal være et array med 1-3 mundtlige/faglige svagheder, eller tomt array hvis der ikke er nogen tydelige.",
              "Hver weak_point skal have key, label, summary, next_step og evidence. severity må være low, medium eller high.",
              "Brug konkrete mundtlige kategorier som begrebsbrug, præcision, materialehenvisning, argumentation eller direkte besvarelse af spørgsmålet.",
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
      },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let evalJson: OralEvalJson = {};
    try {
      evalJson = JSON.parse(raw) as OralEvalJson;
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
    const weakPoints = normalizeOralWeakPoints(evalJson?.weak_points);

    const feedbackText = [
      `Samlet vurdering: ${summary}`,
      strengths.length ? `\nStyrker:\n- ${strengths.join("\n- ")}` : "",
      improvements.length ? `\nForbedringer:\n- ${improvements.join("\n- ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const structuredResult = {
      overall: {
        grade,
        summary,
        strengths,
        improvements,
      },
    };

    const evaluator = resolveEvaluatorDefinition("oral");
    const oralIssues: LearningIssue[] = weakPoints.map((point) => ({
      code: point.key,
      category: "oral_performance",
      severity: point.severity ?? "medium",
      title: point.label,
      diagnosis: point.summary || `${point.label} er et tydeligt forbedringspunkt i den mundtlige præstation.`,
      why_it_matters:
        "Det påvirker, hvor præcist, overbevisende og fagligt sikkert svaret fremstår i den mundtlige situation.",
      evidence: point.evidence ? [point.evidence] : [],
      repair:
        point.next_step ??
        point.action ??
        `Arbejd målrettet med ${point.label.toLowerCase()} i næste samtale.`,
    }));
    const learningSignals = buildFeedbackV2({
      evaluator,
      sourceType: "oral",
      summary,
      strengths,
      issues: oralIssues,
      nextBestAction: weakPoints[0]?.next_step ?? weakPoints[0]?.action ?? improvements[0],
      improvements,
      weakPoints,
      citations: ctx.citations,
      fallbackSummary: summary,
      fallbackNextBestAction:
        weakPoints[0]?.next_step ??
        weakPoints[0]?.action ??
        "Brug ét konkret forbedringspunkt aktivt i dit næste mundtlige svar.",
    });
    const backwardCompatibleWeakPoints = deriveWeakPointTargetsFromFeedbackV2(learningSignals);
    const sessionMeta = {
      mode: "oral",
      ...(folderIdsMeta ? { folder_ids: folderIdsMeta } : {}),
      durationMin,
      startedAt,
      endedAt,
      notes,
      result: structuredResult,
      weak_points: backwardCompatibleWeakPoints,
      feedback_v2: learningSignals,
      learning_signals: learningSignals,
      turns: allTurns,
      transcriptSegmentsLast: transcriptSegments,
      session_id: sessionId,
      turn_index: turnIndex,
      citations: ctx.citations,
      usedFileId: ctx.usedFileId,
      contextChunkCount: ctx.contextChunkCount,
      transcription_model: transcribeModel,
      evaluation_model: model,
    };

    const { error: insertError } = await admin.from("exam_sessions").insert({
      owner_id: ownerId,
      question: "Mundtlig eksamen (samtale)",
      answer: conversationText,
      feedback: feedbackText,
      score,
      folder_id: sessionFolderId,
      source_type: "oral",
      meta: sessionMeta,
      metadata: sessionMeta,
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
