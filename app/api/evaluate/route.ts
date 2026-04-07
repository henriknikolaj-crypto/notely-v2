// app/api/evaluate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { ensureQuotaAndDecrement } from "@/lib/quota";
import { enforceRateLimit } from "@/lib/rateLimit";
import { type NotelyFlow } from "@/lib/openai/requireModel";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { resolveModelForFeature } from "@/lib/openai/model";
import {
  buildFeedbackV2,
  deriveWeakPointTargetsFromFeedbackV2,
  normalizeWeakPointTargets,
  type FeedbackV2,
} from "@/lib/learning/feedback";
import { buildDanskTrainerPromptAddendum, inferDanskTrainerTask } from "@/lib/dansk/evaluator";
import { resolveEvaluatorDefinition } from "@/lib/learning/evaluator-registry";
import { buildMatematikTrainerPromptAddendum, inferMatematikTrainerTask } from "@/lib/matematik/evaluator";
import { buildOkonomiTrainerPromptAddendum, inferOkonomiTrainerTask } from "@/lib/okonomi/evaluator";
import { quotaTryConsume, supabaseAdminOrNull } from "@/lib/quota/rpc";
import { rankChunksForPrompt } from "@/lib/retrieval/structureAware";
import { buildSamfundTrainerPromptAddendum, inferSamfundTrainerTask } from "@/lib/samfund/evaluator";
import { buildTrainerFeedbackText } from "@/lib/trainer/feedback";
import { scopeKeyFromFolderIds } from "@/lib/trainer/generate-question";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { trackProductEvent } from "@/lib/server/trackProductEvent";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function nowMs() {
  return Date.now();
}

function approxTokensFromChars(chars: number) {
  return chars > 0 ? Math.max(1, Math.ceil(chars / 4)) : 0;
}

const MAX_TRAINER_EVALS_PER_OWNER = 50;
const TRAINER_EVALS_PER_ROUND = 2;

type EvalRequest = {
  question: string;
  answer: string;
  includeBackground?: boolean;

  folder_id?: string | null;
  note_id?: string | null;

  /** Mapper fra venstre side / scope-tjekbokse */
  scopeFolderIds?: string[];

  /** Valgfrit: specifik kilde-fil til kontekst */
  file_id?: string | null;
  fileId?: string | null;

  /** Flow (nu/fremtid): trainer | simulator | oral */
  source_type?: NotelyFlow;
  sourceType?: NotelyFlow;

  /** ✅ Trainer-runde (evals er inkluderet i runden) */
  round_id?: string | null;
  roundId?: string | null;
};

type EvalJson = {
  score?: number | string;
  overall?: string;
  summary?: string;
  strengths?: unknown;
  improvements?: unknown;
  next_steps?: unknown;
  next_best_action?: unknown;
  issues?: unknown;
  task_coverage?: unknown;
  taskCoverage?: unknown;
  citations?: unknown;
  weak_points?: unknown;
  weakPoints?: unknown;
  feedback_v2?: unknown;
  feedbackV2?: unknown;
  learning_signals?: unknown;
  learningSignals?: unknown;
  meta?: { weak_points?: unknown; weakPoints?: unknown } | null;
  metadata?: { weak_points?: unknown; weakPoints?: unknown } | null;
  feedback_meta?: { weak_points?: unknown; weakPoints?: unknown } | null;
  evaluation_meta?: { weak_points?: unknown; weakPoints?: unknown } | null;
  feedback_structured?: { weak_points?: unknown; weakPoints?: unknown } | null;
};

type Citation = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

function ensureStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
      .filter(Boolean);
  }
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  const s = String(value ?? "").trim();
  return s ? [s] : [];
}

const TRAINER_SUMMARY_FALLBACK = "Overordnet et fint, men kort svar.";

type SummarySanitizationResult = {
  text: string;
  sanitized: boolean;
  reason: string | null;
};

type TrainerScoreCalibrationResult = {
  rawScore: number;
  normalizedScore: number;
  repaired: boolean;
  reason: string | null;
};

function hasTerminalSentence(text: string) {
  return /[.!?]["')\]]*\s*$/.test(text);
}

function findLastSentenceBoundary(text: string) {
  const matches = [...text.matchAll(/[.!?](?=(?:["')\]]|\s|$))/g)];
  if (!matches.length) return -1;
  const last = matches[matches.length - 1];
  return typeof last.index === "number" ? last.index + last[0].length : -1;
}

function looksLikeBrokenSentenceTail(text: string) {
  return /\b(og|eller|men|at|som|med|for|på|af|om|i|til|fra|et|en|den|det|de|der|dette|disse|bruge|anvende|bruger|anvender)\s*$/i.test(
    text,
  );
}

function sanitizeTrainerSummary(raw: unknown, fallback = TRAINER_SUMMARY_FALLBACK): SummarySanitizationResult {
  const original = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!original) return { text: fallback, sanitized: true, reason: "empty" };

  let text = original;
  let sanitized = false;
  let reason: string | null = null;

  if (/(?:\.{3,}|…)\s*$/.test(text)) {
    text = text.replace(/(?:\.{3,}|…)\s*$/g, "").trim();
    sanitized = true;
    reason = "trim_ellipsis";
  }

  if (!text) return { text: fallback, sanitized: true, reason: reason ?? "empty_after_trim" };

  if (/[,:;\-]\s*$/.test(text)) {
    text = text.replace(/[,:;\-]\s*$/g, "").trim();
    sanitized = true;
    reason = reason ?? "trim_dangling_punctuation";
  }

  if (!hasTerminalSentence(text)) {
    const lastBoundary = findLastSentenceBoundary(text);
    if (lastBoundary > 0 && lastBoundary < text.length) {
      text = text.slice(0, lastBoundary).trim();
      sanitized = true;
      reason = reason ?? "clip_to_last_sentence";
    } else if (looksLikeBrokenSentenceTail(text)) {
      text = "";
      sanitized = true;
      reason = reason ?? "drop_broken_tail";
    } else if (text.split(/\s+/).filter(Boolean).length >= 4) {
      text = `${text}.`;
      sanitized = true;
      reason = reason ?? "append_period";
    }
  }

  if (!text || text.length < 12 || looksLikeBrokenSentenceTail(text)) {
    return { text: fallback, sanitized: true, reason: reason ?? "fallback_summary" };
  }

  return { text, sanitized, reason };
}

function resolveTrainerEvaluator(question: string) {
  const okonomiTaskType = inferOkonomiTrainerTask(question);
  if (okonomiTaskType) {
    return {
      evaluator: resolveEvaluatorDefinition("trainer", {
        subject_family: "okonomi",
        task_type: okonomiTaskType,
        assessment_mode: "trainer",
      }),
      promptAddendum: buildOkonomiTrainerPromptAddendum(okonomiTaskType),
    };
  }

  const samfundTaskType = inferSamfundTrainerTask(question);
  if (samfundTaskType) {
    return {
      evaluator: resolveEvaluatorDefinition("trainer", {
        subject_family: "samfund",
        task_type: samfundTaskType,
        assessment_mode: "trainer",
      }),
      promptAddendum: buildSamfundTrainerPromptAddendum(samfundTaskType),
    };
  }

  const danskTaskType = inferDanskTrainerTask(question);
  if (danskTaskType) {
    return {
      evaluator: resolveEvaluatorDefinition("trainer", {
        subject_family: "dansk",
        task_type: danskTaskType,
        assessment_mode: "trainer",
      }),
      promptAddendum: buildDanskTrainerPromptAddendum(danskTaskType),
    };
  }

  const matematikTaskType = inferMatematikTrainerTask(question);
  if (matematikTaskType) {
    return {
      evaluator: resolveEvaluatorDefinition("trainer", {
        subject_family: "matematik",
        task_type: matematikTaskType,
        assessment_mode: "trainer",
      }),
      promptAddendum: buildMatematikTrainerPromptAddendum(matematikTaskType),
    };
  }

  return {
    evaluator: resolveEvaluatorDefinition("trainer"),
    promptAddendum: "",
  };
}

function inferTrainerScoreFloor(args: {
  summary: string;
  strengths: string[];
  signals: FeedbackV2;
}) {
  const summary = args.summary.toLowerCase();
  const highIssues = args.signals.issues.filter((issue) => issue.severity === "high").length;
  const mediumIssues = args.signals.issues.filter((issue) => issue.severity === "medium").length;
  const issueCount = args.signals.issues.length;
  const strengthsCount = args.strengths.length;

  const clearlyVeryWeak =
    /\b(meget mangelfuld|meget svag|utilstrækkelig|besvarer ikke|rammer ikke spørgsmålet|alvorlige mangler)\b/i.test(
      summary,
    );
  const clearlyAtLeastMiddling =
    /\b(godt svar|god besvarelse|fornuftigt|solidt|relevant|rammer spørgsmålet|dækker hovedpointen|middel)\b/i.test(
      summary,
    );

  if (clearlyVeryWeak) return 0;
  if (highIssues === 0 && mediumIssues === 0 && strengthsCount >= 2) return 70;
  if (highIssues === 0 && mediumIssues <= 1 && strengthsCount >= 2) return 70;
  if (highIssues === 0 && mediumIssues <= 2 && strengthsCount >= 1) return 55;
  if (highIssues === 0 && issueCount <= 3 && clearlyAtLeastMiddling) return 55;
  return 0;
}

function calibrateTrainerScore(rawScore: number, args: {
  summary: string;
  strengths: string[];
  signals: FeedbackV2;
}): TrainerScoreCalibrationResult {
  const normalizedRaw = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
  const inferredFloor = inferTrainerScoreFloor(args);
  const looksLikeTenScale = normalizedRaw > 0 && normalizedRaw <= 12;
  const isClearlyTooLow = inferredFloor > 0 && normalizedRaw < inferredFloor && normalizedRaw <= inferredFloor - 20;

  if (!isClearlyTooLow) {
    return {
      rawScore: normalizedRaw,
      normalizedScore: normalizedRaw,
      repaired: false,
      reason: null,
    };
  }

  if (looksLikeTenScale) {
    return {
      rawScore: normalizedRaw,
      normalizedScore: Math.min(100, Math.max(normalizedRaw * 10, inferredFloor)),
      repaired: true,
      reason: "trainer_low_score_looks_like_10_scale",
    };
  }

  return {
    rawScore: normalizedRaw,
    normalizedScore: inferredFloor,
    repaired: true,
    reason: "trainer_structured_feedback_floor",
  };
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

function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

function pickFlow(body: Partial<EvalRequest>): NotelyFlow {
  const flowRaw = (body.source_type ?? body.sourceType) as NotelyFlow | undefined;
  return flowRaw === "simulator" || flowRaw === "oral" ? flowRaw : "trainer";
}

function pickRoundId(body: Partial<EvalRequest>): string | null {
  const raw = (body.round_id ?? body.roundId) as string | null | undefined;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

async function loadTrainerRound(sb: any, ownerId: string, roundId: string): Promise<{ id: string; meta: any } | null> {
  try {
    const { data, error } = await sb
      .from("jobs")
      .select("id, meta")
      .eq("owner_id", ownerId)
      .eq("kind", "trainer_round")
      .eq("id", roundId)
      .maybeSingle();

    if (error || !data?.id) return null;
    return { id: String((data as any).id), meta: (data as any).meta ?? {} };
  } catch {
    return null;
  }
}

function n0(x: any) {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

async function bumpTrainerRoundEval(sb: any, ownerId: string, roundId: string, meta: any) {
  const evalsUsed = n0(meta?.evals_used);
  const maxEvals = n0(meta?.max_evals) > 0 ? n0(meta?.max_evals) : TRAINER_EVALS_PER_ROUND;

  const newMeta = {
    ...(meta ?? {}),
    evals_used: Math.min(maxEvals, evalsUsed + 1),
    max_evals: maxEvals,
    updated_at: new Date().toISOString(),
  };

  try {
    await sb
      .from("jobs")
      .update({ meta: newMeta, updated_at: new Date().toISOString() })
      .eq("owner_id", ownerId)
      .eq("kind", "trainer_round")
      .eq("id", roundId);
  } catch {
    // ignore
  }

  return newMeta;
}

/**
 * Byg kontekst til evaluering.
 *
 * Prioritet:
 * 1) Hvis body.file_id/fileId → brug KUN doc_chunks fra den fil (og returnér kun den kilde).
 * 2) Ellers: vælg ÉN tilfældig fil i scope (seneste 5 filer i mapperne) og brug kun dens doc_chunks.
 * 3) Fallback: ingen kontekst → tom streng og ingen kilder.
 */
async function buildContextForEvaluation(opts: {
  sb: any;
  ownerId: string;
  body: Partial<EvalRequest>;
  maxChars?: number;
}): Promise<{
  contextText: string;
  usedFileId: string | null;
  usedFolderId: string | null;
  chunkCount: number;
  citations: Citation[];
}> {
  const { sb, ownerId, body, maxChars = 8000 } = opts;

  type ChunkRow = {
    id: string;
    content: string | null;
    file_id: string | null;
    folder_id: string | null;
    created_at?: string | null;
    extraction_method?: string | null;
    extraction_quality?: string | null;
    page_from?: number | null;
  };

  type FileRow = {
    id: string;
    name: string | null;
    original_name: string | null;
    folder_id: string | null;
    created_at?: string | null;
  };

  const fileRaw = (body.file_id ?? body.fileId) as string | null | undefined;
  const explicitFileId = typeof fileRaw === "string" && fileRaw.trim().length > 0 ? fileRaw.trim() : null;

  const scopeFolderIds: string[] = Array.isArray(body.scopeFolderIds)
    ? body.scopeFolderIds
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
    : [];

  const fallbackFolder =
    typeof body.folder_id === "string" && body.folder_id.trim().length > 0 ? body.folder_id.trim() : null;

  const effectiveFolderIds: string[] =
    scopeFolderIds.length > 0 ? scopeFolderIds : fallbackFolder ? [fallbackFolder] : [];

  async function buildFromFileId(fileId: string): Promise<{
    text: string;
    folderId: string | null;
    chunkCount: number;
    citations: Citation[];
  }> {
    const { data: fileRow } = await sb
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .eq("id", fileId)
      .maybeSingle();

    const title = fileRow ? fileTitle(fileRow) : "Ukendt kilde";

    const { data: chunks, error } = await sb
      .from("doc_chunks")
      .select("id, content, file_id, folder_id, created_at, extraction_method, extraction_quality, page_from")
      .eq("owner_id", ownerId)
      .eq("file_id", fileId)
      .order("created_at", { ascending: true })
      .limit(80);

    if (error) {
      console.error("[evaluate] doc_chunks error (file):", error);
      return { text: "", folderId: (fileRow as any)?.folder_id ?? null, chunkCount: 0, citations: [] };
    }

    const rows: ChunkRow[] = (chunks ?? []) as ChunkRow[];
    const nonEmptyRows = rows.filter((r) => (r.content ?? "").trim().length > 0);
    const nonEmpty = nonEmptyRows.map((r) => (r.content ?? "").trim());

    if (!nonEmpty.length) return { text: "", folderId: (fileRow as any)?.folder_id ?? null, chunkCount: 0, citations: [] };

    const rankedRows = rankChunksForPrompt(nonEmptyRows, `${body.question ?? ""} ${body.answer ?? ""}`)
      .slice(0, Math.min(nonEmptyRows.length, 18))
      .map((r) => r.chunk)
      .sort((a, b) => (Date.parse(String(a.created_at ?? "0")) || 0) - (Date.parse(String(b.created_at ?? "0")) || 0));

    let text = rankedRows.map((r) => (r.content ?? "").trim()).join("\n\n---\n\n");
    if (text.length > maxChars) text = text.slice(0, maxChars);

    const firstChunkId = String(rankedRows[0]?.id ?? fileId);
    const citations: Citation[] = [
      {
        chunkId: firstChunkId,
        fileId,
        title,
        url: null,
      },
    ];

    return { text, folderId: (fileRow as any)?.folder_id ?? null, chunkCount: rankedRows.length, citations };
  }

  if (explicitFileId) {
    const r = await buildFromFileId(explicitFileId);
    return {
      contextText: r.text,
      usedFileId: explicitFileId,
      usedFolderId: r.folderId,
      chunkCount: r.chunkCount,
      citations: r.citations,
    };
  }

  let filesQuery = sb
    .from("files")
    .select("id, name, original_name, folder_id, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (effectiveFolderIds.length > 0) {
    filesQuery = filesQuery.in("folder_id", effectiveFolderIds);
  }

  const { data: fileRows, error: filesError } = await filesQuery;
  if (filesError) console.error("[evaluate] files error:", filesError);

  let filesInScope: FileRow[] = (fileRows ?? []) as FileRow[];

  if (!filesInScope.length && effectiveFolderIds.length > 0) {
    const { data: allFiles, error: allFilesErr } = await sb
      .from("files")
      .select("id, name, original_name, folder_id, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });

    if (allFilesErr) console.error("[evaluate] global files error:", allFilesErr);
    filesInScope = (allFiles ?? []) as FileRow[];
  }

  if (!filesInScope.length) return { contextText: "", usedFileId: null, usedFolderId: null, chunkCount: 0, citations: [] };

  const recentFiles = filesInScope.slice(0, Math.min(filesInScope.length, 5));
  const idx = Math.floor(Math.random() * recentFiles.length);
  const chosenFile = recentFiles[idx];

  const r = await buildFromFileId(String(chosenFile.id));
  return {
    contextText: r.text,
    usedFileId: String(chosenFile.id),
    usedFolderId: r.folderId ?? (chosenFile.folder_id ?? null),
    chunkCount: r.chunkCount,
    citations: r.citations,
  };
}

async function pruneTrainerHistory(sb: any, ownerId: string) {
  const { data, error } = await sb
    .from("exam_sessions")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .order("created_at", { ascending: false })
    .range(MAX_TRAINER_EVALS_PER_OWNER, MAX_TRAINER_EVALS_PER_OWNER + 300);

  if (error) {
    console.error("[evaluate] prune fetch error:", error);
    return;
  }

  const idsToDelete = (data ?? []).map((r: any) => r.id).filter(Boolean);
  if (!idsToDelete.length) return;

  const { error: delError } = await sb.from("exam_sessions").delete().eq("owner_id", ownerId).in("id", idsToDelete);
  if (delError) console.error("[evaluate] prune delete error:", delError);
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const requestStartedAt = nowMs();
  // til jobs-log i outer catch
  let sb: any = null;
  let ownerId = "";
  let jobId: string | null = null;
  let t0 = nowMs();
  let responseStatus = 500;
  let responseError: string | null = null;
  let outcome: "ok" | "error" = "error";
  let flowForDiagnostics: NotelyFlow = "trainer";
  let modelForDiagnostics: string | null = null;
  let scopeFolderIdsForDiagnostics: string[] = [];
  const metrics = {
    authSessionMs: 0,
    ensureProfileMs: 0,
    retrievalMs: 0,
    promptBuildMs: 0,
    openAiMs: 0,
    parsingMs: 0,
    dbSaveMs: 0,
    jobPersistMs: 0,
    trackEventMs: 0,
    contextChunkCount: 0,
    contextChars: 0,
  };
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
  const hasCookieHeader = cookieNames.length > 0;
  const hasSbAuthCookie = cookieNames.some((name) => name.includes("auth-token"));
  const hasVercelJwtCookie = cookieNames.some(
    (name) => name.toLowerCase().includes("vercel") && name.toLowerCase().includes("jwt"),
  );

  const respond = <T extends Record<string, unknown>>(body: T, status: number, headers?: HeadersInit) => {
    responseStatus = status;
    outcome = status < 400 ? "ok" : "error";
    responseError = typeof body.error === "string" ? body.error : null;
    const payload = body.requestId ? body : { ...body, requestId };
    return NextResponse.json(payload, { status, headers });
  };

  try {
    const parsed = await readJsonBody<Partial<EvalRequest>>(req);
    if (!parsed.ok) return respond({ ok: false, error: parsed.error }, 400);

    const body = parsed.value ?? {};
    const question = String((body as any).question ?? (body as any).prompt ?? "").trim();
    const answer = String(body.answer ?? "").trim();

    if (!question || !answer) {
      return respond({ ok: false, error: "Mangler question eller answer" }, 400);
    }

    if (!process.env.OPENAI_API_KEY) {
      return respond({ ok: false, error: "Missing OPENAI_API_KEY (required)" }, 500);
    }

    // Folder/note/scope normaliseres tidligt (bruges både i jobs + exam_sessions)
    const folderId = typeof body.folder_id === "string" && body.folder_id.trim() ? body.folder_id.trim() : null;
    const noteId = typeof body.note_id === "string" && body.note_id.trim() ? body.note_id.trim() : null;

    const scopeFolderIds = Array.isArray(body.scopeFolderIds)
      ? body.scopeFolderIds
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
      : [];
    scopeFolderIdsForDiagnostics = scopeFolderIds;

    const sessionFolderIds = scopeFolderIds.length > 0 ? scopeFolderIds : folderId ? [folderId] : [];
    const sessionFolderId = sessionFolderIds.length === 1 ? sessionFolderIds[0] : null;
    const sessionFolderIdsMeta = sessionFolderIds.length > 1 ? sessionFolderIds : undefined;

    const flow: NotelyFlow = pickFlow(body);
    flowForDiagnostics = flow;
    const roundId = pickRoundId(body);

    const includeBackgroundClient = !!body.includeBackground;
    const includeBackground = flow === "trainer" ? true : includeBackgroundClient;

    // Auth: session først, getUser kun som fallback
    const mode: "auth" | "dev" = "auth";
    const authStartedAt = nowMs();
    try {
      sb = await supabaseServerRoute();
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

      let userId = sessionUserId;
      let getUserError: string | null = null;

      if (!userId) {
        const { data: authData, error: authError } = await sb.auth.getUser();
        getUserError = authError?.message ?? null;
        userId = authData?.user?.id ? String(authData.user.id) : null;
      }

      if (!userId) {
        return respond(
          {
            ok: false,
            error: "Unauthorized",
            ...(process.env.VERCEL_ENV === "preview"
              ? {
                  debug: {
                    vercelEnv: process.env.VERCEL_ENV ?? null,
                    hasCookieHeader,
                    cookieNames,
                    hasSbAuthCookie,
                    hasVercelJwtCookie,
                    hasSession: !!sessionData?.session,
                    sessionUserId,
                    sessionError: sessionError?.message ?? null,
                    getUserError,
                    userId,
                  },
                }
              : {}),
          },
          401,
        );
      }

      ownerId = userId;
      t0 = nowMs();

      // Rate-limit (evaluate)
      const rl = await enforceRateLimit(
        ownerId,
        "evaluate",
        { limit: 6, windowSeconds: 60, minIntervalMs: 5000 },
        "Evaluer svar",
      );

      if (!rl.ok) {
        const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
        return respond(
          { ok: false, error: rl.message, retryAfterMs: rl.retryAfterMs },
          429,
          { "Retry-After": String(retryAfterSec) },
        );
      }
    } catch (e: any) {
      console.error("[evaluate] auth crash:", e);
      return respond(
        {
          ok: false,
          error: "Unauthorized",
          ...(process.env.VERCEL_ENV === "preview"
            ? {
                debug: {
                  vercelEnv: process.env.VERCEL_ENV ?? null,
                  hasCookieHeader,
                  cookieNames,
                  hasSbAuthCookie,
                  hasVercelJwtCookie,
                  hasSession: false,
                  sessionUserId: null,
                  sessionError: e?.message ?? null,
                  getUserError: e?.message ?? null,
                  userId: null,
                },
              }
            : {}),
        },
        401,
      );
    } finally {
      metrics.authSessionMs += nowMs() - authStartedAt;
    }

    const profileAdmin = supabaseAdminOrNull();
    if (profileAdmin) {
      const ensureProfileStartedAt = nowMs();
      try {
        await ensureProfile(profileAdmin, ownerId);
      } catch (profileError) {
        console.warn("[evaluate] ensureProfile warning:", profileError);
      } finally {
        metrics.ensureProfileMs += nowMs() - ensureProfileStartedAt;
      }
    } else {
      console.warn("[evaluate] ensureProfile skipped: missing service-role client");
    }
	
	    let model: string;
    try {
      model =
        flow === "trainer" || flow === "simulator"
          ? resolveModelForFeature("weakness")
          : resolveModelForFeature(flow);
    } catch (e: any) {
      return respond({ ok: false, error: e?.message ?? "Missing model env" }, 500);
    }
    modelForDiagnostics = model;

    // ✅ Trainer-runde gating (2 evals pr. runde) + ingen evaluate-quota for trainer
    let trainerRoundMeta: any = null;
    let shouldConsumeTrainerRound = false;
    if (flow === "trainer") {
      if (!roundId) {
        return respond(
          { ok: false, error: "Tryk “Generér nyt spørgsmål” først for at starte en runde." },
          400,
        );
      }

      const rr = await loadTrainerRound(sb, ownerId, roundId);
      if (!rr) {
        return respond(
          { ok: false, error: "Ugyldig runde. Generér et nyt spørgsmål for at starte en ny runde." },
          400,
        );
      }

      trainerRoundMeta = rr.meta ?? {};
      const evalsUsed = n0(trainerRoundMeta?.evals_used);
      const maxEvals = n0(trainerRoundMeta?.max_evals) > 0 ? n0(trainerRoundMeta?.max_evals) : TRAINER_EVALS_PER_ROUND;

      if (evalsUsed >= maxEvals) {
        return respond(
          { ok: false, error: "Denne runde er brugt op. Generér et nyt spørgsmål for at starte en ny runde." },
          402,
        );
      }

      shouldConsumeTrainerRound = evalsUsed === 0;
      if (shouldConsumeTrainerRound) {
        const quotaAdmin = supabaseAdminOrNull();
        if (!quotaAdmin) {
          return respond(
            { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kræves til quota)." },
            500,
          );
        }

        const quotaConsume = await quotaTryConsume({
          admin: quotaAdmin,
          ownerId,
          feature: "trainer_round",
          amount: 1,
          exceededMessage: "Du har nået din grænse for Træner-runder denne måned.",
        });

        if (!quotaConsume.ok) {
          if (quotaConsume.status === 503) {
            console.error("[evaluate] quota_try_consume error:", quotaConsume.raw);
          }
          return respond(
            {
              ok: false,
              error: quotaConsume.message,
              code: quotaConsume.status === 429 ? "QUOTA_EXCEEDED" : "QUOTA_CHECK_FAILED",
              feature: "trainer_round",
              usedThisMonth: quotaConsume.used,
              monthlyLimit: quotaConsume.limitPerMonth,
              resetAt: quotaConsume.resetAt,
            },
            quotaConsume.status,
          );
        }
      }
    } else {
      // Quota-check (kun for simulator/oral)
      const cost = 1;
      const quota = await ensureQuotaAndDecrement(ownerId, "evaluate", cost);
      if (!quota.ok) {
        console.warn("[/api/evaluate] quota exceeded:", quota.message);
        return respond({ ok: false, error: quota.message, feature: "evaluate" }, quota.status);
      }
    }

    // ✅ jobs-log: queued (+ queued_at denne måned)
    try {
      const nowIso = new Date().toISOString();
      const { data: jobRow, error: jobErr } = await sb
        .from("jobs")
        .insert({
          owner_id: ownerId,
          kind: "evaluate",
          status: "queued",
          queued_at: nowIso,
          started_at: nowIso,
          folder_id: sessionFolderId,
          file_id: null,
          meta: {
            flow,
            includeBackground,
            scopeFolderIds,
            ...(sessionFolderIdsMeta ? { folder_ids: sessionFolderIdsMeta } : {}),
            note_id: noteId,
            mode,
            round_id: flow === "trainer" ? roundId : null,
          },
        })
        .select("id")
        .maybeSingle();

      if (!jobErr && (jobRow as any)?.id) jobId = String((jobRow as any).id);
      if (jobErr) console.error("[evaluate] jobs insert error:", jobErr);
    } catch (e) {
      console.error("[evaluate] jobs insert crash:", e);
    }

    // Kontekst + citations (kun hvis includeBackground)
    let contextText = "";
    let usedFileId: string | null = null;
    let usedFolderId: string | null = null;
    let contextChunkCount = 0;
    let citations: Citation[] = [];

    if (includeBackground) {
      const retrievalStartedAt = nowMs();
      const ctx = await buildContextForEvaluation({ sb, ownerId, body, maxChars: 8000 });
      contextText = ctx.contextText;
      usedFileId = ctx.usedFileId;
      usedFolderId = ctx.usedFolderId;
      contextChunkCount = ctx.chunkCount;
      citations = ctx.citations;
      metrics.retrievalMs += nowMs() - retrievalStartedAt;
      metrics.contextChunkCount = contextChunkCount;
      metrics.contextChars = contextText.length;

      if (jobId) {
        try {
          await sb
            .from("jobs")
            .update({
              file_id: usedFileId,
              meta: {
                flow,
                includeBackground,
                scopeFolderIds,
                ...(sessionFolderIdsMeta ? { folder_ids: sessionFolderIdsMeta } : {}),
                note_id: noteId,
                file_id: usedFileId,
                contextChunkCount,
                mode,
                round_id: flow === "trainer" ? roundId : null,
              },
              updated_at: new Date().toISOString(),
            })
            .eq("owner_id", ownerId)
            .eq("id", jobId);
        } catch {
          // ignore
        }
      }
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const promptBuildStartedAt = nowMs();
    const trainerEvaluatorResolution = flow === "trainer" ? resolveTrainerEvaluator(question) : null;
    const evaluator = trainerEvaluatorResolution?.evaluator ?? resolveEvaluatorDefinition(flow);
    const trainerPromptAddendum =
      flow === "trainer"
        ? [
            "",
            "Trainer-stabilisering:",
            '- "score" er ALTID en procentscore fra 0 til 100. Det er IKKE 10-skala, IKKE 7-trins-skala og IKKE et punkttal ud af 10.',
            "- Brug disse ankre for score:",
            "  - 85-100 = meget staerkt svar",
            "  - 70-84 = godt svar med mindre mangler",
            "  - 55-69 = nogenlunde / middel",
            "  - 35-54 = svagt men delvist daekkende",
            "  - 0-34 = meget mangelfuldt",
            "- Ingen ellipser.",
            "- Ingen afbrudte saetninger.",
            "- Alle tekstfelter skal vaere hele, afsluttede saetninger.",
            trainerEvaluatorResolution?.promptAddendum ?? "",
          ].join("\n")
        : "";
    const systemPrompt = `
Du er faglig evaluator for Notely.

Evaluator-kontrakt:
- subject_family = "${evaluator.subject_family}"
- task_type = "${evaluator.task_type}"
- assessment_mode = "${evaluator.assessment_mode}"

Du får:
- et eksamensspørgsmål ("question")
- et elevsvar ("answer")
- og evt. baggrundsmateriale ("context") fra elevens eget pensum

Hvis "context" er tomt, skal du stadig vurdere spørgsmålet og svaret fagligt.
Flyt vurderingen over i struktureret læringsfeedback. Vær konkret, handlingsrettet og kortfattet.

Du SKAL svare som gyldigt JSON med disse felter:
{
  "score": number,
  "overall": string,
  "summary": string,
  "subject_family": string,
  "task_type": string,
  "assessment_mode": string,
  "strengths": string[],
  "improvements": string[],
  "next_steps": string[],
  "next_best_action": string,
  "issues": [
    {
      "code": string,
      "category": string,
      "severity": "low" | "medium" | "high",
      "title": string,
      "diagnosis": string,
      "why_it_matters": string,
      "evidence": string[],
      "repair": string,
      "example": string
    }
  ],
  "weak_points": [{ "key": string, "label": string, "action"?: string }],
  "task_coverage": {
    "summary": string
  },
  "citations": [
    {
      "chunk_id": string,
      "title": string,
      "why": string
    }
  ]
}

Krav:
- strengths, improvements og next_steps skal have mindst 1 element.
- next_best_action skal være ét konkret næste skridt.
- issues skal have 1-4 elementer med læringsværdi. Brug tomt array kun hvis svaret reelt er uden tydelige mangler.
- weak_points må gerne afledes af issues, men skal være korte.
- Brug kun citations/task_coverage hvis det er relevant.
- Ingen tekst uden for JSON-objektet.
${trainerPromptAddendum}
`.trim();

    const userPayload = { question, answer, context: contextText };
    metrics.promptBuildMs += nowMs() - promptBuildStartedAt;

    const openAiStartedAt = nowMs();
    const { completion } = await createChatCompletion(openai, {
      feature: flow === "trainer" || flow === "simulator" ? "weakness" : flow,
      purpose: "json",
      modelOverride: model,
      payload: {
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      },
    });
    metrics.openAiMs += nowMs() - openAiStartedAt;

    const parseStartedAt = nowMs();
    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsedEval: EvalJson = {};
    try {
      parsedEval = JSON.parse(raw) as EvalJson;
    } catch (e) {
      console.error("[evaluate] JSON-parse fejl på raw:", raw, e);
      parsedEval = {};
    }

    const scoreRaw = typeof parsedEval.score === "number" ? parsedEval.score : Number(parsedEval.score);
    const parsedScore = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 0;

    const rawOverall =
      (parsedEval.overall && String(parsedEval.overall).trim().replace(/\s+/g, " ")) ||
      (parsedEval.summary && String(parsedEval.summary).trim().replace(/\s+/g, " ")) ||
      TRAINER_SUMMARY_FALLBACK;
    const summarySanitization =
      flow === "trainer"
        ? sanitizeTrainerSummary(rawOverall, TRAINER_SUMMARY_FALLBACK)
        : { text: rawOverall, sanitized: false, reason: null as string | null };
    const overall = summarySanitization.text;

    let strengths = ensureStringArray(parsedEval.strengths);
    let improvements = ensureStringArray(parsedEval.improvements);
    let nextSteps = ensureStringArray(parsedEval.next_steps);
    const weakPointsRaw =
      parsedEval.weak_points ??
      parsedEval.weakPoints ??
      parsedEval.meta?.weak_points ??
      parsedEval.meta?.weakPoints ??
      parsedEval.metadata?.weak_points ??
      parsedEval.metadata?.weakPoints ??
      parsedEval.feedback_meta?.weak_points ??
      parsedEval.feedback_meta?.weakPoints ??
      parsedEval.evaluation_meta?.weak_points ??
      parsedEval.evaluation_meta?.weakPoints ??
      parsedEval.feedback_structured?.weak_points ??
      parsedEval.feedback_structured?.weakPoints;
    const normalizedWeakPoints = normalizeWeakPointTargets(weakPointsRaw);

    if (!strengths.length) strengths = ["Du rammer noget af kernen, men kan blive mere præcis."];
    if (!improvements.length) improvements = ["Uddyb centrale begreber og knyt dem tydeligere til spørgsmålet."];
    if (!nextSteps.length) nextSteps = ["Skriv et forbedret svar, hvor du bruger 2–3 nøglebegreber og et konkret eksempel."];

    const learningSignals = buildFeedbackV2({
      evaluator,
      sourceType: flow,
      raw:
        parsedEval.feedback_v2 ??
        parsedEval.feedbackV2 ??
        parsedEval.learning_signals ??
        parsedEval.learningSignals,
      summary: parsedEval.summary ?? parsedEval.overall,
      strengths,
      issues: parsedEval.issues,
      nextBestAction: parsedEval.next_best_action,
      taskCoverage: parsedEval.task_coverage ?? parsedEval.taskCoverage,
      citations: parsedEval.citations ?? citations,
      improvements,
      nextSteps,
      weakPoints: normalizedWeakPoints,
      fallbackSummary: overall,
      fallbackNextBestAction: nextSteps[0],
    });
    const structuredSummarySanitization =
      flow === "trainer"
        ? sanitizeTrainerSummary(learningSignals.summary, overall)
        : { text: learningSignals.summary, sanitized: false, reason: null as string | null };
    const stabilizedLearningSignals =
      structuredSummarySanitization.text !== learningSignals.summary
        ? { ...learningSignals, summary: structuredSummarySanitization.text }
        : learningSignals;
    const scoreCalibration =
      flow === "trainer"
        ? calibrateTrainerScore(parsedScore, {
            summary: stabilizedLearningSignals.summary,
            strengths: stabilizedLearningSignals.strengths,
            signals: stabilizedLearningSignals,
          })
        : {
            rawScore: parsedScore,
            normalizedScore: parsedScore,
            repaired: false,
            reason: null as string | null,
          };
    const score = scoreCalibration.normalizedScore;
    const backwardCompatibleWeakPoints =
      normalizedWeakPoints.length > 0
        ? normalizedWeakPoints
        : deriveWeakPointTargetsFromFeedbackV2(stabilizedLearningSignals);

    if (process.env.NODE_ENV !== "production" && flow === "trainer") {
      console.info("[evaluate][trainer][stability]", {
        requestId,
        evaluatorId: evaluator.id,
        subjectFamily: evaluator.subject_family,
        taskType: evaluator.task_type,
        rawScore: scoreCalibration.rawScore,
        normalizedScore: scoreCalibration.normalizedScore,
        scoreRepairApplied: scoreCalibration.repaired,
        scoreRepairReason: scoreCalibration.reason,
        summarySanitized: summarySanitization.sanitized || structuredSummarySanitization.sanitized,
        summarySanitizationReason: summarySanitization.reason ?? structuredSummarySanitization.reason,
      });
    }

    const feedbackText = buildTrainerFeedbackText({
      overall: stabilizedLearningSignals.summary || overall,
      strengths: stabilizedLearningSignals.strengths,
      improvements,
      nextSteps,
    });
    metrics.parsingMs += nowMs() - parseStartedAt;

    // ✅ bump evals_used på runden (LLM-kald er gennemført)
    const dbSaveStartedAt = nowMs();
    if (flow === "trainer" && roundId) {
      const baseMeta = trainerRoundMeta ?? {};
      await bumpTrainerRoundEval(sb, ownerId, roundId, baseMeta);
    }

    const sessionMeta = {
      includeBackground,
      scopeFolderIds,
      ...(sessionFolderIdsMeta ? { folder_ids: sessionFolderIdsMeta } : {}),
      note_id: noteId,
      file_id: usedFileId,
      contextChunkCount,
      contextPreview: contextText ? contextText.slice(0, 400) : null,
      citations,
      mode,
      round_id: flow === "trainer" ? roundId : null,
      weak_points: backwardCompatibleWeakPoints,
      feedback_v2: stabilizedLearningSignals,
      learning_signals: stabilizedLearningSignals,
    };

    const resolvedTrackingFolderId = usedFolderId ?? sessionFolderId;
    const resolvedTrackingScopeIds =
      scopeFolderIds.length > 0 ? scopeFolderIds : resolvedTrackingFolderId ? [resolvedTrackingFolderId] : [];
    const resolvedTrackingScope = resolvedTrackingScopeIds.length > 0 ? scopeKeyFromFolderIds(resolvedTrackingScopeIds) : null;

    const insertPayload = {
      owner_id: ownerId,
      question,
      answer,
      feedback: feedbackText,
      score,
      folder_id: sessionFolderId,
      source_type: flow,
      meta: sessionMeta,
      metadata: sessionMeta,
    };

    const { error: insertError } = await sb.from("exam_sessions").insert(insertPayload);
    if (insertError) console.error("[evaluate] insert exam_sessions fejl:", insertError);

    if (!insertError && flow === "trainer") {
      void pruneTrainerHistory(sb, ownerId);
    }
    metrics.dbSaveMs += nowMs() - dbSaveStartedAt;

    // ✅ jobs-log: succeeded
    if (jobId) {
      const jobPersistStartedAt = nowMs();
      try {
        const tokensUsed = (completion as any)?.usage?.total_tokens ?? null;
        await sb
          .from("jobs")
          .update({
            status: "succeeded",
            finished_at: new Date().toISOString(),
            latency_ms: Math.max(0, nowMs() - t0),
            tokens_used: typeof tokensUsed === "number" ? tokensUsed : null,
            feedbackscore: score,
            result: { score, round_id: flow === "trainer" ? roundId : null },
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", ownerId)
          .eq("id", jobId);
      } catch (e) {
        console.error("[evaluate] jobs update (succeeded) error:", e);
      } finally {
        metrics.jobPersistMs += nowMs() - jobPersistStartedAt;
      }
    }

    if (flow === "trainer") {
      const trackEventStartedAt = nowMs();
      await trackProductEvent({
        ownerId,
        eventName: "trainer_answer_evaluated",
        metadata: {
          source: "own",
          folder_id: resolvedTrackingFolderId,
          file_id: usedFileId,
          scope: resolvedTrackingScope,
          feature: "trainer",
        },
      });
      metrics.trackEventMs += nowMs() - trackEventStartedAt;
    }

    return respond(
      {
        ok: true,
        requestId,
        score,
        feedback: feedbackText,
        feedback_v2: stabilizedLearningSignals,
        learning_signals: stabilizedLearningSignals,
        weak_points: backwardCompatibleWeakPoints,
        usedFileId,
        citations,
      },
      200,
    );
  } catch (err: any) {
    // ✅ jobs-log: failed
    if (sb && ownerId && jobId) {
      const jobPersistStartedAt = nowMs();
      try {
        await sb
          .from("jobs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            latency_ms: Math.max(0, nowMs() - t0),
            error_message: String(err?.message ?? "failed"),
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", ownerId)
          .eq("id", jobId);
      } catch {
        // ignore
      } finally {
        metrics.jobPersistMs += nowMs() - jobPersistStartedAt;
      }
    }

    responseError = err?.message ?? "Intern fejl i evalueringen";
    console.error("EVALUATE /api/evaluate error:", err);
    return respond({ ok: false, error: err?.message ?? "Intern fejl i evalueringen" }, 500);
  } finally {
    const totalRequestMs = nowMs() - requestStartedAt;
    console.info("[evaluate] diagnostics", {
      requestId,
      outcome,
      status: responseStatus,
      flow: flowForDiagnostics,
      scopeFolderIds: scopeFolderIdsForDiagnostics,
      model: modelForDiagnostics,
      contextChunkCount: metrics.contextChunkCount,
      contextChars: metrics.contextChars,
      contextTokensApprox: approxTokensFromChars(metrics.contextChars),
      stageTimingsMs: {
        authSession: metrics.authSessionMs,
        ensureProfile: metrics.ensureProfileMs,
        retrieval: metrics.retrievalMs,
        promptBuild: metrics.promptBuildMs,
        model: metrics.openAiMs,
        parsingAndPostProcessing: metrics.parsingMs,
        dbSave: metrics.dbSaveMs,
        jobPersist: metrics.jobPersistMs,
        trackEvent: metrics.trackEventMs,
        total: totalRequestMs,
      },
      totalRequestMs,
      error: responseError,
    });
  }
}
