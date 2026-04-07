// app/api/generate-question/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

import { captureException } from "@/lib/monitoring/error";
import { enforceRateLimit } from "@/lib/rateLimit";
import { quotaTryConsume } from "@/lib/quota/rpc";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { resolveModelForFeature } from "@/lib/openai/model";
import { createClient } from "@supabase/supabase-js";
import { parseSingleQuestionOutput, type QuestionOutputDiagnostics } from "@/lib/learning/question-output";
import { rankChunksForPrompt } from "@/lib/retrieval/structureAware";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { trackProductEvent } from "@/lib/server/trackProductEvent";
import { deriveFocusTargetsFromLearningSignals, type LearningFocusSessionRow } from "@/lib/learning/focus";
import {
  buildGenerateQuestionPrompts,
  clampInt,
  compactWeakPointTargetsForPrompt,
  fileTitle,
  pickDifficulty,
  pickFocusMode,
  scopeKeyFromFolderIds,
  truncateContextForQuestionPrompt,
  uniqTrimmed,
  type ChunkRow,
  type Difficulty,
  type FileRow,
  type FocusMode,
  type WeakPointTarget,
} from "@/lib/trainer/generate-question";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateQuestionRequest = {
  scopeFolderIds?: string[];
  difficulty?: Difficulty;
  maxContextChunks?: number;
  focusMode?: FocusMode;

  // anti-repeat
  avoidQuestions?: string[];
  avoidChunkIds?: string[];

  // tolerér legacy (ignoreres)
  folderId?: string | null;
  folder_id?: string | null;
};

type TrainerCitationPayload = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type GenerateQuestionOk = {
  ok: true;
  requestId: string;
  questionId: string;
  roundId: string; // ✅ vigtig
  question: string;
  citations: TrainerCitationPayload[];
  usedFileId: string | null;
  meta: {
    requestId: string;
    scopeKey: string;
    usedChunkIds: string[];
    usedFileTitle: string | null;
    model: string;
    maxContextChunks: number;
    difficulty: Difficulty;
    focusMode: FocusMode;
    biasApplied: boolean;
    focusTargets: Array<{ key: string; label: string }>;
    weakSessionCount: number;
    structuredFocusSessionCount?: number;
    legacyFocusSessionCount?: number;
  };
};

type GenerateQuestionErr = {
  ok: false;
  error: string;
  requestId: string;
  code?: string;
  feature?: string;
  plan?: string;
  usedThisMonth?: number;
  monthlyLimit?: number | null;
  monthStart?: string;
  monthEnd?: string;
  resetAt?: string;
  debug?: any;
};

type TrainerGenerationStrategyKey = "weakest_primary" | "weakest_simplified" | "normal_fallback" | "normal";

type TrainerGenerationAttemptDiagnostic = QuestionOutputDiagnostics & {
  strategy: TrainerGenerationStrategyKey;
  attempt: number;
  rejectReason: "content_missing" | "too_long";
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function nowMs() {
  return Date.now();
}

function approxTokensFromChars(chars: number) {
  return chars > 0 ? Math.max(1, Math.ceil(chars / 4)) : 0;
}

function normalizeQuestionOutput(value: string) {
  return String(value ?? "").normalize("NFC").replace(/\r\n/g, "\n").trim();
}

function isTooLongTrainerQuestion(value: string) {
  const text = normalizeQuestionOutput(value);
  const numberedParts = (text.match(/(?:^|\n)\s*\d+[.)]/g) ?? []).length;
  return text.length > 420 || numberedParts > 1;
}

function supabaseAdminOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getMonthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(resetAt.getTime() - 1);
  return { monthStart: start.toISOString(), resetAt: resetAt.toISOString(), monthEnd: monthEnd.toISOString() };
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

async function loadLastUsedFileId(db: any, ownerId: string, scopeKey: string): Promise<string | null> {
  if (!db) return null;
  try {
    const { data } = await db
      .from("generation_state")
      .select("last_used_file_id")
      .eq("owner_id", ownerId)
      .eq("kind", "trainer")
      .eq("scope_key", scopeKey)
      .maybeSingle();
    const v = (data as any)?.last_used_file_id;
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function saveLastUsedFileId(db: any, ownerId: string, scopeKey: string, fileId: string) {
  if (!db) return;
  try {
    await db.from("generation_state").upsert(
      {
        owner_id: ownerId,
        kind: "trainer",
        scope_key: scopeKey,
        last_used_file_id: fileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,kind,scope_key" },
    );
  } catch {
    // best effort
  }
}

/**
 * plan_limits semantics:
 * - undefined => mangler række i plan_limits (fejl i opsætning)
 * - null      => ∞
 * - number    => månedlig grænse
 */
async function getPlanAndLimit(db: any, ownerId: string) {
  const { data: profile } = await db.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
  const plan = (profile as any)?.plan ?? "freemium";

  const { data: limits } = await db.from("plan_limits").select("feature, monthly_limit, is_unlimited").eq("plan", plan);
  const row = (limits ?? []).find((r: any) => r.feature === "trainer_round");
  if (!row) return { plan, limit: undefined as number | null | undefined };
  if ((row as any).is_unlimited === true) return { plan, limit: null as number | null };

  const v = (row as any).monthly_limit;
  if (v == null) return { plan, limit: null as number | null };
  const n = Number(v);
  return { plan, limit: Number.isFinite(n) ? Math.round(n) : undefined };
}

async function countTrainerRoundsThisMonth(db: any, ownerId: string, monthStart: string, resetAt: string) {
  const tsCols = ["queued_at", "created_at", "inserted_at"] as const;

  for (const tsCol of tsCols) {
    const r = await db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", "trainer_round")
      .eq("status", "succeeded")
      .gte(tsCol, monthStart)
      .lt(tsCol, resetAt);

    if (!r.error && r.count != null) return r.count ?? 0;
  }
  return 0;
}

async function createTrainerRoundJob(db: any, ownerId: string, meta: any, payload: any) {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("jobs")
    .insert({
      owner_id: ownerId,
      kind: "trainer_round",
      status: "queued",
      queued_at: nowIso,
      started_at: nowIso,
      meta,
      payload,
    })
    .select("id")
    .maybeSingle();

  if (error || !(data as any)?.id) return null;
  return String((data as any).id);
}

async function finishTrainerRoundJob(db: any, ownerId: string, roundId: string, meta: any, payload: any) {
  const nowIso = new Date().toISOString();
  try {
    await db
      .from("jobs")
      .update({
        status: "succeeded",
        finished_at: nowIso,
        updated_at: nowIso,
        meta,
        payload,
      })
      .eq("owner_id", ownerId)
      .eq("id", roundId)
      .eq("kind", "trainer_round");
  } catch {
    // ignore
  }
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = nowMs();
  let ownerId = "";
  let primaryFolderId: string | null = null;
  let generatedFileId: string | null = null;
  let responseStatus = 500;
  let responseError: string | null = null;
  let outcome: "ok" | "error" = "error";
  let scopeKey = "all";
  let scopeFolderIds: string[] = [];
  let effectiveFocusMode: FocusMode = "normal";
  let modelForDiagnostics: string | null = null;
  let usedFileTitle: string | null = null;
  let weakSessionCount = 0;
  let structuredFocusSessionCount = 0;
  let legacyFocusSessionCount = 0;
  let generationStrategyUsed: TrainerGenerationStrategyKey | null = null;
  let generationFallbackUsed = false;
  let finalPromptFocusTargets: WeakPointTarget[] = [];
  const metrics = {
    authSessionMs: 0,
    ensureProfileMs: 0,
    quotaMs: 0,
    retrievalMs: 0,
    promptBuildMs: 0,
    openAiMs: 0,
    parsingMs: 0,
    dbSaveMs: 0,
    trackEventMs: 0,
    selectedChunkCount: 0,
    contextChars: 0,
    fileCandidatesScanned: 0,
    docChunkQueries: 0,
    openAiAttempts: 0,
  };
  const generationAttemptDiagnostics: TrainerGenerationAttemptDiagnostic[] = [];

  const respond = <T extends Record<string, unknown>>(body: T, status: number) => {
    responseStatus = status;
    outcome = status < 400 ? "ok" : "error";
    responseError = typeof body.error === "string" ? body.error : null;
    const payload = body.requestId ? body : { ...body, requestId };
    return NextResponse.json(payload, { status });
  };

  try {
    if (!process.env.OPENAI_API_KEY) {
      const err: GenerateQuestionErr = { ok: false, error: "OPENAI_API_KEY mangler i .env.local.", requestId };
      return respond(err, 500);
    }

    const parsed = await readJsonBody<GenerateQuestionRequest>(req);
    if (!parsed.ok) {
      const err: GenerateQuestionErr = { ok: false, error: parsed.error, requestId };
      return respond(err, 400);
    }

    const body = parsed.value ?? {};
    const difficulty = pickDifficulty(body.difficulty);
    const maxContextChunks = clampInt(body.maxContextChunks, 4, 32, 10);
    const requestedFocusMode = pickFocusMode(body.focusMode);

    scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    scopeKey = scopeKeyFromFolderIds(scopeFolderIds);
    const explicitFolderId = String(body.folderId ?? body.folder_id ?? "").trim();
    primaryFolderId = explicitFolderId || scopeFolderIds[0] || null;

    effectiveFocusMode = requestedFocusMode;
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

    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 24);
    const avoidChunkIds = uniqTrimmed(body.avoidChunkIds).slice(0, 500);
    const avoidChunkSet = new Set<string>(avoidChunkIds);

    const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
    const hasCookieHeader = cookieNames.length > 0;
    const hasSbAuthCookie = cookieNames.some((name) => name.includes("auth-token"));
    const hasVercelJwtCookie = cookieNames.some((name) => name.toLowerCase().includes("vercel") && name.toLowerCase().includes("jwt"));

    // Auth
    const authStartedAt = nowMs();
    try {
      const sbAuth = await supabaseServerRoute();
      const { data: sessionData, error: sessionError } = await sbAuth.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

      let resolvedUserId = sessionUserId;
      let getUserError: string | null = null;

      if (!resolvedUserId) {
        const { data: authData, error: authError } = await sbAuth.auth.getUser();
        getUserError = authError?.message ?? null;
        resolvedUserId = authData?.user?.id ? String(authData.user.id) : null;
      }

      if (!resolvedUserId) {
        const err: GenerateQuestionErr = {
          ok: false,
          error: "Unauthorized",
          requestId,
          ...(process.env.VERCEL_ENV === "preview"
            ? {
                debug: {
                  vercelEnv: process.env.VERCEL_ENV ?? null,
                  hasCookieHeader,
                  cookieNames,
                  hasSbAuthCookie,
                  hasVercelJwtCookie,
                  sessionError: sessionError?.message ?? null,
                  hasSession: !!sessionData?.session,
                  sessionUserId,
                  getUserError,
                  userId: resolvedUserId,
                },
              }
            : {}),
        };
        return respond(err, 401);
      }
      ownerId = resolvedUserId;
    } catch (error: any) {
      const err: GenerateQuestionErr = {
        ok: false,
        error: "Unauthorized",
        requestId,
        ...(process.env.VERCEL_ENV === "preview"
          ? {
              debug: {
                vercelEnv: process.env.VERCEL_ENV ?? null,
                hasCookieHeader,
                cookieNames,
                hasSbAuthCookie,
                hasVercelJwtCookie,
                getUserError: error?.message ?? null,
                userId: null,
              },
            }
          : {}),
      };
      return respond(err, 401);
    } finally {
      metrics.authSessionMs += nowMs() - authStartedAt;
    }

    // Rate-limit (fail-open)
    try {
      const rl = await enforceRateLimit(
        ownerId,
        "trainer_generate",
        { limit: 6, windowSeconds: 60, minIntervalMs: 4000 },
        "Generér nyt spørgsmål",
      );
      if (!rl.ok) {
        const err: GenerateQuestionErr = { ok: false, error: rl.message, requestId, code: "RATE_LIMIT" };
        return respond(err, rl.status);
      }
    } catch {
      // ignore
    }

    const admin = supabaseAdminOrNull();
    if (!admin) {
      const err: GenerateQuestionErr = {
        ok: false,
        error: "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kræves til trainer-route).",
        requestId,
      };
      return respond(err, 500);
    }

    const ensureProfileStartedAt = nowMs();
    await ensureProfile(admin, ownerId);
    metrics.ensureProfileMs += nowMs() - ensureProfileStartedAt;

    // Quota gate (trainer_round)
    const quotaStartedAt = nowMs();
    const q = await quotaTryConsume({
      admin,
      ownerId,
      feature: "trainer_round",
      amount: 1,
      exceededMessage: "Du har brugt alle Træner-runder for denne måned på din nuværende plan.",
    });
    if (!q.ok) {
      try {
        const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(new Date());
        const { plan } = await getPlanAndLimit(admin, ownerId);
        const limit = q.limitPerMonth;
        const used = typeof q.used === "number" ? q.used : await countTrainerRoundsThisMonth(admin, ownerId, monthStart, resetAt);

        const err: GenerateQuestionErr = {
          ok: false,
          error: q.message,
          requestId,
          code: q.status === 503 ? "SETUP_ERROR" : "QUOTA_EXCEEDED",
          feature: "trainer_round",
          plan,
          usedThisMonth: used,
          monthlyLimit: limit ?? null,
          monthStart,
          monthEnd,
          resetAt,
        };
        return respond(err, q.status);
      } catch {
        const err: GenerateQuestionErr = {
          ok: false,
          error: q.message,
          requestId,
          code: q.status === 503 ? "SETUP_ERROR" : "QUOTA_EXCEEDED",
          feature: "trainer_round",
        };
        return respond(err, q.status);
      }
    }
    metrics.quotaMs += nowMs() - quotaStartedAt;

    const retrievalStartedAt = nowMs();
    // Topic (første mappe-navn hvis muligt)
    const topicPromise =
      scopeFolderIds.length > 0
        ? admin
            .from("folders")
            .select("name")
            .eq("owner_id", ownerId)
            .eq("id", scopeFolderIds[0])
            .maybeSingle()
        : Promise.resolve({ data: null });

    const weakRowsPromise =
      effectiveFocusMode === "weakest" && focusScopeFolderId
        ? admin
            .from("exam_sessions")
            .select("created_at,metadata,meta,source_type,score")
            .eq("owner_id", ownerId)
            .eq("folder_id", focusScopeFolderId)
            .in("source_type", ["trainer", "simulator", "oral"])
            .order("created_at", { ascending: false })
            .limit(40)
        : Promise.resolve({ data: null });

    // Filer i scope
    let filesQ = admin
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const [topicResult, weakRowsResult, filesResult, lastUsed] = await Promise.all([
      topicPromise,
      weakRowsPromise,
      filesQ,
      loadLastUsedFileId(admin, ownerId, scopeKey),
    ]);

    let topic = "pensum";
    if ((topicResult as any)?.data?.name) {
      topic = String((topicResult as any).data.name);
    }

    if (effectiveFocusMode === "weakest" && focusScopeFolderId) {
      const weakRowsArr = (((weakRowsResult as any)?.data ?? []) as LearningFocusSessionRow[]);
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

    const { data: files } = filesResult as any;
    const fileRows = (files ?? []) as FileRow[];
    if (fileRows.length === 0) {
      const err: GenerateQuestionErr = {
        ok: false,
        error: "Ingen filer fundet i scope. Upload materiale først.",
        requestId,
        debug: { scopeFolderIds },
      };
      return respond(err, 400);
    }

    // Fil-rotation
    let start = 0;
    if (lastUsed) {
      const idx = fileRows.findIndex((f) => String(f.id) === String(lastUsed));
      if (idx >= 0) start = (idx + 1) % fileRows.length;
    } else {
      start = Math.floor(Math.random() * fileRows.length);
    }
    const rotated = [...fileRows.slice(start), ...fileRows.slice(0, start)];

    // Vælg file + chunks (respekter avoidChunkIds)
    const scanMax = Math.min(30, rotated.length);
    const perFilePool = 300;

    let chosenFile: FileRow | null = null;
    let pickedChunks: ChunkRow[] = [];

    let fallbackFile: FileRow | null = null;
    let fallbackChunks: ChunkRow[] = [];

    for (const f of rotated.slice(0, scanMax)) {
      metrics.fileCandidatesScanned += 1;
      const fileId = String(f.id);

      metrics.docChunkQueries += 1;
      const { data: pool } = await admin
        .from("doc_chunks")
        .select("id,file_id,content,created_at,source_url,extraction_method,extraction_quality,page_from")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(perFilePool);

      const poolRows = (pool ?? []) as ChunkRow[];
      const nonEmpty = poolRows.filter((r) => (r.content ?? "").trim().length > 0);
      if (nonEmpty.length === 0) continue;

      if (!fallbackFile) {
        const rankedFallback = rankChunksForPrompt(nonEmpty, topic);
        fallbackFile = f;
        fallbackChunks = rankedFallback
          .slice(0, Math.min(maxContextChunks * 2, rankedFallback.length))
          .map((r) => r.chunk)
          .slice(0, Math.min(maxContextChunks, nonEmpty.length))
          .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));
      }

      const filtered = nonEmpty.filter((r) => !avoidChunkSet.has(String(r.id)));
      const candidate = filtered.length > 0 ? filtered : null;
      if (!candidate) continue;

      const queryForRanking = [
        topic,
        difficulty,
        ...focusTargets.flatMap((t) => [t.label, t.action ?? ""]).filter(Boolean),
      ].join(" ");
      const rankedCandidate = rankChunksForPrompt(candidate, queryForRanking);
      chosenFile = f;
      pickedChunks = rankedCandidate
        .slice(0, Math.min(maxContextChunks * 2, rankedCandidate.length))
        .map((r) => r.chunk)
        .slice(0, Math.min(maxContextChunks, candidate.length))
        .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));

      break;
    }

    if (!chosenFile || pickedChunks.length === 0) {
      chosenFile = fallbackFile;
      pickedChunks = fallbackChunks;
    }

    if (!chosenFile || pickedChunks.length === 0) {
      const err: GenerateQuestionErr = {
        ok: false,
        error: "Ingen kontekst fundet (doc_chunks). Tjek at upload/parse er kørt.",
        requestId,
        debug: { scopeFolderIds },
      };
      return respond(err, 400);
    }

    const usedFileId = String(chosenFile.id);
    generatedFileId = usedFileId;
    usedFileTitle = fileTitle(chosenFile);

    const baseContextText = pickedChunks
      .map((c) => `KILDE: ${usedFileTitle}\n\n${(c.content ?? "").trim()}`)
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, 11000);

    if (!baseContextText.trim()) {
      const err: GenerateQuestionErr = { ok: false, error: "Kontekst blev tom efter filtrering.", requestId };
      return respond(err, 400);
    }
    metrics.retrievalMs += nowMs() - retrievalStartedAt;
    metrics.selectedChunkCount = pickedChunks.length;
    metrics.contextChars = baseContextText.length;

    const citations: TrainerCitationPayload[] = pickedChunks.map((c) => ({
      chunkId: String(c.id),
      fileId: usedFileId,
      title: usedFileTitle,
      url: (c as any)?.source_url ? String((c as any).source_url) : null,
    }));

    modelForDiagnostics = resolveModelForFeature("generate_question");

    let finalQuestion = "";
    let finalBiasApplied = false;

    const weakestBiasAvailable = effectiveFocusMode === "weakest" && focusTargets.length > 0;
    const generationStrategies: Array<{
      key: TrainerGenerationStrategyKey;
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
            contextText: truncateContextForQuestionPrompt(baseContextText, 9000),
            attempts: 2,
          },
          {
            key: "weakest_simplified",
            focusMode: "weakest",
            focusTargets: compactWeakPointTargetsForPrompt(focusTargets, 1),
            contextText: truncateContextForQuestionPrompt(baseContextText, 6200),
            attempts: 1,
          },
          {
            key: "normal_fallback",
            focusMode: "normal",
            focusTargets: [],
            contextText: truncateContextForQuestionPrompt(baseContextText, 9000),
            attempts: 1,
          },
        ]
      : [
          {
            key: "normal",
            focusMode: effectiveFocusMode,
            focusTargets,
            contextText: truncateContextForQuestionPrompt(baseContextText, 10000),
            attempts: 3,
          },
        ];

    generationLoop: for (const strategy of generationStrategies) {
      const promptBuildStartedAt = nowMs();
      const { systemPrompt, userPrompt, biasApplied } = buildGenerateQuestionPrompts({
        topic,
        difficulty,
        effectiveFocusMode: strategy.focusMode,
        focusTargets: strategy.focusTargets,
        avoidQuestions,
        usedFileTitle,
        contextText: strategy.contextText,
      });
      metrics.promptBuildMs += nowMs() - promptBuildStartedAt;

      for (let attempt = 0; attempt < strategy.attempts; attempt += 1) {
        metrics.openAiAttempts += 1;
        metrics.contextChars = strategy.contextText.length;
        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userPrompt },
        ];

        const openAiStartedAt = nowMs();
        const { completion } = await createChatCompletion(openai, {
          feature: "generate_question",
          purpose: "json",
          modelOverride: modelForDiagnostics,
          payload: {
            response_format: { type: "json_object" as const },
            messages,
          },
        });
        metrics.openAiMs += nowMs() - openAiStartedAt;

        const parseStartedAt = nowMs();
        const raw = completion.choices?.[0]?.message?.content ?? "";
        const finishReason = completion.choices?.[0]?.finish_reason ?? null;
        const parsedOutput = parseSingleQuestionOutput(raw, finishReason);
        const qText = normalizeQuestionOutput(parsedOutput.question);
        const rejectReason: TrainerGenerationAttemptDiagnostic["rejectReason"] | null = !qText
          ? "content_missing"
          : isTooLongTrainerQuestion(qText)
            ? "too_long"
            : null;
        metrics.parsingMs += nowMs() - parseStartedAt;

        if (rejectReason) {
          const diagnostic: TrainerGenerationAttemptDiagnostic = {
            ...parsedOutput.diagnostics,
            strategy: strategy.key,
            attempt: attempt + 1,
            rejectReason,
          };
          generationAttemptDiagnostics.push(diagnostic);
          if (process.env.NODE_ENV !== "production") {
            console.warn("[generate-question] invalid-model-output", {
              requestId,
              model: modelForDiagnostics,
              strategy: strategy.key,
              attempt: attempt + 1,
              finishReason,
              rawLength: diagnostic.rawLength,
              rawPreview: diagnostic.rawPreview,
              parseOk: diagnostic.parseOk,
              extractedFrom: diagnostic.extractedFrom,
              contentMissing: diagnostic.contentMissing,
              questionLength: diagnostic.questionLength,
              rejectReason,
            });
          }
          continue;
        }

        finalQuestion = qText;
        finalBiasApplied = biasApplied;
        generationStrategyUsed = strategy.key;
        generationFallbackUsed = strategy.key === "weakest_simplified" || strategy.key === "normal_fallback";
        effectiveFocusMode = strategy.focusMode;
        finalPromptFocusTargets = strategy.focusTargets;
        break generationLoop;
      }
    }

    if (!finalQuestion) {
      const err: GenerateQuestionErr = {
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
      return respond(err, 500);
    }

    // Gem rotation
    const dbSaveStartedAt = nowMs();
    await saveLastUsedFileId(admin, ownerId, scopeKey, usedFileId);

    const usedChunkIds = pickedChunks.map((c) => String(c.id));

    // ✅ Opret runde (jobs-row) og returnér roundId til /api/evaluate
    const baseMeta = {
      requestId,
      scopeFolderIds,
      scopeKey,
      difficulty,
      model: modelForDiagnostics,
      usedFileId,
      usedFileTitle,
      usedChunkIds,
      maxContextChunks,
      citationCount: citations.length,
      evals_used: 0,
      max_evals: 2,
      focusMode: effectiveFocusMode,
      focusTargets: finalPromptFocusTargets,
    };

    const basePayload = {
      source: "generate-question",
      question: finalQuestion,
      citations,
    };

    const roundId = await createTrainerRoundJob(admin, ownerId, baseMeta, basePayload);
    if (!roundId) {
      const err: GenerateQuestionErr = {
        ok: false,
        error: "Kunne ikke oprette runde (jobs).",
        requestId,
      };
      return respond(err, 500);
    }

    // Marker succeeded (så månedstæller kan bruge status=succeeded)
    await finishTrainerRoundJob(admin, ownerId, roundId, baseMeta, basePayload);
    metrics.dbSaveMs += nowMs() - dbSaveStartedAt;

    const resp: GenerateQuestionOk = {
      ok: true,
      requestId,
      questionId: randomUUID(),
      roundId,
      question: finalQuestion,
      citations,
      usedFileId,
      meta: {
        requestId,
        scopeKey,
        usedChunkIds,
        usedFileTitle,
        model: modelForDiagnostics,
        maxContextChunks,
        difficulty,
        focusMode: effectiveFocusMode,
        biasApplied: finalBiasApplied,
        focusTargets: finalPromptFocusTargets.map((t) => ({ key: t.key, label: t.label })),
        weakSessionCount,
        structuredFocusSessionCount,
        legacyFocusSessionCount,
      },
    };

    const trackEventStartedAt = nowMs();
    await trackProductEvent({
      admin,
      ownerId,
      eventName: "trainer_question_generated",
      metadata: {
        source: "own",
        folder_id: scopeFolderIds.length === 1 ? scopeFolderIds[0] : null,
        file_id: usedFileId,
        scope: scopeKey,
        feature: "trainer",
      },
    });
    metrics.trackEventMs += nowMs() - trackEventStartedAt;

    return respond(resp, 200);
  } catch (err: any) {
    console.error("[generate-question] route error:", requestId, err);
    responseError = err?.message ?? "Uventet fejl i generate-question.";
    captureException(err, {
      flow: "trainer_generate_question",
      route: "/api/generate-question",
      ownerId: ownerId || null,
      folderId: primaryFolderId,
      fileId: generatedFileId,
      requestId,
      status: 500,
      code: "TRAINER_ROUTE_ERROR",
    });
    const out: GenerateQuestionErr = { ok: false, error: err?.message ?? "Uventet fejl i generate-question.", requestId };
    return respond(out, 500);
  } finally {
    const totalRequestMs = nowMs() - requestStartedAt;
    console.info("[generate-question] diagnostics", {
      requestId,
      outcome,
      status: responseStatus,
      scopeFolderIds,
      scopeKey,
      focusMode: effectiveFocusMode,
      weakSessionCount,
      generationStrategyUsed,
      generationFallbackUsed,
      usedFileId: generatedFileId,
      usedFileTitle,
      selectedChunkCount: metrics.selectedChunkCount,
      contextChars: metrics.contextChars,
      contextTokensApprox: approxTokensFromChars(metrics.contextChars),
      fileCandidatesScanned: metrics.fileCandidatesScanned,
      docChunkQueries: metrics.docChunkQueries,
      model: modelForDiagnostics,
      openAiAttempts: metrics.openAiAttempts,
      ...(process.env.NODE_ENV !== "production"
        ? {
            outputDiagnostics: generationAttemptDiagnostics.slice(-4),
          }
        : {}),
      stageTimingsMs: {
        authSession: metrics.authSessionMs,
        ensureProfile: metrics.ensureProfileMs,
        quota: metrics.quotaMs,
        retrieval: metrics.retrievalMs,
        promptBuild: metrics.promptBuildMs,
        model: metrics.openAiMs,
        parsingAndPostProcessing: metrics.parsingMs,
        dbSave: metrics.dbSaveMs,
        trackEvent: metrics.trackEventMs,
        total: totalRequestMs,
      },
      totalRequestMs,
      error: responseError,
    });
  }
}
