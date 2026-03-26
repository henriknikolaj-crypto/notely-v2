// app/api/generate-question/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

import { getOwnerCtx } from "@/lib/auth/owner";
import { captureException } from "@/lib/monitoring/error";
import { enforceRateLimit } from "@/lib/rateLimit";
import { quotaTryConsume } from "@/lib/quota/rpc";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { resolveModelForFeature } from "@/lib/openai/model";
import { createClient } from "@supabase/supabase-js";
import { rankChunksForPrompt } from "@/lib/retrieval/structureAware";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { trackProductEvent } from "@/lib/server/trackProductEvent";
import {
  buildGenerateQuestionPrompts,
  clampInt,
  deriveFocusTargetsFromWeakSessions,
  fileTitle,
  pickDifficulty,
  pickFocusMode,
  scopeKeyFromFolderIds,
  uniqTrimmed,
  type ChunkRow,
  type Difficulty,
  type FileRow,
  type FocusMode,
  type WeakPointTarget,
} from "@/lib/trainer/generate-question";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";

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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  let ownerId = "";
  let primaryFolderId: string | null = null;
  let generatedFileId: string | null = null;

  try {
    if (!process.env.OPENAI_API_KEY) {
      const err: GenerateQuestionErr = { ok: false, error: "OPENAI_API_KEY mangler i .env.local.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    const parsed = await readJsonBody<GenerateQuestionRequest>(req);
    if (!parsed.ok) {
      const err: GenerateQuestionErr = { ok: false, error: parsed.error, requestId };
      return NextResponse.json(err, { status: 400 });
    }

    const body = parsed.value ?? {};
    const difficulty = pickDifficulty(body.difficulty);
    const maxContextChunks = clampInt(body.maxContextChunks, 4, 32, 10);
    const requestedFocusMode = pickFocusMode(body.focusMode);

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const scopeKey = scopeKeyFromFolderIds(scopeFolderIds);
    const explicitFolderId = String(body.folderId ?? body.folder_id ?? "").trim();
    primaryFolderId = explicitFolderId || scopeFolderIds[0] || null;

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

    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 24);
    const avoidChunkIds = uniqTrimmed(body.avoidChunkIds).slice(0, 500);
    const avoidChunkSet = new Set<string>(avoidChunkIds);

    // Auth (preview-stabil read-only cookie lookup)
    try {
      const sbAuth = supabaseServerRouteReadOnly(req);
      const owner = await getOwnerCtx(req, sbAuth);
      if (!owner?.ownerId) throw new Error("Unauthorized");
      ownerId = owner.ownerId;
    } catch {
      const err: GenerateQuestionErr = { ok: false, error: "Unauthorized", requestId };
      return NextResponse.json(err, { status: 401 });
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
        return NextResponse.json(err, { status: rl.status });
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
      return NextResponse.json(err, { status: 500 });
    }

    await ensureProfile(admin, ownerId);

    // Quota gate (trainer_round)
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
        return NextResponse.json(err, { status: q.status });
      } catch {
        const err: GenerateQuestionErr = {
          ok: false,
          error: q.message,
          requestId,
          code: q.status === 503 ? "SETUP_ERROR" : "QUOTA_EXCEEDED",
          feature: "trainer_round",
        };
        return NextResponse.json(err, { status: q.status });
      }
    }

    // Topic (første mappe-navn hvis muligt)
    let topic = "pensum";
    if (scopeFolderIds.length > 0) {
      const { data: f } = await admin
        .from("folders")
        .select("name")
        .eq("owner_id", ownerId)
        .eq("id", scopeFolderIds[0])
        .maybeSingle();
      if ((f as any)?.name) topic = String((f as any).name);
    }

    if (effectiveFocusMode === "weakest" && focusScopeFolderId) {
      const { data: weakRows } = await admin
        .from("exam_sessions")
        .select("created_at,metadata")
        .eq("owner_id", ownerId)
        .eq("folder_id", focusScopeFolderId)
        .in("source_type", ["trainer", "simulator"])
        .not("metadata->weak_points", "is", null)
        .order("created_at", { ascending: false })
        .limit(25);

      const weakRowsArr = (weakRows ?? []) as Array<{ metadata: any }>;
      weakSessionCount = weakRowsArr.length;
      focusTargets = deriveFocusTargetsFromWeakSessions(weakRowsArr);
      if (focusTargets.length === 0) {
        effectiveFocusMode = "normal";
      }
    }

    // Filer i scope
    let filesQ = admin
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const { data: files } = await filesQ;
    const fileRows = (files ?? []) as FileRow[];
    if (fileRows.length === 0) {
      const err: GenerateQuestionErr = {
        ok: false,
        error: "Ingen filer fundet i scope. Upload materiale først.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
    }

    // Fil-rotation
    const lastUsed = await loadLastUsedFileId(admin, ownerId, scopeKey);
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
      const fileId = String(f.id);

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

      const queryForRanking = [topic, difficulty, ...focusTargets.map((t) => t.label)].filter(Boolean).join(" ");
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
      return NextResponse.json(err, { status: 400 });
    }

    const usedFileId = String(chosenFile.id);
    generatedFileId = usedFileId;
    const usedFileTitle = fileTitle(chosenFile);

    const contextText = pickedChunks
      .map((c) => `KILDE: ${usedFileTitle}\n\n${(c.content ?? "").trim()}`)
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, 11000);

    if (!contextText.trim()) {
      const err: GenerateQuestionErr = { ok: false, error: "Kontekst blev tom efter filtrering.", requestId };
      return NextResponse.json(err, { status: 400 });
    }

    const citations: TrainerCitationPayload[] = pickedChunks.map((c) => ({
      chunkId: String(c.id),
      fileId: usedFileId,
      title: usedFileTitle,
      url: (c as any)?.source_url ? String((c as any).source_url) : null,
    }));

    const model = resolveModelForFeature("generate_question");

    const { systemPrompt, userPrompt, biasApplied } = buildGenerateQuestionPrompts({
      topic,
      difficulty,
      effectiveFocusMode,
      focusTargets,
      avoidQuestions,
      usedFileTitle,
      contextText,
    });

let finalQuestion = "";

for (let attempt = 0; attempt < 3; attempt++) {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  const { completion } = await createChatCompletion(openai, {
    feature: "generate_question",
    purpose: "json",
    modelOverride: model,
    payload: {
      response_format: { type: "json_object" as const },
      messages,
    },
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";
  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const qText = normalizeQuestionOutput(String(payload?.question ?? ""));
  if (!qText) continue;
  if (isTooLongTrainerQuestion(qText)) continue;

  finalQuestion = qText;
  break;
}

    if (!finalQuestion) {
      const err: GenerateQuestionErr = { ok: false, error: "Modellen returnerede tomt/ufuldstændigt output.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    // Gem rotation
    await saveLastUsedFileId(admin, ownerId, scopeKey, usedFileId);

    const usedChunkIds = pickedChunks.map((c) => String(c.id));

    // ✅ Opret runde (jobs-row) og returnér roundId til /api/evaluate
    const baseMeta = {
      requestId,
      scopeFolderIds,
      scopeKey,
      difficulty,
      model,
      usedFileId,
      usedFileTitle,
      usedChunkIds,
      maxContextChunks,
      citationCount: citations.length,
      evals_used: 0,
      max_evals: 2,
      focusMode: effectiveFocusMode,
      focusTargets,
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
      return NextResponse.json(err, { status: 500 });
    }

    // Marker succeeded (så månedstæller kan bruge status=succeeded)
    await finishTrainerRoundJob(admin, ownerId, roundId, baseMeta, basePayload);

    const resp: GenerateQuestionOk = {
      ok: true,
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
        model,
        maxContextChunks,
        difficulty,
        focusMode: effectiveFocusMode,
        biasApplied,
        focusTargets: focusTargets.map((t) => ({ key: t.key, label: t.label })),
        weakSessionCount,
      },
    };

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

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[generate-question] route error:", requestId, err);
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
    return NextResponse.json(out, { status: 500 });
  }
}
