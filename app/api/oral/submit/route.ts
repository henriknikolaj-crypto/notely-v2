import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { ensureQuotaAndDecrement } from "@/lib/quota";
import { requireFlowModel } from "@/lib/openai/requireModel";
import { danish7ToScore100, type Danish7Grade } from "@/lib/grading/danish7";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Grade = "-3" | "00" | "02" | "4" | "7" | "10" | "12";
type Segment = { start: number; end: number; text: string };

const ALLOWED_GRADES = new Set<Grade>(["-3", "00", "02", "4", "7", "10", "12"]);

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const x of value) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

function parseScopeFolderIds(raw: FormDataEntryValue | null): string[] {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  try {
    return normalizeStringArray(JSON.parse(s));
  } catch {
    return [];
  }
}

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

function normalizeSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return [];
  const out: Segment[] = [];

  for (const item of raw) {
    const start = Number((item as any)?.start);
    const end = Number((item as any)?.end);
    const text = String((item as any)?.text ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue;
    out.push({
      start: Math.max(0, start),
      end: Math.max(0, end),
      text,
    });
  }

  return out;
}

function readFile(form: FormData, key: string) {
  const value = form.get(key);
  if (!(value instanceof File)) return null;
  return value;
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
    const file = readFile(form, "audio");
    if (!file) {
      return NextResponse.json({ ok: false, error: "Mangler lydfil (audio)." }, { status: 400 });
    }

    const question = String(form.get("question") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const sourceType = String(form.get("source_type") ?? "mundtlig_simulator").trim() || "mundtlig_simulator";
    const scopeFolderIds = parseScopeFolderIds(form.get("scopeFolderIds"));

    const folderIdRaw = String(form.get("folderId") ?? "").trim();
    const folderId = folderIdRaw || null;

    const effectiveFolderIds = normalizeStringArray(
      folderId ? [...scopeFolderIds, folderId] : scopeFolderIds,
    );
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

    const quota = await ensureQuotaAndDecrement(ownerId, "evaluate", 1);
    if (!quota.ok) {
      return NextResponse.json({ ok: false, error: quota.message }, { status: quota.status });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const transcript = (await openai.audio.transcriptions.create({
      file,
      model: transcribeModel,
      language: "da",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    })) as any;

    const transcriptText = String(transcript?.text ?? "").trim();
    if (!transcriptText) {
      return NextResponse.json({ ok: false, error: "Kunne ikke udtrække afskrift fra lydfilen." }, { status: 422 });
    }

    const segments = normalizeSegments(transcript?.segments);

    const evaluationModel = requireFlowModel("oral");
    const evalPrompt = [
      "Du er en dansk eksamenscensor for mundtlig prøve.",
      "Vurder svaret ud fra spørgsmålet, afskriften og evt. stikord.",
      "Svar KUN som JSON med præcis felterne grade, score, feedback.",
      'grade skal være én af: "-3","00","02","4","7","10","12".',
      "score skal være 0-100.",
      "feedback skal være kort, konkret og handlingsrettet på dansk.",
    ].join(" ");

    const evalPayload = {
      question: question || null,
      transcript: transcriptText,
      notes: notes || null,
    };

    const completion = await openai.chat.completions.create({
      model: evaluationModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: evalPrompt },
        { role: "user", content: JSON.stringify(evalPayload) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const grade = normalizeGrade(parsed?.grade);
    const score = normalizeScore(parsed?.score, grade);
    const feedback =
      String(parsed?.feedback ?? "").trim() ||
      "Du viser forståelse, men kan løfte svaret med tydeligere begreber, struktur og konkrete eksempler.";

    const insertPayload = {
      owner_id: ownerId,
      question: question || null,
      answer: transcriptText,
      feedback,
      score,
      folder_id: sessionFolderId,
      source_type: sourceType,
      meta: {
        flow: "oral",
        notes: notes || null,
        transcription_model: transcribeModel,
        evaluation_model: evaluationModel,
        scopeFolderIds,
        ...(folderIdsMeta ? { folder_ids: folderIdsMeta } : {}),
        transcript: {
          text: transcriptText,
          segments,
        },
      },
    };

    const { data, error } = await sb.from("exam_sessions").insert(insertPayload).select("id").single();
    if (error) {
      console.error("[oral/submit] insert exam_sessions error:", error);
      return NextResponse.json({ ok: false, error: "Kunne ikke gemme mundtlig aflevering." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      sessionId: String((data as any)?.id ?? ""),
      grade,
      score,
      feedback,
      transcriptText,
      segments,
    });
  } catch (err: any) {
    console.error("[oral/submit] route error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Uventet fejl i mundtlig aflevering." }, { status: 500 });
  }
}
