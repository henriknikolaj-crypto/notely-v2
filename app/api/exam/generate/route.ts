// app/api/exam/generate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

import { enforceRateLimit } from "@/lib/rateLimit";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { resolveModelForFeature } from "@/lib/openai/model";
import { rankChunksForPrompt } from "@/lib/retrieval/structureAware";
import { deriveFocusTargetsFromLearningSignals, type LearningFocusSessionRow } from "@/lib/learning/focus";
import { parseQuestionListOutput, type QuestionOutputDiagnostics } from "@/lib/learning/question-output";
import { resolveTrainerSubjectFamilyFromCandidates } from "@/lib/learning/subjects/families";
import {
  inferTrainerGenerateSharedSubjectFamily,
  resolveTrainerGenerateSharedSubjectConfig,
} from "@/lib/learning/subjects/generate/registry";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";
import {
  calibrateGeneratedQuestionForStudentLevel,
  compactWeakPointTargetsForPrompt,
  truncateContextForQuestionPrompt,
  type WeakPointTarget,
} from "@/lib/trainer/generate-question";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";
type FocusMode = "normal" | "weakest";

type ExamGenerateRequest = {
  count?: number;
  difficulty?: Difficulty;
  maxContextChunks?: number;

  // mappe-scope (fra venstre menu / scope=... i URL)
  scopeFolderIds?: string[];
  folderId?: string | null;
  focusMode?: FocusMode;

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
    focusMode: FocusMode;
    biasApplied: boolean;
    focusTargets: Array<{ key: string; label: string }>;
    weakSessionCount: number;
    structuredFocusSessionCount?: number;
    legacyFocusSessionCount?: number;
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

type ExamGenerationStrategyKey = "weakest_primary" | "weakest_simplified" | "normal_fallback" | "normal";

type ExamGenerationAttemptDiagnostic = QuestionOutputDiagnostics & {
  strategy: ExamGenerationStrategyKey;
  attempt: number;
  rejectReason: "content_missing" | "filtered_out";
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

function pickFocusMode(raw: any): FocusMode {
  return raw === "weakest" ? "weakest" : "normal";
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

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p || p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
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
    const requestedFocusMode = pickFocusMode(body.focusMode);

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const explicitFolderId = String(body.folderId ?? "").trim();
    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 60);
    const avoidNorm = new Set(avoidQuestions.map(normalizeQuestion));

    let effectiveFocusMode: FocusMode = requestedFocusMode;
    let focusScopeFolderId: string | null = null;
    if (requestedFocusMode === "weakest") {
      if (explicitFolderId) {
        focusScopeFolderId = explicitFolderId;
      } else if (scopeFolderIds.length === 1) {
        focusScopeFolderId = scopeFolderIds[0];
      } else {
        effectiveFocusMode = "normal";
      }
    }
    let focusTargets: WeakPointTarget[] = [];
    let weakSessionCount = 0;
    let structuredFocusSessionCount = 0;
    let legacyFocusSessionCount = 0;
    let finalPromptFocusTargets: WeakPointTarget[] = [];

    // Auth: session-first, read-only route client
    let ownerId = "";
    const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
    try {
      const sbAuth = supabaseServerRouteReadOnly(req);
      const { data: sessionData, error: sessionError } = await sbAuth.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

      if (sessionUserId) {
        ownerId = sessionUserId;
      } else {
        const { data: authData, error: authError } = await sbAuth.auth.getUser();
        if (!authError && authData?.user?.id) {
          ownerId = String(authData.user.id);
        } else {
          const err: ExamGenerateErr = {
            ok: false,
            error: "Unauthorized",
            requestId,
            ...(process.env.VERCEL_ENV === "preview"
              ? {
                  debug: {
                    hasSession: !!sessionData?.session,
                    sessionUserId,
                    sessionError: sessionError?.message ?? null,
                    getUserError: authError?.message ?? null,
                    cookieNames,
                  },
                }
              : {}),
          };
          return NextResponse.json(err, { status: 401 });
        }
      }
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

    await ensureProfile(admin, ownerId);

    // Why: Eksamen skal håndhæves server-side som Pro-only, så client-bypass ikke virker.
    const { data: profile } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const plan = normalizePlan((profile as any)?.plan);
    if (plan !== "pro") {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Kræver Pro",
        code: "PRO_REQUIRED",
        requestId,
      };
      return NextResponse.json(err, { status: 403 });
    }

    if (effectiveFocusMode === "weakest" && focusScopeFolderId) {
      const { data: weakRows } = await admin
        .from("exam_sessions")
        .select("created_at,metadata,meta,source_type,score")
        .eq("owner_id", ownerId)
        .eq("folder_id", focusScopeFolderId)
        .in("source_type", ["trainer", "simulator", "oral"])
        .order("created_at", { ascending: false })
        .limit(40);

      const weakRowsArr = (weakRows ?? []) as LearningFocusSessionRow[];
      const derivedFocus = deriveFocusTargetsFromLearningSignals(weakRowsArr, 2);
      weakSessionCount = derivedFocus.contributing_session_count;
      structuredFocusSessionCount = derivedFocus.structured_session_count;
      legacyFocusSessionCount = derivedFocus.legacy_session_count;
      focusTargets = derivedFocus.targets.map((target) => ({
        key: target.key,
        label: target.label,
        ...(target.suggested_action ? { action: target.suggested_action } : {}),
      }));
      if (focusTargets.length === 0) {
        effectiveFocusMode = "normal";
      }
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

      const queryForRanking = [
        difficulty,
        ...focusTargets.flatMap((target) => [target.label, target.action ?? ""]).filter(Boolean),
      ].join(" ");
      const take =
        effectiveFocusMode === "weakest" && focusTargets.length > 0
          ? rankChunksForPrompt(nonEmpty, queryForRanking)
              .slice(0, Math.min(Math.max(perFile * 2, perFile), nonEmpty.length))
              .map((item) => item.chunk)
              .slice(0, Math.min(perFile, nonEmpty.length))
          : shuffle(nonEmpty).slice(0, Math.min(perFile, nonEmpty.length));
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

    const baseContextText = parts.join("\n").slice(0, 16000).trim();
    if (!baseContextText) {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Ingen kontekst fundet (doc_chunks). Tjek at upload/parse er kørt.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
    }

    const model = resolveModelForFeature("simulator");
    const promptTopic = pickedFiles.map((file) => fileTitle(file)).join(" | ");
    const sharedSubjectCandidates = [promptTopic, ...pickedFiles.map((file) => fileTitle(file))];
    const resolvedSharedSubjectFamily =
      resolveTrainerSubjectFamilyFromCandidates(sharedSubjectCandidates) ??
      inferTrainerGenerateSharedSubjectFamily(`${promptTopic}\n${baseContextText}`);
    const sharedGenerateSubjectConfig = resolveTrainerGenerateSharedSubjectConfig({
      resolvedSubjectFamily: resolvedSharedSubjectFamily,
      candidates: sharedSubjectCandidates,
    });
    const sharedGeneratePromptBlock = sharedGenerateSubjectConfig?.promptAddendum ?? "";

    const avoidBlock =
      avoidQuestions.length > 0
        ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${avoidQuestions.join("\n- ")}\n`
        : "";
    let finalBiasApplied = false;

    const systemPrompt = `
Du skriver skriftlige eksamensspørgsmål på dansk.

KRAV:
- Spørgsmålene skal være varierede (redegør/analysér/diskutér/vurdér/argumentér).
- Spørgsmålene skal være tydeligt forankret i konteksten (DOKUMENT-afsnit).
- Ingen multiple choice.
- Ingen forklaringer udenfor JSON.
- Output SKAL være JSON og kun JSON.
${sharedGeneratePromptBlock}

FORMAT:
{"questions":[{"id":"q1","prompt":"..."},{"id":"q2","prompt":"..."}, ...]}
`.trim();

    let outQuestions: ExamQuestion[] = [];
    const generationAttemptDiagnostics: ExamGenerationAttemptDiagnostic[] = [];
    const weakestBiasAvailable = effectiveFocusMode === "weakest" && focusTargets.length > 0;
    const generationStrategies: Array<{
      key: ExamGenerationStrategyKey;
      focusMode: FocusMode;
      focusTargets: WeakPointTarget[];
      contextText: string;
      attempts: number;
    }> = weakestBiasAvailable
      ? [
          {
            key: "weakest_primary",
            focusMode: "weakest",
            focusTargets,
            contextText: truncateContextForQuestionPrompt(baseContextText, 13000),
            attempts: 2,
          },
          {
            key: "weakest_simplified",
            focusMode: "weakest",
            focusTargets: compactWeakPointTargetsForPrompt(focusTargets, 1),
            contextText: truncateContextForQuestionPrompt(baseContextText, 9000),
            attempts: 1,
          },
          {
            key: "normal_fallback",
            focusMode: "normal",
            focusTargets: [],
            contextText: truncateContextForQuestionPrompt(baseContextText, 13000),
            attempts: 1,
          },
        ]
      : [
          {
            key: "normal",
            focusMode: effectiveFocusMode,
            focusTargets,
            contextText: truncateContextForQuestionPrompt(baseContextText, 14000),
            attempts: 2,
          },
        ];

    generationLoop: for (const strategy of generationStrategies) {
      const strategyFocusBiasBlock =
        strategy.focusMode === "weakest" && strategy.focusTargets.length > 0
          ? [
              `Fokusér især på: ${strategy.focusTargets.map((t) => t.label).join(", ")}. Spørgsmålene skal træne disse områder.`,
              ...strategy.focusTargets
                .map((t) => (t.action ? `Hint - ${t.label}: ${t.action}` : ""))
                .filter(Boolean),
            ].join("\n")
          : "";
      const strategyBiasApplied = strategy.focusMode === "weakest" && strategy.focusTargets.length > 0;
      const strategyUserPrompt = [
        `Antal spørgsmål: ${count}`,
        `Sværhedsgrad: ${difficulty}`,
        `Fag/tema: ${promptTopic}`,
        strategyFocusBiasBlock,
        avoidBlock.trim(),
        "",
        "KONTEKST (brug dette som eneste grundlag):",
        "",
        strategy.contextText,
        "",
        "Lav nu spørgsmålene.",
      ]
        .filter(Boolean)
        .join("\n");

      for (let attempt = 0; attempt < strategy.attempts; attempt += 1) {
        const { completion } = await createChatCompletion(openai, {
          feature: "simulator",
          purpose: "json",
          modelOverride: model,
          payload: {
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: strategyUserPrompt },
            ],
            temperature: 0.9,
            top_p: 0.95,
          },
        });

        const raw = completion.choices[0]?.message?.content ?? "";
        const finishReason = completion.choices[0]?.finish_reason ?? null;
        const parsedOutput = parseQuestionListOutput(raw, finishReason);
        const cleaned: ExamQuestion[] = [];

        for (const promptValue of parsedOutput.questions) {
          const prompt = calibrateGeneratedQuestionForStudentLevel(String(promptValue ?? ""), {
            topic: promptTopic,
            contextText: strategy.contextText,
          }).trim();
          if (!prompt) continue;

          const norm = normalizeQuestion(prompt);
          if (avoidNorm.has(norm)) continue;
          if (cleaned.some((x) => normalizeQuestion(x.prompt) === norm)) continue;

          cleaned.push({ id: "tmp", prompt });
          if (cleaned.length >= count) break;
        }

        if (cleaned.length > 0) {
          outQuestions = cleaned;
          effectiveFocusMode = strategy.focusMode;
          finalPromptFocusTargets = strategy.focusTargets;
          finalBiasApplied = strategyBiasApplied;
          break generationLoop;
        }

        const rejectReason: ExamGenerationAttemptDiagnostic["rejectReason"] =
          parsedOutput.questions.length > 0 ? "filtered_out" : "content_missing";
        const diagnostic: ExamGenerationAttemptDiagnostic = {
          ...parsedOutput.diagnostics,
          strategy: strategy.key,
          attempt: attempt + 1,
          rejectReason,
        };
        generationAttemptDiagnostics.push(diagnostic);
        if (process.env.NODE_ENV !== "production") {
          console.warn("[exam/generate] invalid-model-output", {
            requestId,
            model,
            strategy: strategy.key,
            attempt: attempt + 1,
            finishReason,
            rawLength: diagnostic.rawLength,
            rawPreview: diagnostic.rawPreview,
            parseOk: diagnostic.parseOk,
            extractedFrom: diagnostic.extractedFrom,
            contentMissing: diagnostic.contentMissing,
            questionCount: diagnostic.questionCount,
            rejectReason,
          });
        }
      }
    }

    if (outQuestions.length === 0) {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Modellen returnerede tomt/ufuldstændigt output.",
        requestId,
        ...(process.env.NODE_ENV !== "production"
          ? {
              debug: {
                focusMode: effectiveFocusMode,
                attempts: generationAttemptDiagnostics.slice(-4),
              },
            }
          : {}),
      };
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
        focusMode: effectiveFocusMode,
        biasApplied: finalBiasApplied,
        focusTargets: finalPromptFocusTargets.map((t) => ({ key: t.key, label: t.label })),
        weakSessionCount,
        structuredFocusSessionCount,
        legacyFocusSessionCount,
      },
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[exam/generate] route error:", requestId, err);
    const out: ExamGenerateErr = { ok: false, error: err?.message ?? "Uventet fejl i exam/generate.", requestId };
    return NextResponse.json(out, { status: 500 });
  }
}
