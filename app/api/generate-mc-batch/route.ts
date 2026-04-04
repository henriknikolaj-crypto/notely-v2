// app/api/generate-mc-batch/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { consumeMcQuota, getMcQuotaSnapshot } from "@/lib/quota/mc";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type GenerateMcBatchRequest = {
  scopeFolderIds?: string[];
  difficulty?: Difficulty;
  maxContextChunks?: number;
  count?: number;

  // anti-repeat
  avoidQuestions?: string[];

  // undgå chunks i samme session
  avoidChunkIds?: string[];

  // valgfri: undgå tema-fokus i samme session
  avoidTopics?: string[];
};

type McOptionPayload = {
  id: string; // "a" | "b" | "c" | "d"
  text: string;
  isCorrect: boolean;
};

type McCitationPayload = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type McMeta = {
  requestId: string;
  usedChunkIds: string[];
  usedFileTitle: string | null;
};

type GenerateMcItemOk = {
  ok: true;
  questionId: string;
  question: string;
  options: McOptionPayload[];
  explanation: string | null;
  citations: McCitationPayload[];
  usedFileId: string | null;
  meta: McMeta;
};

type GenerateMcItemErr = {
  ok: false;
  error: string;
};

type GenerateMcItem = GenerateMcItemOk | GenerateMcItemErr;

type GenerateMcBatchOk = {
  ok: true;
  batchId: string;
  requestId: string;
  requestedCount: number;
  effectiveCount: number;
  returnedCount: number;
  items: GenerateMcItemOk[];
};

type GenerateMcBatchErr = {
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

type FileRow = {
  id: string;
  name: string | null;
  original_name: string | null;
  folder_id: string | null;
  created_at: string | null;
  extraction_quality?: string | null;
  extraction_meta?: Record<string, any> | null;
};

type ChunkRow = {
  id: string;
  file_id: string;
  content: string | null;
  created_at: string | null;
  source_url?: string | null;
};

type PlannedQuestion = {
  batchIndex: number;
  usedFileId: string;
  usedFileTitle: string;
  usedChunkIds: string[];
  citations: McCitationPayload[];
  focusAngle: string;
  userPrompt: string;
};

type ScoredChunkRow = ChunkRow & {
  mcScore: number;
  mcRejected: boolean;
  mcDownweighted: boolean;
  mcAcceptReasons: string[];
  mcDownweightReasons: string[];
  mcRejectReasons: string[];
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MC_BATCH_CONCURRENCY = 3;
const MC_BATCH_CONTEXT_CHAR_LIMIT = 4000;
const MC_OPENAI_CALL_TIMEOUT_MS = 85_000;
const MC_OPENAI_MAX_COMPLETION_TOKENS = 1200;
const MC_SCOPE_DOC_CHUNK_COUNT_MAX_FILES = 12;

function isOpenAiOutputLimitError(err: any) {
  const status = Number(err?.status ?? 0);
  const message = String(err?.message ?? "").toLowerCase();
  return (
    status === 400 &&
    (message.includes("could not finish the message") ||
      message.includes("max_tokens") ||
      message.includes("output limit"))
  );
}

function nowMs() {
  return Date.now();
}

function n0(x: number | null | undefined) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getOwnerId(req: NextRequest): Promise<string> {
  const sb = supabaseServerRouteReadOnly(req);
  const { data: sessionData } = await sb.auth.getSession();
  const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;
  if (sessionUserId) return sessionUserId;

  const { data, error } = await sb.auth.getUser();
  if (!error && data?.user?.id) return String(data.user.id);

  throw new Error("Unauthorized");
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

async function getPlanAndMcLimit(admin: any, ownerId: string): Promise<{ plan: string; mcLimit: number | null }> {
  const { data: profile, error: profErr } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
  if (profErr) console.error("[mc] profiles error:", profErr);

  const planRaw = String((profile as any)?.plan ?? "freemium").trim();
  const planNorm = normalizePlan(planRaw);

  // prøv først planRaw, ellers fallback til normalized
  const tryPlans = [planRaw.toLowerCase(), planNorm].filter(Boolean);
  let limits: any[] | null = null;

  for (const p of tryPlans) {
    const r = await admin.from("plan_limits").select("feature, monthly_limit, is_unlimited").eq("plan", p);
    if (!r.error && Array.isArray(r.data) && r.data.length > 0) {
      limits = r.data;
      break;
    }
  }

  const plan = tryPlans[0] || planNorm;

  const row = (limits ?? []).find((r: any) => String(r?.feature ?? "") === "mc_generate");
  if (!row) return { plan: planNorm, mcLimit: null }; // mangler række => behandl som unlimited for at undgå 500-støj

  if ((row as any).is_unlimited === true) return { plan: planNorm, mcLimit: null };
  const rawLimit = (row as any).monthly_limit ?? null;
  if (rawLimit == null) return { plan: planNorm, mcLimit: null }; // NULL => ubegrænset

  const n = Number(rawLimit);
  return { plan: planNorm, mcLimit: Number.isFinite(n) ? Math.round(n) : null };
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
  // 1) prøv req.json()
  try {
    const v = (await req.json()) as T;
    return { ok: true as const, value: (v ?? ({} as T)) };
  } catch {
    // 2) fallback: text + BOM-safe JSON.parse
    try {
      const raw = (await req.text()).trim();
      if (!raw) return { ok: true as const, value: {} as T };
      const cleaned = raw.replace(/^\uFEFF/, "");
      return { ok: true as const, value: JSON.parse(cleaned) as T };
    } catch {
      return { ok: false as const, error: "Ugyldigt JSON-body." };
    }
  }
}

function pickDifficulty(raw: any): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function clampInt(raw: any, min: number, max: number, fallback: number) {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(max, Math.max(min, n));
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

function scopeKeyFromFolderIds(folderIds: string[]) {
  const ids = uniqTrimmed(folderIds).sort();
  return ids.length ? `folders:${ids.join(",")}` : "all";
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

async function loadLastUsedFileId(admin: any, ownerId: string, scopeKey: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from("generation_state")
      .select("last_used_file_id")
      .eq("owner_id", ownerId)
      .eq("kind", "mc")
      .eq("scope_key", scopeKey)
      .maybeSingle();

    const v = (data as any)?.last_used_file_id;
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function saveLastUsedFileId(admin: any, ownerId: string, scopeKey: string, fileId: string) {
  try {
    await admin.from("generation_state").upsert(
      {
        owner_id: ownerId,
        kind: "mc",
        scope_key: scopeKey,
        last_used_file_id: fileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,kind,scope_key" },
    );
  } catch (e) {
    console.error("[generate-mc-batch] save generation_state failed:", e);
  }
}

async function countMcJobsThisMonth(admin: any, ownerId: string, monthStart: string, resetAt: string) {
  const successStatuses = ["succeeded"];
  const tsCols = ["queued_at", "created_at", "inserted_at"] as const;

  for (const tsCol of tsCols) {
    const r = await admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", "mc_generate")
      .in("status", successStatuses)
      .gte(tsCol, monthStart)
      .lt(tsCol, resetAt);

    if (!r.error && r.count != null) return { used: n0(r.count), debug: { tsCol, successStatuses } };
  }

  return { used: 0, debug: { tsCol: null, successStatuses } };
}

async function logMcJobs(admin: any, ownerId: string, payloads: any[]) {
  if (payloads.length === 0) return;
  try {
    const queuedAt = new Date().toISOString();
    await admin.from("jobs").insert(
      payloads.map((payload) => ({
        owner_id: ownerId,
        kind: "mc_generate",
        status: "succeeded",
        queued_at: queuedAt,
        payload,
      })),
    );
  } catch (e) {
    console.warn("[generate-mc-batch] jobs insert warning:", e);
  }
}

function normalizeQuestion(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
}

function normalizeAnswer(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
}

function stripLeadingLetterOption(t: string) {
  return String(t ?? "").replace(/^\s*[A-Da-d]\s*[\).:\-]\s*/g, "").trim();
}

function hitsAvoidTopics(q: string, topics: string[]) {
  if (!topics.length) return 0;
  const s = String(q ?? "").toLowerCase();
  let hits = 0;
  for (const t of topics) {
    const tt = String(t ?? "").toLowerCase().trim();
    if (!tt) continue;
    if (tt.length < 4) continue;
    if (s.includes(tt)) hits++;
  }
  return hits;
}

function chunksPerQuestion(difficulty: Difficulty, maxContextChunks: number) {
  const base = difficulty === "hard" ? 3 : 2;
  return Math.max(1, Math.min(base, maxContextChunks));
}

function scoreChunkForMc(content: string, fileRow?: FileRow | null) {
  const text = String(content ?? "").trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean);
  const sentenceMatches = text.match(/[.!?]/g) ?? [];
  const digits = (text.match(/\d/g) ?? []).length;
  const mathish = (text.match(/[=+\-/*^%<>()[\]{}]/g) ?? []).length;
  const denseSpaces = (text.match(/ {2,}/g) ?? []).length;
  const shortLines = lines.filter((line) => line.length <= 28).length;
  const tableLikeLines = lines.filter((line) => /\|/.test(line) || /\t/.test(line) || / {2,}/.test(line)).length;
  const keywordHits = (
    text.match(/\b(er|betyder|kaldes|derfor|fordi|viser|beskriver|forklarer|defineres|sammenhæng|konsekvens)\b/gi) ?? []
  ).length;
  const conceptHits = (text.match(/\b(definition|begreb|kaldes|betyder|sammenhæng|relation|resultat|regel|lov)\b/gi) ?? []).length;
  const figureRefs = (text.match(/\b(figur|graf|diagram|illustration|tabel)\b/gi) ?? []).length;
  const taskStubHits = (text.match(/\b(beregn|bestem|angiv|vis at|udled|tegn|aflæs)\b/gi) ?? []).length;
  const dominantPageType = String(fileRow?.extraction_meta?.dominant_page_type ?? "").trim().toLowerCase();

  let score = 0;
  const acceptReasons: string[] = [];
  const downweightReasons: string[] = [];
  const rejectReasons: string[] = [];

  if (text.length >= 180) {
    score += 3;
    acceptReasons.push("connected_text");
  } else if (text.length >= 110) {
    score += 1;
  }
  else rejectReasons.push("too_short");

  if (words.length >= 35) score += 2;
  if (sentenceMatches.length >= 2) {
    score += 2;
    acceptReasons.push("multi_sentence");
  }
  if (keywordHits >= 1) {
    score += 2;
    acceptReasons.push("explanatory");
  }
  if (conceptHits >= 1) {
    score += 2;
    acceptReasons.push("concept_like");
  }
  if (keywordHits >= 1 && mathish >= 2 && digits >= 1) {
    score += 1;
    acceptReasons.push("balanced_technical");
  }

  if (lines.length > 0 && shortLines / lines.length > 0.6) {
    score -= 3;
    rejectReasons.push("fragmented");
  }
  if (tableLikeLines >= 2 || denseSpaces >= 3) {
    score -= 3;
    rejectReasons.push("table_like");
  }
  if (text.length > 0 && (digits + mathish) / text.length > 0.18) {
    score -= 3;
    rejectReasons.push("symbol_heavy");
  }
  if (figureRefs >= 1 && keywordHits === 0 && sentenceMatches.length < 2) {
    score -= 2;
    downweightReasons.push("figure_ref");
  }
  if (taskStubHits >= 1 && text.length < 220 && keywordHits === 0) {
    score -= 2;
    downweightReasons.push("task_stub");
  }
  if ((dominantPageType === "formula_heavy" || dominantPageType === "table_heavy") && keywordHits === 0 && sentenceMatches.length < 2) {
    score -= 1;
    downweightReasons.push("page_type_bias");
  }
  if (String(fileRow?.extraction_quality ?? "").trim().toLowerCase() === "low") {
    score -= 1;
    downweightReasons.push("low_extraction_quality");
  }
  return {
    score,
    acceptReasons,
    downweightReasons,
    rejectReasons,
    downweighted: downweightReasons.length > 0 && rejectReasons.length === 0,
    reject: rejectReasons.length > 0 && score < 2,
  };
}

const FOCUS_ANGLES = [
  "Begrebsafklaring (hvad betyder et centralt begreb i teksten?)",
  "Sammenligning (hvad adskiller to nært beslægtede begreber i teksten?)",
  "Årsag-virkning (hvad fører X til ifølge teksten?)",
  "Anvendelse/eksempel (hvordan kan et begreb bruges til at forklare en situation?)",
  "Nuancering/kritik (hvilken begrænsning/nuance fremgår af teksten?)",
  "Konsekvens (hvilken konsekvens/implikation peger teksten på?)",
] as const;

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = nowMs();

  const metrics = {
    fileCountInScope: 0,
    docChunksInScope: null as number | null,
    docChunkCountMode: "skipped" as "exact" | "skipped",
    pickedChunkCount: 0,
    totalCharactersInPickedChunks: 0,
    openAiCallCount: 0,
    openAiCallDurationsMs: [] as number[],
    openAiCallCharacters: [] as number[],
    totalOpenAiMs: 0,
    totalRetrievalMs: 0,
    totalPromptBuildMs: 0,
    totalNormalizationMs: 0,
    topicLookupMs: 0,
    filesLookupMs: 0,
    scopeChunkCountMs: 0,
    saveLastUsedMs: 0,
    jobPersistMs: 0,
    timeToFirstAcceptedMs: null as number | null,
    invalidModelOutputCount: 0,
    sequentialOpenAiCalls: false,
    retryOpenAiCalls: 0,
    usedFileIds: [] as string[],
    usedChunkIds: [] as string[],
    chunksRejectedForMc: 0,
    chunksDownweightedForMc: 0,
    acceptedChunkReasonCounts: {
      connected_text: 0,
      multi_sentence: 0,
      explanatory: 0,
      concept_like: 0,
      balanced_technical: 0,
    },
    rejectedChunkReasonCounts: {
      too_short: 0,
      fragmented: 0,
      table_like: 0,
      symbol_heavy: 0,
    },
    downweightedChunkReasonCounts: {
      figure_ref: 0,
      task_stub: 0,
      page_type_bias: 0,
      low_extraction_quality: 0,
    },
    waveCount: 0,
    maxInFlightOpenAi: 0,
    abortSource: null as string | null,
  };

  try {
    if (!process.env.OPENAI_API_KEY) {
      const err: GenerateMcBatchErr = { ok: false, error: "OPENAI_API_KEY mangler i .env.local.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    const parsed = await readJsonBody<GenerateMcBatchRequest>(req);
    if (!parsed.ok) {
      const err: GenerateMcBatchErr = { ok: false, error: parsed.error, requestId };
      return NextResponse.json(err, { status: 400 });
    }

    const body = parsed.value ?? {};
    const difficulty = pickDifficulty(body.difficulty);

    const requestedCount = clampInt(body.count, 1, 10, 10);
    const maxContextChunks = clampInt(body.maxContextChunks, 2, 32, 10);
    const ownerId = await getOwnerId(req);

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const scopeKey = scopeKeyFromFolderIds(scopeFolderIds);
    if (scopeFolderIds.length === 0) {
      console.info("[generate-mc-batch] request-rejected-empty-scope", { requestId });
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Vælg mindst én mappe før du starter Multiple Choice.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
    }

    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 64);
    const avoidNorm = new Set(avoidQuestions.map(normalizeQuestion));

    const avoidTopics = uniqTrimmed(body.avoidTopics).slice(0, 12);

    const avoidChunkIds = uniqTrimmed(body.avoidChunkIds).slice(0, 800);
    const avoidChunkSet = new Set<string>(avoidChunkIds);

    const admin = supabaseAdmin();
    const quotaSnapshot = await getMcQuotaSnapshot(admin, ownerId);
    if (process.env.NODE_ENV !== "production") {
      console.info("[generate-mc-batch] quota-snapshot", {
        requestId,
        ownerId,
        feature: "mc_generate",
        requestedCount,
        usedThisMonth: quotaSnapshot.used,
        monthlyLimit: quotaSnapshot.limitPerMonth,
        remainingThisMonth: quotaSnapshot.remainingThisMonth,
      });
    }
    if (!quotaSnapshot.ok) {
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Du har ikke nok Multiple Choice tilbage denne måned til at starte et nyt sæt.",
        requestId,
        code: quotaSnapshot.status === 429 ? "QUOTA_EXCEEDED" : "QUOTA_CHECK_FAILED",
        feature: "mc_generate",
        plan: quotaSnapshot.plan,
        usedThisMonth: quotaSnapshot.used,
        monthlyLimit: quotaSnapshot.limitPerMonth,
        resetAt: quotaSnapshot.resetAt ?? undefined,
      };
      return NextResponse.json(err, { status: quotaSnapshot.status });
    }

    if (
      typeof quotaSnapshot.remainingThisMonth === "number" &&
      quotaSnapshot.remainingThisMonth < requestedCount
    ) {
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Du har ikke nok Multiple Choice tilbage denne måned til at starte et nyt sæt.",
        requestId,
        code: "QUOTA_EXCEEDED",
        feature: "mc_generate",
        plan: quotaSnapshot.plan,
        usedThisMonth: quotaSnapshot.used,
        monthlyLimit: quotaSnapshot.limitPerMonth,
        resetAt: quotaSnapshot.resetAt ?? undefined,
        debug: {
          requestedCount,
          remainingThisMonth: quotaSnapshot.remainingThisMonth,
          reason: "partial-batch-blocked",
        },
      };
      return NextResponse.json(err, { status: 429 });
    }

    const effectiveCount = requestedCount;

    // Topic (første mappe-navn hvis muligt)
    let topic = "pensum";
    const topicStartedAt = nowMs();
    if (scopeFolderIds.length > 0) {
      const { data: f } = await admin
        .from("folders")
        .select("name")
        .eq("owner_id", ownerId)
        .eq("id", scopeFolderIds[0])
        .maybeSingle();
      if ((f as any)?.name) topic = String((f as any).name);
    }
    metrics.topicLookupMs = nowMs() - topicStartedAt;

    // Filer i scope
    const filesStartedAt = nowMs();
    let filesQ = admin
      .from("files")
      .select("id,name,original_name,folder_id,created_at,extraction_quality,extraction_meta")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) console.error("[generate-mc-batch] files error:", filesErr);
    metrics.filesLookupMs = nowMs() - filesStartedAt;

    const fileRows = (files ?? []) as FileRow[];
    const fileById = new Map(fileRows.map((row) => [String(row.id), row]));
    metrics.fileCountInScope = fileRows.length;
    if (fileRows.length === 0) {
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Ingen filer fundet i scope. Upload materiale først.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
    }

    {
      const scopeFileIds = fileRows.map((f) => String(f.id)).filter(Boolean).slice(0, MC_SCOPE_DOC_CHUNK_COUNT_MAX_FILES);
      if (scopeFileIds.length > 0 && fileRows.length <= MC_SCOPE_DOC_CHUNK_COUNT_MAX_FILES) {
        const countStartedAt = nowMs();
        const { count } = await admin
          .from("doc_chunks")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", ownerId)
          .in("file_id", scopeFileIds);
        const countElapsedMs = nowMs() - countStartedAt;
        metrics.scopeChunkCountMs = countElapsedMs;
        metrics.totalRetrievalMs += countElapsedMs;
        metrics.docChunksInScope = n0(count);
        metrics.docChunkCountMode = "exact";
      }
    }

    // Rotation på fil-niveau
    const lastUsed = await loadLastUsedFileId(admin, ownerId, scopeKey);
    let start = 0;
    if (lastUsed) {
      const idx = fileRows.findIndex((f) => String(f.id) === String(lastUsed));
      if (idx >= 0) start = (idx + 1) % fileRows.length;
    } else {
      start = Math.floor(Math.random() * fileRows.length);
    }
    const rotated = [...fileRows.slice(start), ...fileRows.slice(0, start)];
    let pointer = 0;

    // Lazy cache af chunk-pools pr file
    const poolCache = new Map<string, ScoredChunkRow[]>();
    async function loadPool(fileId: string): Promise<ScoredChunkRow[]> {
      const existing = poolCache.get(fileId);
      if (existing) return existing;

      const poolStartedAt = nowMs();
      const { data: pool, error: poolErr } = await admin
        .from("doc_chunks")
        .select("id,file_id,content,created_at,source_url")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(400);

      if (poolErr) {
        console.error("[generate-mc-batch] doc_chunks pool error:", poolErr);
        poolCache.set(fileId, []);
        metrics.totalRetrievalMs += nowMs() - poolStartedAt;
        return [];
      }

      const poolRows = ((pool ?? []) as ChunkRow[]).filter((r) => (r.content ?? "").trim().length > 0);
      const scoredRows = poolRows
        .map((row) => {
          const scored = scoreChunkForMc(row.content ?? "", fileById.get(String(row.file_id)) ?? null);
          if (scored.reject) {
            metrics.chunksRejectedForMc += 1;
            for (const reason of scored.rejectReasons) {
              if (reason in metrics.rejectedChunkReasonCounts) {
                metrics.rejectedChunkReasonCounts[reason as keyof typeof metrics.rejectedChunkReasonCounts] += 1;
              }
            }
          }
          if (!scored.reject) {
            for (const reason of scored.acceptReasons) {
              if (reason in metrics.acceptedChunkReasonCounts) {
                metrics.acceptedChunkReasonCounts[reason as keyof typeof metrics.acceptedChunkReasonCounts] += 1;
              }
            }
          }
          if (scored.downweighted) {
            metrics.chunksDownweightedForMc += 1;
            for (const reason of scored.downweightReasons) {
              if (reason in metrics.downweightedChunkReasonCounts) {
                metrics.downweightedChunkReasonCounts[reason as keyof typeof metrics.downweightedChunkReasonCounts] += 1;
              }
            }
          }
          return {
            ...row,
            mcScore: scored.score,
            mcRejected: scored.reject,
            mcDownweighted: scored.downweighted,
            mcAcceptReasons: scored.acceptReasons,
            mcDownweightReasons: scored.downweightReasons,
            mcRejectReasons: scored.rejectReasons,
          };
        })
        .sort((a, b) => b.mcScore - a.mcScore);
      poolCache.set(fileId, scoredRows);
      metrics.totalRetrievalMs += nowMs() - poolStartedAt;
      return scoredRows;
    }

    async function pickFileAndChunks(): Promise<{ file: FileRow; chunks: ChunkRow[] } | null> {
      const pickStartedAt = nowMs();
      const scanMax = Math.min(30, rotated.length);
      const take = Math.min(chunksPerQuestion(difficulty, maxContextChunks), 2);

      // pass 1: respekter avoidChunkSet
      for (let tries = 0; tries < scanMax; tries++) {
        const idx = (pointer + tries) % rotated.length;
        const f = rotated[idx];
        const fileId = String(f.id);

        const pool = await loadPool(fileId);
        const usable = pool.filter((r) => !avoidChunkSet.has(String(r.id)));
        if (usable.length < 1) continue;

        const preferred = usable.filter((r) => !r.mcRejected && !r.mcDownweighted);
        const acceptable = usable.filter((r) => !r.mcRejected);
        const candidatePool = preferred.length >= 1 ? preferred : acceptable.length >= 1 ? acceptable : usable;

        const picked = shuffle(candidatePool)
          .slice(0, Math.min(take, candidatePool.length))
          .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));

        pointer = (idx + 1) % rotated.length;
        metrics.totalRetrievalMs += nowMs() - pickStartedAt;
        return { file: f, chunks: picked };
      }

      // pass 2: allow reuse
      for (let tries = 0; tries < scanMax; tries++) {
        const idx = (pointer + tries) % rotated.length;
        const f = rotated[idx];
        const fileId = String(f.id);

        const pool = await loadPool(fileId);
        if (pool.length < 1) continue;

        const preferred = pool.filter((r) => !r.mcRejected && !r.mcDownweighted);
        const acceptable = pool.filter((r) => !r.mcRejected);
        const candidatePool = preferred.length >= 1 ? preferred : acceptable.length >= 1 ? acceptable : pool;

        const picked = shuffle(candidatePool)
          .slice(0, Math.min(take, candidatePool.length))
          .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));

        pointer = (idx + 1) % rotated.length;
        metrics.totalRetrievalMs += nowMs() - pickStartedAt;
        return { file: f, chunks: picked };
      }

      metrics.totalRetrievalMs += nowMs() - pickStartedAt;
      return null;
    }

    const model = process.env.OPENAI_MODEL_MC || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const systemPromptBase = `
Du er en dansk studieassistent.
Du laver eksamenslignende multiple choice-spørgsmål ud fra elevens pensum-uddrag.

VIGTIGT:
- Du MÅ KUN bruge den kontekst, du får (KILDE-afsnit).
- Skriv alt på dansk.
- Returnér kun ét kompakt JSON-objekt. Ingen markdown, ingen kodeblok, ingen ekstra tekst.

KRAV:
- 1 spørgsmål
- 4 svarmuligheder
- Præcis 1 korrekt
- Plausible distraktorer (ikke åbenlyse)
- Spørgsmålet skal være specifikt og må ikke være en ren gentagelse af samme faktasæt.
- Undgå at gøre "samme korrekt-svar" til løsning igen og igen.
- "question" skal være kort: maks 1 sætning og helst under 160 tegn.
- Hver "options[].text" skal være kort: helst under 10 ord.
- "explanation" skal være meget kort: maks 1 kort sætning og helst under 160 tegn.
- Brug ingen ekstra felter.

Returnér gyldig JSON:
{
  "question": "...",
  "options": [
    { "text": "...", "isCorrect": true/false },
    { "text": "...", "isCorrect": true/false },
    { "text": "...", "isCorrect": true/false },
    { "text": "...", "isCorrect": true/false }
  ],
  "explanation": "Kort forklaring"
}
`.trim();

    const items: GenerateMcItemOk[] = [];
    let lastUsedFileIdInBatch: string | null = null;
    console.info("[generate-mc-batch] request-start", { requestId, scopeFolderIds, effectiveCount });

    const recentCorrectAnswers = new Set<string>();
    async function planQuestion(batchIndex: number): Promise<PlannedQuestion | null> {
      const pick = await pickFileAndChunks();
      if (!pick) return null;

      const usedFileId = String(pick.file.id);
      const usedFileTitle = fileTitle(pick.file);
      lastUsedFileIdInBatch = usedFileId;
      metrics.usedFileIds.push(usedFileId);

      const usedChunkIds = pick.chunks.map((c) => String(c.id));
      for (const id of usedChunkIds) avoidChunkSet.add(id);
      metrics.pickedChunkCount += pick.chunks.length;
      metrics.usedChunkIds.push(...usedChunkIds);

      const promptStartedAt = nowMs();
      const contextText = pick.chunks
        .map((c) => `KILDE: ${usedFileTitle}\n\n${(c.content ?? "").trim()}`)
        .filter(Boolean)
        .join("\n\n---\n\n")
        .slice(0, MC_BATCH_CONTEXT_CHAR_LIMIT);
      metrics.totalCharactersInPickedChunks += contextText.length;
      if (!contextText.trim()) {
        metrics.totalPromptBuildMs += nowMs() - promptStartedAt;
        return null;
      }

      const citations: McCitationPayload[] = pick.chunks.map((c) => ({
        chunkId: String(c.id),
        fileId: usedFileId,
        title: usedFileTitle,
        url: (c as any)?.source_url ? String((c as any).source_url) : null,
      }));

      const avoidBlock =
        avoidNorm.size > 0
          ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${Array.from(avoidNorm)
              .slice(0, 32)
              .join("\n- ")}\n`
          : "";

      const avoidTopicsBlock =
        avoidTopics.length > 0
          ? `\nUNDGÅ at lave spørgsmål med samme fokus/tema som disse nøgleord (vælg et andet aspekt i konteksten):\n- ${avoidTopics.join(
              "\n- ",
            )}\n`
          : "";

      const focusAngle = FOCUS_ANGLES[batchIndex % FOCUS_ANGLES.length];
      const userPrompt = [
        `Fag/tema: ${topic}`,
        `Sværhedsgrad: ${difficulty}`,
        `Kilde (primary): ${usedFileTitle}`,
        `FOKUSVINKEL: ${focusAngle}`,
        "VIGTIGT: Spørgsmålet skal primært teste FOKUSVINKELEN, så vi får variation mellem spørgsmål.",
        avoidBlock.trim(),
        avoidTopicsBlock.trim(),
        "",
        "KONTEKST (brug dette som eneste grundlag):",
        "",
        contextText,
      ]
        .filter(Boolean)
        .join("\n");
      metrics.totalPromptBuildMs += nowMs() - promptStartedAt;

      return { batchIndex, usedFileId, usedFileTitle, usedChunkIds, citations, focusAngle, userPrompt };
    }

    async function generatePlannedQuestion(planned: PlannedQuestion) {
      let finalQuestion = "";
      let finalOptions: Array<{ text: string; isCorrect: boolean }> = [];
      let finalExplanation: string | null = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const systemPrompt =
          attempt === 0
            ? systemPromptBase
            : `${systemPromptBase}\nEKSTRA VIGTIGT: Du må IKKE gentage tidligere spørgsmål. Vælg et andet fokus i konteksten og et andet korrekt-svar.`;

        const openAiStartedAt = nowMs();
        const openAiAbort = new AbortController();
        const timeoutHandle = setTimeout(() => {
          metrics.abortSource = "route_openai_timeout";
          console.info("[generate-mc-batch] openai-call-abort", {
            requestId,
            source: "route_openai_timeout",
            batchIndex: planned.batchIndex,
            attempt,
            timeoutMs: MC_OPENAI_CALL_TIMEOUT_MS,
          });
          openAiAbort.abort("route_openai_timeout");
        }, MC_OPENAI_CALL_TIMEOUT_MS);
        let completion;
        let openAiError: any = null;
        try {
          completion = await openai.chat.completions.create(
            {
              model,
              max_completion_tokens: MC_OPENAI_MAX_COMPLETION_TOKENS,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: planned.userPrompt },
              ],
            },
            { signal: openAiAbort.signal },
          );
        } catch (err: any) {
          openAiError = err;
        } finally {
          clearTimeout(timeoutHandle);
        }
        const openAiDurationMs = nowMs() - openAiStartedAt;
        metrics.openAiCallCount += 1;
        metrics.openAiCallDurationsMs.push(openAiDurationMs);
        metrics.openAiCallCharacters.push(planned.userPrompt.length + systemPrompt.length);
        metrics.totalOpenAiMs += openAiDurationMs;
        if (attempt > 0) metrics.retryOpenAiCalls += 1;

        if (openAiError) {
          const abortReason = String(openAiAbort.signal.reason ?? "").trim();
          if (
            openAiAbort.signal.aborted ||
            openAiError?.name === "AbortError" ||
            String(openAiError?.message ?? "").includes("aborted")
          ) {
            const source = abortReason || "unknown_abort_source";
            metrics.abortSource = source;
            console.info("[generate-mc-batch] openai-call-aborted", {
              requestId,
              source,
              batchIndex: planned.batchIndex,
              attempt,
              elapsedMs: openAiDurationMs,
            });
            throw new Error(`MC OpenAI call aborted by ${source}`);
          }

          if (isOpenAiOutputLimitError(openAiError)) {
            metrics.invalidModelOutputCount += 1;
            console.warn("[generate-mc-batch] invalid-model-output", {
              requestId,
              batchIndex: planned.batchIndex,
              attempt,
              model,
              finishReason: "sdk_output_limit_error",
              parseOk: false,
              rawLength: 0,
              questionLength: 0,
              optionsLength: 0,
              errorStatus: openAiError?.status ?? null,
              errorMessage: String(openAiError?.message ?? ""),
            });
            continue;
          }

          throw openAiError;
        }

        const normalizationStartedAt = nowMs();
        const raw = completion?.choices?.[0]?.message?.content ?? "{}";
        const finishReason = completion?.choices?.[0]?.finish_reason ?? null;

        type LlmOption = { text?: string; isCorrect?: boolean };
        type LlmPayload = { question?: string; options?: LlmOption[]; explanation?: string };

        let payload: LlmPayload = {};
        let parseOk = true;
        try {
          payload = JSON.parse(raw) as LlmPayload;
        } catch {
          payload = {};
          parseOk = false;
        }

        const q = String(payload.question ?? "").trim();
        const opts = Array.isArray(payload.options) ? payload.options : [];
        const normQ = normalizeQuestion(q);

        if (!q || opts.length < 2) {
          metrics.invalidModelOutputCount += 1;
          console.warn("[generate-mc-batch] invalid-model-output", {
            requestId,
            batchIndex: planned.batchIndex,
            attempt,
            model,
            finishReason,
            parseOk,
            rawLength: raw.length,
            questionLength: q.length,
            optionsLength: opts.length,
          });
          metrics.totalNormalizationMs += nowMs() - normalizationStartedAt;
          continue;
        }
        if (avoidNorm.has(normQ)) {
          metrics.totalNormalizationMs += nowMs() - normalizationStartedAt;
          continue;
        }
        if (avoidTopics.length > 0 && attempt === 0) {
          if (hitsAvoidTopics(q, avoidTopics) >= 1) {
            metrics.totalNormalizationMs += nowMs() - normalizationStartedAt;
            continue;
          }
        }

        const normalized = opts.slice(0, 4);
        while (normalized.length < 4) normalized.push({ text: `Mulighed ${normalized.length + 1}`, isCorrect: false });

        let correctIdx = normalized.findIndex((o) => !!o.isCorrect);
        if (correctIdx === -1) correctIdx = 0;

        finalQuestion = q;
        finalOptions = normalized.map((o, idx) => ({
          text: stripLeadingLetterOption(String(o.text ?? "")) || `Mulighed ${idx + 1}`,
          isCorrect: idx === correctIdx,
        }));
        finalExplanation = String(payload.explanation ?? "").trim() || null;
        metrics.totalNormalizationMs += nowMs() - normalizationStartedAt;
        break;
      }

      return { ...planned, finalQuestion, finalOptions, finalExplanation };
    }

    let nextBatchIndex = 0;
    while (items.length < effectiveCount) {
      const waveStartedAt = nowMs();
      metrics.waveCount += 1;
      const wavePlans: PlannedQuestion[] = [];
      for (let i = 0; i < MC_BATCH_CONCURRENCY && nextBatchIndex < effectiveCount; i++) {
        const planned = await planQuestion(nextBatchIndex);
        nextBatchIndex += 1;
        if (planned) wavePlans.push(planned);
      }
      if (wavePlans.length === 0) break;
      metrics.maxInFlightOpenAi = Math.max(metrics.maxInFlightOpenAi, wavePlans.length);
      console.info("[generate-mc-batch] wave-start", {
        requestId,
        wave: metrics.waveCount,
        plannedCount: wavePlans.length,
        inFlightOpenAi: wavePlans.length,
      });

      const waveResults = await Promise.all(wavePlans.map((planned) => generatePlannedQuestion(planned)));
      waveResults.sort((a, b) => a.batchIndex - b.batchIndex);

      for (const result of waveResults) {
        if (!result.finalQuestion || result.finalOptions.length === 0) continue;

        const normQ = normalizeQuestion(result.finalQuestion);
        if (avoidNorm.has(normQ)) continue;

        const correctText = result.finalOptions.find((x) => x.isCorrect)?.text ?? "";
        const normA = normalizeAnswer(correctText);
        if (normA && recentCorrectAnswers.has(normA)) continue;

        const shuffled = shuffle(result.finalOptions);
        const letters = ["a", "b", "c", "d"];
        const options: McOptionPayload[] = shuffled.map((o, idx) => ({
          id: letters[idx],
          text: o.text,
          isCorrect: o.isCorrect,
        }));

        items.push({
          ok: true,
          questionId: randomUUID(),
          question: result.finalQuestion,
          options,
          explanation: result.finalExplanation,
          citations: result.citations,
          usedFileId: result.usedFileId,
          meta: { requestId, usedChunkIds: result.usedChunkIds, usedFileTitle: result.usedFileTitle },
        });

        avoidNorm.add(normQ);
        if (normA) recentCorrectAnswers.add(normA);
        if (metrics.timeToFirstAcceptedMs == null) metrics.timeToFirstAcceptedMs = nowMs() - requestStartedAt;

        if (items.length >= effectiveCount) break;
      }
      console.info("[generate-mc-batch] wave-end", {
        requestId,
        wave: metrics.waveCount,
        plannedCount: wavePlans.length,
        acceptedSoFar: items.length,
        waveMs: nowMs() - waveStartedAt,
        inFlightOpenAi: 0,
      });
    }

    if (lastUsedFileIdInBatch) {
      const saveStartedAt = nowMs();
      await saveLastUsedFileId(admin, ownerId, scopeKey, lastUsedFileIdInBatch);
      metrics.saveLastUsedMs += nowMs() - saveStartedAt;
    }

    if (items.length === 0) {
      const totalRequestMs = nowMs() - requestStartedAt;
      const usedFileIds = Array.from(new Set(metrics.usedFileIds));
      const uniquePickedChunkCount = new Set(metrics.usedChunkIds).size;
      console.info("[generate-mc-batch] diagnostics", {
        requestId,
        scopeFolderIds,
        fileCountInScope: metrics.fileCountInScope,
        docChunksInScope: metrics.docChunksInScope,
        docChunkCountMode: metrics.docChunkCountMode,
        pickedChunkCount: metrics.pickedChunkCount,
        uniquePickedChunkCount,
        totalCharactersInPickedChunks: metrics.totalCharactersInPickedChunks,
        chunksRejectedForMc: metrics.chunksRejectedForMc,
        chunksDownweightedForMc: metrics.chunksDownweightedForMc,
        acceptedChunkReasonCounts: metrics.acceptedChunkReasonCounts,
        rejectedChunkReasonCounts: metrics.rejectedChunkReasonCounts,
        chunkRejectReasonCounts: metrics.rejectedChunkReasonCounts,
        downweightedChunkReasonCounts: metrics.downweightedChunkReasonCounts,
        abortSource: metrics.abortSource,
        openAiCallCount: metrics.openAiCallCount,
        invalidModelOutputCount: metrics.invalidModelOutputCount,
        openAiCallDurationsMs: metrics.openAiCallDurationsMs,
        openAiCallCharacters: metrics.openAiCallCharacters,
        totalOpenAiMs: metrics.totalOpenAiMs,
        totalRetrievalMs: metrics.totalRetrievalMs,
        totalPromptBuildMs: metrics.totalPromptBuildMs,
        totalNormalizationMs: metrics.totalNormalizationMs,
        stageTimingsMs: {
          topicLookup: metrics.topicLookupMs,
          filesLookup: metrics.filesLookupMs,
          scopeChunkCount: metrics.scopeChunkCountMs,
          retrieval: metrics.totalRetrievalMs,
          promptBuild: metrics.totalPromptBuildMs,
          model: metrics.totalOpenAiMs,
          parsingAndPostProcessing: metrics.totalNormalizationMs,
          saveLastUsed: metrics.saveLastUsedMs,
          jobPersist: metrics.jobPersistMs,
          timeToFirstAccepted: metrics.timeToFirstAcceptedMs,
          total: totalRequestMs,
        },
        totalRequestMs,
        sequentialOpenAiCalls: metrics.sequentialOpenAiCalls,
        retryOpenAiCalls: metrics.retryOpenAiCalls,
        usedFileIds,
      });
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Kunne ikke generere nogen MC-spørgsmål fra dit materiale.",
        requestId,
        debug: { scopeFolderIds, requestedCount, effectiveCount },
      };
      return NextResponse.json(err, { status: 500 });
    }

    const quotaConsume = await consumeMcQuota(admin, ownerId, items.length);
    if (process.env.NODE_ENV !== "production") {
      console.info("[generate-mc-batch] quota-consume", {
        requestId,
        ownerId,
        feature: "mc_generate",
        requestedCount,
        effectiveCount,
        returnedCount: items.length,
        consumedAmount: items.length,
        usedBefore: quotaSnapshot.used,
        usedAfter: quotaConsume.used,
        monthlyLimit: quotaConsume.limitPerMonth,
        remainingBefore: quotaSnapshot.remainingThisMonth,
        remainingAfter: quotaConsume.remainingThisMonth,
      });
    }
    if (!quotaConsume.ok) {
      const err: GenerateMcBatchErr = {
        ok: false,
        error: quotaConsume.message,
        requestId,
        code: quotaConsume.status === 429 ? "QUOTA_EXCEEDED" : "QUOTA_CHECK_FAILED",
        feature: "mc_generate",
        plan: quotaConsume.plan,
        usedThisMonth: quotaConsume.used,
        monthlyLimit: quotaConsume.limitPerMonth,
        resetAt: quotaConsume.resetAt ?? undefined,
      };
      return NextResponse.json(err, { status: quotaConsume.status });
    }

    const jobPersistStartedAt = nowMs();
    await logMcJobs(
      admin,
      ownerId,
      items.map((item, batchIndex) => ({
        source: "generate-mc-batch",
        requestId,
        scopeFolderIds,
        scopeKey,
        difficulty,
        model,
        usedFileId: item.usedFileId,
        usedFileTitle: item.meta.usedFileTitle,
        maxContextChunks,
        chunksPerQuestion: Math.min(chunksPerQuestion(difficulty, maxContextChunks), 2),
        focusAngle: FOCUS_ANGLES[batchIndex % FOCUS_ANGLES.length],
        citationCount: item.citations.length,
        question: item.question,
        batchIndex,
        batchRequestedCount: requestedCount,
        batchEffectiveCount: effectiveCount,
        plan: quotaConsume.plan,
        mcLimit: quotaConsume.limitPerMonth,
      })),
    );
    if (process.env.NODE_ENV !== "production") {
      console.info("[generate-mc-batch] jobs-persisted", {
        requestId,
        ownerId,
        jobRowsInserted: items.length,
        requestedCount,
        effectiveCount,
      });
    }
    metrics.jobPersistMs += nowMs() - jobPersistStartedAt;

    const resp: GenerateMcBatchOk = {
      ok: true,
      batchId: randomUUID(),
      requestId,
      requestedCount,
      effectiveCount,
      returnedCount: items.length,
      items,
    };

    const totalRequestMs = nowMs() - requestStartedAt;
    const usedFileIds = Array.from(new Set(metrics.usedFileIds));
    const uniquePickedChunkCount = new Set(metrics.usedChunkIds).size;
    console.info("[generate-mc-batch] diagnostics", {
      requestId,
      scopeFolderIds,
      fileCountInScope: metrics.fileCountInScope,
      docChunksInScope: metrics.docChunksInScope,
      docChunkCountMode: metrics.docChunkCountMode,
      pickedChunkCount: metrics.pickedChunkCount,
      uniquePickedChunkCount,
      totalCharactersInPickedChunks: metrics.totalCharactersInPickedChunks,
      chunksRejectedForMc: metrics.chunksRejectedForMc,
      chunksDownweightedForMc: metrics.chunksDownweightedForMc,
      acceptedChunkReasonCounts: metrics.acceptedChunkReasonCounts,
      rejectedChunkReasonCounts: metrics.rejectedChunkReasonCounts,
      chunkRejectReasonCounts: metrics.rejectedChunkReasonCounts,
      downweightedChunkReasonCounts: metrics.downweightedChunkReasonCounts,
      waveCount: metrics.waveCount,
      maxInFlightOpenAi: metrics.maxInFlightOpenAi,
      abortSource: metrics.abortSource,
      openAiCallCount: metrics.openAiCallCount,
      invalidModelOutputCount: metrics.invalidModelOutputCount,
      openAiCallDurationsMs: metrics.openAiCallDurationsMs,
      openAiCallCharacters: metrics.openAiCallCharacters,
      totalOpenAiMs: metrics.totalOpenAiMs,
      totalRetrievalMs: metrics.totalRetrievalMs,
      totalPromptBuildMs: metrics.totalPromptBuildMs,
      totalNormalizationMs: metrics.totalNormalizationMs,
      stageTimingsMs: {
        topicLookup: metrics.topicLookupMs,
        filesLookup: metrics.filesLookupMs,
        scopeChunkCount: metrics.scopeChunkCountMs,
        retrieval: metrics.totalRetrievalMs,
        promptBuild: metrics.totalPromptBuildMs,
        model: metrics.totalOpenAiMs,
        parsingAndPostProcessing: metrics.totalNormalizationMs,
        saveLastUsed: metrics.saveLastUsedMs,
        jobPersist: metrics.jobPersistMs,
        timeToFirstAccepted: metrics.timeToFirstAcceptedMs,
        total: totalRequestMs,
      },
      totalRequestMs,
      sequentialOpenAiCalls: metrics.sequentialOpenAiCalls,
      retryOpenAiCalls: metrics.retryOpenAiCalls,
      usedFileIds,
    });
    console.info("[generate-mc-batch] request-end", {
      requestId,
      status: 200,
      totalRequestMs,
      abortSource: metrics.abortSource,
    });

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[generate-mc-batch] route error:", err);
    const aborted =
      err?.name === "AbortError" ||
      String(err?.message ?? "").toLowerCase().includes("abort") ||
      String(err?.cause ?? "").toLowerCase().includes("abort");
    console.info("[generate-mc-batch] request-end", {
      requestId,
      status: aborted ? "aborted" : 500,
      totalRequestMs: nowMs() - requestStartedAt,
      abortSource: metrics.abortSource,
    });
    console.info("[generate-mc-batch] diagnostics", {
      requestId,
      totalRequestMs: nowMs() - requestStartedAt,
      fileCountInScope: metrics.fileCountInScope,
      docChunksInScope: metrics.docChunksInScope,
      docChunkCountMode: metrics.docChunkCountMode,
      pickedChunkCount: metrics.pickedChunkCount,
      uniquePickedChunkCount: new Set(metrics.usedChunkIds).size,
      totalCharactersInPickedChunks: metrics.totalCharactersInPickedChunks,
      chunksRejectedForMc: metrics.chunksRejectedForMc,
      chunksDownweightedForMc: metrics.chunksDownweightedForMc,
      acceptedChunkReasonCounts: metrics.acceptedChunkReasonCounts,
      rejectedChunkReasonCounts: metrics.rejectedChunkReasonCounts,
      chunkRejectReasonCounts: metrics.rejectedChunkReasonCounts,
      downweightedChunkReasonCounts: metrics.downweightedChunkReasonCounts,
      waveCount: metrics.waveCount,
      maxInFlightOpenAi: metrics.maxInFlightOpenAi,
      abortSource: metrics.abortSource,
      openAiCallCount: metrics.openAiCallCount,
      invalidModelOutputCount: metrics.invalidModelOutputCount,
      openAiCallDurationsMs: metrics.openAiCallDurationsMs,
      totalOpenAiMs: metrics.totalOpenAiMs,
      totalRetrievalMs: metrics.totalRetrievalMs,
      totalPromptBuildMs: metrics.totalPromptBuildMs,
      totalNormalizationMs: metrics.totalNormalizationMs,
      stageTimingsMs: {
        topicLookup: metrics.topicLookupMs,
        filesLookup: metrics.filesLookupMs,
        scopeChunkCount: metrics.scopeChunkCountMs,
        retrieval: metrics.totalRetrievalMs,
        promptBuild: metrics.totalPromptBuildMs,
        model: metrics.totalOpenAiMs,
        parsingAndPostProcessing: metrics.totalNormalizationMs,
        saveLastUsed: metrics.saveLastUsedMs,
        jobPersist: metrics.jobPersistMs,
        timeToFirstAccepted: metrics.timeToFirstAcceptedMs,
        total: nowMs() - requestStartedAt,
      },
      sequentialOpenAiCalls: metrics.sequentialOpenAiCalls,
      retryOpenAiCalls: metrics.retryOpenAiCalls,
      usedFileIds: Array.from(new Set(metrics.usedFileIds)),
    });
    const out: GenerateMcBatchErr = { ok: false, error: err?.message ?? "Uventet fejl i generate-mc-batch.", requestId };
    const status = out.error === "Unauthorized" ? 401 : 500;
    return NextResponse.json(out, { status });
  }
}

