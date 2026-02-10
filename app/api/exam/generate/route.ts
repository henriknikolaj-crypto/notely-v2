// app/api/exam/generate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type ExamGenerateRequest = {
  count?: number;
  difficulty?: Difficulty;
  maxContextChunks?: number;

  // mappe-scope (fra venstre menu / scope=... i URL)
  scopeFolderIds?: string[];

  // anti-repeat fra klienten
  avoidQuestions?: string[];
};

type ExamQuestion = {
  id: string; // "q1", "q2", ...
  prompt: string;
};

type TrainerCitationPayload = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type ExamGenerateOk = {
  ok: true;
  questions: ExamQuestion[];
  citations: TrainerCitationPayload[];
  meta: {
    requestId: string;
    model: string;
    difficulty: Difficulty;
    scopeFolderIds: string[];
    usedFileIds: string[];
    usedChunkIds: string[];
    maxContextChunks: number;
  };
};

type ExamGenerateErr = {
  ok: false;
  error: string;
  requestId: string;
  code?: string;
  debug?: any;
};

type FileRow = {
  id: string;
  name: string | null;
  original_name: string | null;
  folder_id: string | null;
  created_at: string | null;
};

type ChunkRow = {
  id: string;
  file_id: string;
  content: string | null;
  created_at: string | null;
  source_url?: string | null;
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function supabaseAdminOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true as const, value: {} as T };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

function clampInt(raw: any, min: number, max: number, fallback: number) {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(max, Math.max(min, n));
}

function pickDifficulty(raw: any): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function uniqTrimmed(ids: unknown) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ids) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

function normalizeQuestion(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  try {
    if (!process.env.OPENAI_API_KEY) {
      const err: ExamGenerateErr = { ok: false, error: "OPENAI_API_KEY mangler i .env.local.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    const parsed = await readJsonBody<ExamGenerateRequest>(req);
    if (!parsed.ok) {
      const err: ExamGenerateErr = { ok: false, error: parsed.error, requestId };
      return NextResponse.json(err, { status: 400 });
    }

    const body = parsed.value ?? {};
    const count = clampInt(body.count, 1, 15, 10);
    const difficulty = pickDifficulty(body.difficulty);
    const maxContextChunks = clampInt(body.maxContextChunks, 6, 40, 16);

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 60);
    const avoidNorm = new Set(avoidQuestions.map(normalizeQuestion));

    // Auth
    let ownerId = "";
    try {
      const u: any = await requireUser(req);
      ownerId = u.id;
    } catch {
      const err: ExamGenerateErr = { ok: false, error: "Unauthorized", requestId };
      return NextResponse.json(err, { status: 401 });
    }

    // Rate-limit (fail-open)
    try {
      const rl = await enforceRateLimit(
        ownerId,
        "exam_generate",
        { limit: 3, windowSeconds: 60, minIntervalMs: 4000 },
        "Start eksamen",
      );
      if (!rl.ok) {
        const err: ExamGenerateErr = { ok: false, error: rl.message, requestId, code: "RATE_LIMIT" };
        return NextResponse.json(err, { status: rl.status });
      }
    } catch {
      // ignore
    }

    const admin = supabaseAdminOrNull();
    if (!admin) {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kræves til exam-route).",
        requestId,
      };
      return NextResponse.json(err, { status: 500 });
    }

    // Hent filer i scope (eller alle hvis ingen scope)
    let filesQ = admin
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(120);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) {
      const err: ExamGenerateErr = { ok: false, error: "Kunne ikke hente filer.", requestId, debug: filesErr };
      return NextResponse.json(err, { status: 500 });
    }

    const fileRows = (files ?? []) as FileRow[];
    if (fileRows.length === 0) {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Ingen filer fundet i scope. Upload materiale først.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
    }

    // Vælg nogle filer for variation (max 6)
    const pickedFiles = shuffle(fileRows).slice(0, Math.min(6, fileRows.length));

    // Load chunks og byg kontekst
    const citations: TrainerCitationPayload[] = [];
    const usedFileIds: string[] = [];
    const usedChunkIds: string[] = [];

    const parts: string[] = [];

    // fordel chunks nogenlunde over filer
    const perFile = Math.max(2, Math.floor(maxContextChunks / Math.max(1, pickedFiles.length)));

    for (let i = 0; i < pickedFiles.length; i++) {
      const f = pickedFiles[i];
      const fileId = String(f.id);
      const title = fileTitle(f);

      const { data: pool } = await admin
        .from("doc_chunks")
        .select("id,file_id,content,created_at,source_url")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(350);

      const poolRows = (pool ?? []) as ChunkRow[];
      const nonEmpty = poolRows.filter((r) => (r.content ?? "").trim().length > 0);
      if (nonEmpty.length === 0) continue;

      const take = shuffle(nonEmpty).slice(0, Math.min(perFile, nonEmpty.length));
      if (take.length === 0) continue;

      usedFileIds.push(fileId);

      parts.push(`DOKUMENT ${i + 1}: ${title}`);
      parts.push("");

      for (const c of take) {
        const text = (c.content ?? "").trim();
        if (!text) continue;

        parts.push(text);
        parts.push("\n---\n");

        usedChunkIds.push(String(c.id));
        citations.push({
          chunkId: String(c.id),
          fileId,
          title,
          url: (c as any)?.source_url ? String((c as any).source_url) : null,
        });
      }
    }

    const contextText = parts.join("\n").slice(0, 16000).trim();
    if (!contextText) {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Ingen kontekst fundet (doc_chunks). Tjek at upload/parse er kørt.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
    }

    const model = process.env.OPENAI_MODEL_EXAM || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const avoidBlock =
      avoidQuestions.length > 0
        ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${avoidQuestions.join("\n- ")}\n`
        : "";

    const systemPrompt = `
Du skriver skriftlige eksamensspørgsmål på dansk.

KRAV:
- Spørgsmålene skal være varierede (redegør/analysér/diskutér/vurdér/argumentér).
- Spørgsmålene skal være tydeligt forankret i konteksten (DOKUMENT-afsnit).
- Ingen multiple choice.
- Ingen forklaringer udenfor JSON.
- Output SKAL være JSON og kun JSON.

FORMAT:
{"questions":[{"id":"q1","prompt":"..."},{"id":"q2","prompt":"..."}, ...]}
`.trim();

    const userPrompt = [
      `Antal spørgsmål: ${count}`,
      `Sværhedsgrad: ${difficulty}`,
      avoidBlock.trim(),
      "",
      "KONTEKST (brug dette som eneste grundlag):",
      "",
      contextText,
      "",
      "Lav nu spørgsmålene.",
    ]
      .filter(Boolean)
      .join("\n");

    let outQuestions: ExamQuestion[] = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await openai.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        // matcher din /api/generate-question
        temperature: 0.9,
        top_p: 0.95,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let payload: any = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = {};
      }

      const arr = Array.isArray(payload?.questions) ? payload.questions : [];
      const cleaned: ExamQuestion[] = [];

      for (const q of arr) {
        const prompt = String(q?.prompt ?? "").trim();
        if (!prompt) continue;

        const norm = normalizeQuestion(prompt);
        if (avoidNorm.has(norm)) continue;

        // undgå duplicates i samme response
        if (cleaned.some((x) => normalizeQuestion(x.prompt) === norm)) continue;

        cleaned.push({ id: "tmp", prompt });
        if (cleaned.length >= count) break;
      }

      if (cleaned.length > 0) {
        outQuestions = cleaned;
        break;
      }
    }

    if (outQuestions.length === 0) {
      const err: ExamGenerateErr = { ok: false, error: "Modellen returnerede tomt/ufuldstændigt output.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    // giv stabile ids q1..qN
    outQuestions = outQuestions.slice(0, count).map((q, idx) => ({
      id: `q${idx + 1}`,
      prompt: q.prompt,
    }));

    const resp: ExamGenerateOk = {
      ok: true,
      questions: outQuestions,
      citations,
      meta: {
        requestId,
        model,
        difficulty,
        scopeFolderIds,
        usedFileIds,
        usedChunkIds,
        maxContextChunks,
      },
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[exam/generate] route error:", requestId, err);
    const out: ExamGenerateErr = { ok: false, error: err?.message ?? "Uventet fejl i exam/generate.", requestId };
    return NextResponse.json(out, { status: 500 });
  }
}
