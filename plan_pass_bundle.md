# Plan-pass bundle


Repo: C:\Projects\ai-studiepakke\notely-v2
Commit: 4d5b6ca



---
## lib/quota.ts

// lib/quota.ts
import { createClient } from "@supabase/supabase-js";

export type QuotaFeature = "import" | "evaluate" | "trainer_round";

type QuotaOk = { ok: true; remaining: number | null };
type QuotaError = { ok: false; status: number; message: string };
export type QuotaResult = QuotaOk | QuotaError;

/** Supabase-service-klient (bypasser RLS). */
function getServiceClient(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn(
      "[quota] Mangler NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY – skipper quota-check.",
    );
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

/** UTC månedsvindue (end exclusive). */
function getMonthWindowUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: resetAt.toISOString() };
}

/** Hent månedlig limit for plan+feature fra plan_limits. */
async function loadMonthlyLimit(
  supabase: any,
  plan: string,
  feature: QuotaFeature,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("plan_limits")
    .select("monthly_limit")
    .eq("plan", plan)
    .eq("feature", feature)
    .maybeSingle();

  if (error) {
    console.error("[quota] plan_limits error:", error);
    return null;
  }

  const monthly = (data as any)?.monthly_limit;
  return typeof monthly === "number" ? monthly : null;
}

/** Robust count af jobs pr. måned. */
async function countJobsThisMonth(opts: {
  supabase: any;
  ownerId: string;
  kind: string;
  statuses?: string[];
}): Promise<number> {
  const { supabase, ownerId, kind, statuses } = opts;
  const { startIso, endIso } = getMonthWindowUTC();

  const tsCols: Array<"queued_at" | "created_at"> = ["queued_at", "created_at"];

  for (const tsCol of tsCols) {
    if (statuses?.length) {
      const r1 = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("kind", kind)
        .in("status", statuses)
        .gte(tsCol, startIso)
        .lt(tsCol, endIso);

      if (!r1.error && r1.count != null) return r1.count ?? 0;
    }

    const r2 = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", kind)
      .gte(tsCol, startIso)
      .lt(tsCol, endIso);

    if (!r2.error && r2.count != null) return r2.count ?? 0;
  }

  return 0;
}

/** Tæl forbrug denne måned. */
async function countUsageThisMonth(
  supabase: any,
  ownerId: string,
  feature: QuotaFeature,
): Promise<number> {
  if (feature === "import") {
    return countJobsThisMonth({
      supabase,
      ownerId,
      kind: "import",
      statuses: ["succeeded", "finished", "completed"],
    });
  }

  if (feature === "trainer_round") {
    return countJobsThisMonth({
      supabase,
      ownerId,
      kind: "trainer_round",
      statuses: ["succeeded"],
    });
  }

  // evaluate (bruges evt. til simulator/oral senere)
  return countJobsThisMonth({
    supabase,
    ownerId,
    kind: "evaluate",
    statuses: ["succeeded"],
  });
}

/**
 * ensureQuotaAndDecrement
 * Returnerer ok:false hvis dette kald ville overskride grænsen.
 */
export async function ensureQuotaAndDecrement(
  ownerId: string,
  feature: QuotaFeature,
  cost = 1,
): Promise<QuotaResult> {
  const supabase = getServiceClient();
  if (!supabase) return { ok: true, remaining: null };

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota] profile error:", profileErr);

  const plan = ((profile as any)?.plan as string | undefined) ?? "freemium";

  const limit = await loadMonthlyLimit(supabase, plan, feature);
  if (!limit || limit <= 0) return { ok: true, remaining: null };

  const used = await countUsageThisMonth(supabase, ownerId, feature);

  const effectiveCost = Number.isFinite(cost) && cost > 0 ? cost : 1;
  const wouldUse = used + effectiveCost;

  if (wouldUse > limit) {
    const remainingNow = Math.max(0, limit - used);

    const msg =
      feature === "import"
        ? "Du har brugt alle uploads for denne måned på din nuværende plan."
        : feature === "trainer_round"
          ? "Du har brugt alle Træner-runder for denne måned på din nuværende plan."
          : "Du har brugt alle evalueringer for denne måned på din nuværende plan.";

    return {
      ok: false,
      status: 402,
      message:
        remainingNow > 0
          ? `${msg} (Du har ${remainingNow} tilbage, men dette kald ville overskride grænsen.)`
          : msg,
    };
  }

  return { ok: true, remaining: limit - wouldUse };
}



---
## lib/rateLimit.ts

// lib/rateLimit.ts
import "server-only";

import { createClient } from "@supabase/supabase-js";

type RateLimitOk = { ok: true };
type RateLimitBlocked = { ok: false; status: 429; message: string; retryAfterMs: number };
export type RateLimitResult = RateLimitOk | RateLimitBlocked;

function getServiceClient(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn("[rateLimit] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY – skip.");
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function formatWait(ms: number) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s === 1 ? "1 sekund" : `${s} sekunder`;
}

export async function enforceRateLimit(
  ownerId: string,
  key: string,
  opts: { limit: number; windowSeconds: number; minIntervalMs?: number },
  actionLabel?: string,
): Promise<RateLimitResult> {
  const sb = getServiceClient();
  if (!sb) return { ok: true };

  const { data, error } = await sb.rpc("rate_limit_check", {
    p_owner_id: ownerId,
    p_key: key,
    p_limit: opts.limit,
    p_window_seconds: opts.windowSeconds,
    p_min_interval_ms: opts.minIntervalMs ?? 0,
  });

  if (error) {
    console.error("[rateLimit] rpc error:", error);
    return { ok: true }; // fail-open
  }

  const row = Array.isArray(data) ? data[0] : data;
  const allowed = !!row?.allowed;
  const retryMs = Number(row?.retry_after_ms ?? 0) || 0;

  if (!allowed) {
    const label = actionLabel || "For mange kald";
    const ms = retryMs > 0 ? retryMs : 1000;
    return {
      ok: false,
      status: 429,
      retryAfterMs: ms,
      message: `${label}: vent ${formatWait(ms)} og prøv igen.`,
    };
  }

  return { ok: true };
}



---
## app/api/quota/current/route.ts

// app/api/quota/current/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASHCARDS_PER_GENERATION = 10;

function n0(x: number | null | undefined) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function isFiniteNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function capUsed(used: number, limit: number | null): number {
  return isFiniteNum(limit) && limit > 0 ? Math.min(used, limit) : used;
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

function getMonthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(resetAt.getTime() - 1);

  return {
    monthStart: start.toISOString(),
    resetAt: resetAt.toISOString(),
    monthEnd: monthEnd.toISOString(),
  };
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function countJobs(opts: {
  admin: any;
  ownerId: string;
  kind: string;
  from?: string;
  to?: string;
  statuses?: string[];
}) {
  const { admin, ownerId, kind, from, to, statuses } = opts;

  // ✅ jobs har ikke inserted_at -> kun queued_at/created_at
  const tsCols = from && to ? (["queued_at", "created_at"] as const) : ([null] as const);
  let lastErr: any = null;

  for (const tsCol of tsCols) {
    if (statuses?.length) {
      let q1 = admin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("kind", kind)
        .in("status", statuses);

      if (tsCol && from && to) q1 = q1.gte(tsCol, from).lt(tsCol, to);

      const r1 = await q1;
      if (!r1.error && r1.count != null) {
        return { count: n0(r1.count), used: { tsCol, withStatus: true } };
      }
      lastErr = r1.error ?? lastErr;
    }

    let q2 = admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", kind);

    if (tsCol && from && to) q2 = q2.gte(tsCol, from).lt(tsCol, to);

    const r2 = await q2;
    if (!r2.error && r2.count != null) {
      return { count: n0(r2.count), used: { tsCol, withStatus: false } };
    }
    lastErr = r2.error ?? lastErr;
  }

  return { count: 0, used: null as any, error: lastErr };
}

async function countFlashcardUnitsThisMonth(opts: {
  admin: any;
  ownerId: string;
  from: string;
  to: string;
  unitsPerSession: number;
}) {
  const { admin, ownerId, from, to, unitsPerSession } = opts;

  const cols = ["requested", "returned", "cards_returned", "cards_count", "card_count", "count"] as const;
  const tsCols = ["created_at"] as const;

  for (const tsCol of tsCols) {
    for (const col of cols) {
      const r = await admin
        .from("flashcard_sessions")
        .select(col)
        .eq("owner_id", ownerId)
        .gte(tsCol, from)
        .lt(tsCol, to)
        .limit(5000);

      if (r.error || !Array.isArray(r.data)) continue;

      let sum = 0;
      let hits = 0;

      for (const row of r.data as any[]) {
        const v = Number((row as any)?.[col]);
        if (Number.isFinite(v)) {
          sum += v;
          hits++;
        }
      }

      if (hits > 0) {
        return { units: sum, meta: { mode: "sum", tsCol, col, hits } };
      }
    }
  }

  const r2 = await admin
    .from("flashcard_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .gte("created_at", from)
    .lt("created_at", to);

  if (!r2.error && r2.count != null) {
    const cnt = Number(r2.count ?? 0) || 0;
    return { units: cnt * unitsPerSession, meta: { mode: "rowCount", cnt, unitsPerSession } };
  }

  return { units: 0, meta: { mode: "unknown" } };
}

function pickLimit(planLimits: any[] | null | undefined, feature: string): number | null {
  const v = (planLimits ?? []).find((r: any) => r.feature === feature)?.monthly_limit ?? null;
  return isFiniteNum(v) ? Math.round(v) : null;
}

export async function GET(req: NextRequest) {
  let ownerId = "";
  let mode: "auth" | "dev" = "auth";

  try {
    const u = await requireUser(req);
    ownerId = u.id;
    mode = u.mode;
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let admin: any;
  try {
    admin = supabaseAdmin();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server config mangler.", details: String(e?.message ?? e) },
      { status: 500 },
    );
  }

  const now = new Date();
  const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(now);

  const { data: profile } = await admin.from("profiles").select("id, plan").eq("id", ownerId).maybeSingle();
  const plan = normalizePlan((profile as any)?.plan ?? "freemium");

  const { data: planLimitRows } = await admin
    .from("plan_limits")
    .select("plan, feature, monthly_limit")
    .eq("plan", plan);

  const planLimits = planLimitRows ?? [];
  const importLimit = pickLimit(planLimits, "import");
  const trainerRoundLimit = pickLimit(planLimits, "trainer_round");
  const mcLimit = pickLimit(planLimits, "mc_generate");
  const flashLimit = pickLimit(planLimits, "flashcards_generate");

  const importMonth = await countJobs({
    admin,
    ownerId,
    kind: "import",
    from: monthStart,
    to: resetAt,
    statuses: ["succeeded", "finished", "completed"],
  });

  const trainerRoundMonth = await countJobs({
    admin,
    ownerId,
    kind: "trainer_round",
    from: monthStart,
    to: resetAt,
    statuses: ["succeeded"],
  });

  const mcMonth = await countJobs({
    admin,
    ownerId,
    kind: "mc_generate",
    from: monthStart,
    to: resetAt,
    statuses: ["succeeded"],
  });

  const flashUnitsRes = await countFlashcardUnitsThisMonth({
    admin,
    ownerId,
    from: monthStart,
    to: resetAt,
    unitsPerSession: FLASHCARDS_PER_GENERATION,
  });

  const importMonthUsedRaw = n0(importMonth.count);
  const trainerRoundUsedRaw = n0(trainerRoundMonth.count);
  const mcMonthUsedRaw = n0(mcMonth.count);
  const flashMonthUsedRaw = Number(flashUnitsRes.units ?? 0) || 0;

  const importMonthUsed = capUsed(importMonthUsedRaw, importLimit);
  const trainerRoundUsed = capUsed(trainerRoundUsedRaw, trainerRoundLimit);
  const mcMonthUsed = capUsed(mcMonthUsedRaw, mcLimit);
  const flashMonthUsed = capUsed(n0(flashMonthUsedRaw), flashLimit);

  return NextResponse.json({
    ok: true,
    mode,
    ownerId,
    now: now.toISOString(),
    monthStart,
    monthEnd,
    resetAt,
    plan,

    import: { usedThisMonth: importMonthUsed, limitPerMonth: importLimit },
    trainer_round: { usedThisMonth: trainerRoundUsed, limitPerMonth: trainerRoundLimit },
    mc_generate: { usedThisMonth: mcMonthUsed, limitPerMonth: mcLimit },
    flashcards_generate: { usedThisMonth: flashMonthUsed, limitPerMonth: flashLimit },

    ...(process.env.NODE_ENV !== "production"
      ? {
          _debug: {
            raw: {
              import_jobs: importMonthUsedRaw,
              trainer_round_jobs: trainerRoundUsedRaw,
              mc_generate_jobs: mcMonthUsedRaw,
              flashcards_units: n0(flashMonthUsedRaw),
            },
            flashcards: { meta: flashUnitsRes.meta ?? null },
            jobsTs: {
              import: importMonth.used ?? null,
              trainer_round: trainerRoundMonth.used ?? null,
              mc_generate: mcMonth.used ?? null,
            },
          },
        }
      : {}),
  });
}



---
## app/api/evaluate/route.ts

// app/api/evaluate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";
import { ensureQuotaAndDecrement } from "@/lib/quota";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireFlowModel, type NotelyFlow } from "@/lib/openai/requireModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  strengths?: unknown;
  improvements?: unknown;
  next_steps?: unknown;
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
      .select("id, content, file_id, folder_id, created_at")
      .eq("owner_id", ownerId)
      .eq("file_id", fileId)
      .order("created_at", { ascending: true })
      .limit(80);

    if (error) {
      console.error("[evaluate] doc_chunks error (file):", error);
      return { text: "", chunkCount: 0, citations: [] };
    }

    const rows: ChunkRow[] = (chunks ?? []) as ChunkRow[];
    const nonEmptyRows = rows.filter((r) => (r.content ?? "").trim().length > 0);
    const nonEmpty = nonEmptyRows.map((r) => (r.content ?? "").trim());

    if (!nonEmpty.length) return { text: "", chunkCount: 0, citations: [] };

    let text = nonEmpty.join("\n\n---\n\n");
    if (text.length > maxChars) text = text.slice(0, maxChars);

    const firstChunkId = String(nonEmptyRows[0]?.id ?? fileId);
    const citations: Citation[] = [
      {
        chunkId: firstChunkId,
        fileId,
        title,
        url: null,
      },
    ];

    return { text, chunkCount: nonEmpty.length, citations };
  }

  if (explicitFileId) {
    const r = await buildFromFileId(explicitFileId);
    return {
      contextText: r.text,
      usedFileId: explicitFileId,
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

  if (!filesInScope.length) return { contextText: "", usedFileId: null, chunkCount: 0, citations: [] };

  const recentFiles = filesInScope.slice(0, Math.min(filesInScope.length, 5));
  const idx = Math.floor(Math.random() * recentFiles.length);
  const chosenFile = recentFiles[idx];

  const r = await buildFromFileId(String(chosenFile.id));
  return {
    contextText: r.text,
    usedFileId: String(chosenFile.id),
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
  // til jobs-log i outer catch
  let sb: any = null;
  let ownerId = "";
  let jobId: string | null = null;
  let t0 = Date.now();

  try {
    const parsed = await readJsonBody<Partial<EvalRequest>>(req);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    const body = parsed.value ?? {};
    const question = String(body.question ?? "").trim();
    const answer = String(body.answer ?? "").trim();

    if (!question || !answer) {
      return NextResponse.json({ ok: false, error: "Mangler question eller answer" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY (required)" }, { status: 500 });
    }

    // Folder/note/scope normaliseres tidligt (bruges både i jobs + exam_sessions)
    const folderId = typeof body.folder_id === "string" && body.folder_id.trim() ? body.folder_id.trim() : null;
    const noteId = typeof body.note_id === "string" && body.note_id.trim() ? body.note_id.trim() : null;

    const scopeFolderIds = Array.isArray(body.scopeFolderIds)
      ? body.scopeFolderIds
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
      : [];

    const flow: NotelyFlow = pickFlow(body);
const roundId = pickRoundId(body);

const includeBackgroundClient = !!body.includeBackground;
const includeBackground = flow === "trainer" ? true : includeBackgroundClient;

    // Auth/dev-bypass
let mode: "auth" | "dev" = "auth";

try {
  const u = await requireUser(req);
  sb = u.sb;
  ownerId = u.id;
  mode = u.mode;
  t0 = Date.now();

  // Rate-limit (evaluate)
  const rl = await enforceRateLimit(
    ownerId,
    "evaluate",
    { limit: 6, windowSeconds: 60, minIntervalMs: 5000 },
    "Evaluer svar",
  );

  if (!rl.ok) {
    const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return NextResponse.json(
      { ok: false, error: rl.message, retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }
} catch (e: any) {
  const msg = String(e?.message ?? "");
  const isAuth = msg.toLowerCase().includes("unauthorized");
  if (!isAuth) console.error("[evaluate] requireUser crash:", e);
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

    let model: string;
    try {
      model = requireFlowModel(flow);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? "Missing model env" }, { status: 500 });
    }

    // ✅ Trainer-runde gating (2 evals pr. runde) + ingen evaluate-quota for trainer
    let trainerRoundMeta: any = null;
    if (flow === "trainer") {
      if (!roundId) {
        return NextResponse.json(
          { ok: false, error: "Tryk “Generér nyt spørgsmål” først for at starte en runde." },
          { status: 400 },
        );
      }

      const rr = await loadTrainerRound(sb, ownerId, roundId);
      if (!rr) {
        return NextResponse.json(
          { ok: false, error: "Ugyldig runde. Generér et nyt spørgsmål for at starte en ny runde." },
          { status: 400 },
        );
      }

      trainerRoundMeta = rr.meta ?? {};
      const evalsUsed = n0(trainerRoundMeta?.evals_used);
      const maxEvals = n0(trainerRoundMeta?.max_evals) > 0 ? n0(trainerRoundMeta?.max_evals) : TRAINER_EVALS_PER_ROUND;

      if (evalsUsed >= maxEvals) {
        return NextResponse.json(
          { ok: false, error: "Denne runde er brugt op. Generér et nyt spørgsmål for at starte en ny runde." },
          { status: 402 },
        );
      }
    } else {
      // Quota-check (kun for simulator/oral)
      const cost = 1;
      const quota = await ensureQuotaAndDecrement(ownerId, "evaluate", cost);
      if (!quota.ok) {
        console.warn("[/api/evaluate] quota exceeded:", quota.message);
        return NextResponse.json({ ok: false, error: quota.message, feature: "evaluate" }, { status: quota.status });
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
          folder_id: folderId,
          file_id: null,
          meta: {
            flow,
            includeBackground,
            scopeFolderIds,
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
    let contextChunkCount = 0;
    let citations: Citation[] = [];

    if (includeBackground) {
      const ctx = await buildContextForEvaluation({ sb, ownerId, body, maxChars: 8000 });
      contextText = ctx.contextText;
      usedFileId = ctx.usedFileId;
      contextChunkCount = ctx.chunkCount;
      citations = ctx.citations;

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

    const systemPrompt = `
Du er dansk eksamenscensor.

Du får:
- et eksamensspørgsmål ("question"),
- et elevsvar ("answer"),
- og evt. baggrundsmateriale ("context") fra elevens eget pensum.

Hvis "context" er tomt, skal du vurdere ud fra almindelige faglige kriterier og spørgsmålet.

Du skal:
- give en score i procent (0–100)
- give kort, præcis feedback på dansk.

Du SKAL svare som gyldigt JSON med PRÆCIS disse felter:

{
  "score": number,
  "overall": string,
  "strengths": string[],
  "improvements": string[],
  "next_steps": string[]
}

Alle arrays SKAL indeholde mindst ét element.
Ingen tekst uden for JSON-objektet.
`.trim();

    const userPayload = { question, answer, context: contextText };

    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsedEval: EvalJson = {};
    try {
      parsedEval = JSON.parse(raw) as EvalJson;
    } catch (e) {
      console.error("[evaluate] JSON-parse fejl på raw:", raw, e);
      parsedEval = {};
    }

    const scoreRaw = typeof parsedEval.score === "number" ? parsedEval.score : Number(parsedEval.score);
    const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 0;

    const overall =
      (parsedEval.overall && String(parsedEval.overall).trim().replace(/\s+/g, " ")) ||
      "Overordnet et fint, men kort svar.";

    let strengths = ensureStringArray(parsedEval.strengths);
    let improvements = ensureStringArray(parsedEval.improvements);
    let nextSteps = ensureStringArray(parsedEval.next_steps);

    if (!strengths.length) strengths = ["Du rammer noget af kernen, men kan blive mere præcis."];
    if (!improvements.length) improvements = ["Uddyb centrale begreber og knyt dem tydeligere til spørgsmålet."];
    if (!nextSteps.length) nextSteps = ["Skriv et forbedret svar, hvor du bruger 2–3 nøglebegreber og et konkret eksempel."];

    const feedbackText = [
      `Samlet vurdering: ${overall}`,
      "",
      "Styrker:",
      ...strengths.map((s) => `- ${s}`),
      "",
      "Det kan forbedres:",
      ...improvements.map((s) => `- ${s}`),
      "",
      "Forslag til næste skridt:",
      ...nextSteps.map((s) => `- ${s}`),
    ].join("\n");

    // ✅ bump evals_used på runden (LLM-kald er gennemført)
    if (flow === "trainer" && roundId) {
      const baseMeta = trainerRoundMeta ?? {};
      await bumpTrainerRoundEval(sb, ownerId, roundId, baseMeta);
    }

    const insertPayload = {
      owner_id: ownerId,
      question,
      answer,
      feedback: feedbackText,
      score,
      folder_id: folderId,
      source_type: flow,
      meta: {
        includeBackground,
        scopeFolderIds,
        note_id: noteId,
        file_id: usedFileId,
        contextChunkCount,
        contextPreview: contextText ? contextText.slice(0, 400) : null,
        citations,
        mode,
        round_id: flow === "trainer" ? roundId : null,
      },
    };

    const { error: insertError } = await sb.from("exam_sessions").insert(insertPayload);
    if (insertError) console.error("[evaluate] insert exam_sessions fejl:", insertError);

    if (!insertError && flow === "trainer") {
      void pruneTrainerHistory(sb, ownerId);
    }

    // ✅ jobs-log: succeeded
    if (jobId) {
      try {
        const tokensUsed = (completion as any)?.usage?.total_tokens ?? null;
        await sb
          .from("jobs")
          .update({
            status: "succeeded",
            finished_at: new Date().toISOString(),
            latency_ms: Math.max(0, Date.now() - t0),
            tokens_used: typeof tokensUsed === "number" ? tokensUsed : null,
            feedbackscore: score,
            result: { score, round_id: flow === "trainer" ? roundId : null },
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", ownerId)
          .eq("id", jobId);
      } catch (e) {
        console.error("[evaluate] jobs update (succeeded) error:", e);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        score,
        feedback: feedbackText,
        usedFileId,
        citations,
      },
      { status: 200 },
    );
  } catch (err: any) {
    // ✅ jobs-log: failed
    if (sb && ownerId && jobId) {
      try {
        await sb
          .from("jobs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            latency_ms: Math.max(0, Date.now() - t0),
            error_message: String(err?.message ?? "failed"),
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", ownerId)
          .eq("id", jobId);
      } catch {
        // ignore
      }
    }

    console.error("EVALUATE /api/evaluate error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Intern fejl i evalueringen" }, { status: 500 });
  }
}



---
## app/api/generate-question/route.ts

// app/api/generate-question/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { ensureQuotaAndDecrement } from "@/lib/quota";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type GenerateQuestionRequest = {
  folderId?: string | null;
  folder_id?: string | null;

  scopeFolderIds?: string[];

  difficulty?: Difficulty;
  maxContextChunks?: number;

  // ✅ Runde-API
  roundId?: string | null;
  round_id?: string | null;

  // ✅ Anti-repetition (valgfri): klient kan sende senest brugte filer
  excludeFileIds?: string[];
  exclude_file_ids?: string[];

  // (ignoreres men tilladt)
  note_id?: string | null;
  file_id?: string | null;
};

type GenerateQuestionResponse = {
  ok: true;
  question: string;
  topic: string;
  folder_id: string | null;
  note_id: string | null;
  usedFileId: string | null;

  roundId: string;
  attemptsUsed: number;
  attemptsMax: number;
};

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true as const, value: {} as T };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

function pickDifficulty(raw: any): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function uniqTrimmed(ids: string[]) {
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

async function loadLastUsedFileId(sb: any, ownerId: string, scopeKey: string): Promise<string | null> {
  try {
    const { data } = await sb
      .from("generation_state")
      .select("last_used_file_id")
      .eq("owner_id", ownerId)
      .eq("kind", "question")
      .eq("scope_key", scopeKey)
      .maybeSingle();

    const v = (data as any)?.last_used_file_id;
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function saveLastUsedFileId(sb: any, ownerId: string, scopeKey: string, fileId: string) {
  try {
    await sb.from("generation_state").upsert(
      {
        owner_id: ownerId,
        kind: "question",
        scope_key: scopeKey,
        last_used_file_id: fileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,kind,scope_key" },
    );
  } catch {
    // ignore
  }
}

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
};

function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

function interleavePicked(fileOrder: string[], pickedByFile: Record<string, ChunkRow[]>, targetTotal: number) {
  const idx = new Map<string, number>();
  const out: ChunkRow[] = [];
  for (const f of fileOrder) idx.set(f, 0);

  while (out.length < targetTotal) {
    let added = false;
    for (const f of fileOrder) {
      const list = pickedByFile[f] ?? [];
      const i = idx.get(f) ?? 0;
      if (i < list.length) {
        out.push(list[i]);
        idx.set(f, i + 1);
        added = true;
        if (out.length >= targetTotal) break;
      }
    }
    if (!added) break;
  }

  return out;
}

function n0(x: any) {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

async function loadRound(sb: any, ownerId: string, roundId: string) {
  const { data } = await sb
    .from("jobs")
    .select("id, kind, status, meta, result")
    .eq("owner_id", ownerId)
    .eq("kind", "trainer_round")
    .eq("id", roundId)
    .maybeSingle();

  return data ?? null;
}

export async function POST(req: NextRequest) {
  let sb: any = null;
  let ownerId = "";
  let roundIdForCatch: string | null = null;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY mangler i .env.local." }, { status: 500 });
    }

    const parsed = await readJsonBody<GenerateQuestionRequest>(req);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    const body = parsed.value ?? {};
    const difficulty = pickDifficulty(body.difficulty);

    const rawMax = body.maxContextChunks;
    const maxContextChunks =
      typeof rawMax === "number" && Number.isFinite(rawMax)
        ? Math.min(Math.max(Math.round(rawMax), 4), 32)
        : 12;

    const folderId =
      typeof body.folderId === "string" && body.folderId.trim()
        ? body.folderId.trim()
        : typeof body.folder_id === "string" && body.folder_id.trim()
          ? body.folder_id.trim()
          : null;

    const scopeFolderIds = Array.isArray(body.scopeFolderIds)
      ? uniqTrimmed(body.scopeFolderIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0))
      : [];

    const effectiveFolderIds = scopeFolderIds.length > 0 ? scopeFolderIds : folderId ? [folderId] : [];
    const scopeKey = scopeKeyFromFolderIds(effectiveFolderIds);

    const roundIdRaw =
      typeof body.roundId === "string" && body.roundId.trim()
        ? body.roundId.trim()
        : typeof body.round_id === "string" && body.round_id.trim()
          ? body.round_id.trim()
          : null;

    const excludeFileIds = uniqTrimmed([
      ...(Array.isArray(body.excludeFileIds) ? body.excludeFileIds : []),
      ...(Array.isArray(body.exclude_file_ids) ? body.exclude_file_ids : []),
    ]);

    // Auth/dev-bypass
    let mode: "auth" | "dev" = "auth";
    try {
      const u = await requireUser(req);
      sb = u.sb;
      ownerId = u.id;
      mode = u.mode;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const isAuth = msg.toLowerCase().includes("unauthorized");
      if (!isAuth) console.error("[generate-question] requireUser crash:", e);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Rate-limit (fail-open)
    try {
      const rl = await enforceRateLimit(
        ownerId,
        "trainer_generate",
        { limit: 10, windowSeconds: 60, minIntervalMs: 2000 },
        "Generér nyt spørgsmål",
      );

      if (!rl.ok) {
        const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
        return NextResponse.json(
          { ok: false, error: rl.message, retryAfterMs: rl.retryAfterMs },
          { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
        );
      }
    } catch (e) {
      console.error("[generate-question] enforceRateLimit failed (fail-open):", e);
    }

    // ✅ Runde-setup (2 forsøg)
    const ATTEMPTS_MAX = 2;
    let roundId = roundIdRaw;
    let roundMeta: any = null;
    let previousQuestion: string | null = null;

    if (roundId) {
      const r = await loadRound(sb, ownerId, roundId);
      if (!r) {
        roundId = null;
      } else {
        roundMeta = (r as any).meta ?? {};
        previousQuestion = String((r as any)?.result?.question ?? "").trim() || null;

        const attemptsUsed = n0(roundMeta?.attempts_used);
        const maxAttempts = n0(roundMeta?.max_attempts) || ATTEMPTS_MAX;

        if (attemptsUsed >= maxAttempts) {
          roundId = null;
          roundMeta = null;
          previousQuestion = null;
        }
      }
    }

    // Ingen gyldig runde -> start ny og betal (trainer_round)
    if (!roundId) {
      const quota = await ensureQuotaAndDecrement(ownerId, "trainer_round" as any, 1);
      if (!quota.ok) {
        return NextResponse.json(
          { ok: false, error: quota.message, feature: "trainer_round" },
          { status: quota.status },
        );
      }

      const nowIso = new Date().toISOString();

      const insert = await sb
        .from("jobs")
        .insert({
          owner_id: ownerId,
          kind: "trainer_round",
          status: "queued",
          folder_id: folderId,
          payload: {
            scopeKey,
            folderId,
            scopeFolderIds,
            difficulty,
            maxContextChunks,
            mode,
            excludeFileIds,
          },
          meta: {
            attempts_used: 0,
            max_attempts: ATTEMPTS_MAX,
            scopeKey,
          },
          queued_at: nowIso,
          started_at: nowIso,
          updated_at: nowIso,
        })
        .select("id, meta, result")
        .maybeSingle();

      if (insert.error || !insert.data?.id) {
        console.error("[generate-question] could not create trainer_round job:", insert.error);
        return NextResponse.json({ ok: false, error: "Kunne ikke starte runden (jobs insert fejlede)." }, { status: 500 });
      }

      roundId = String(insert.data.id);
      roundMeta = (insert.data as any).meta ?? {};
      previousQuestion = String((insert.data as any)?.result?.question ?? "").trim() || null;
    }

    roundIdForCatch = roundId;

    // Topic
    let topic = "pensum";
    if (effectiveFolderIds.length > 0) {
      const { data: f } = await sb
        .from("folders")
        .select("name")
        .eq("owner_id", ownerId)
        .eq("id", effectiveFolderIds[0])
        .maybeSingle();
      if (f?.name) topic = String(f.name);
    }

    const lastUsed = await loadLastUsedFileId(sb, ownerId, scopeKey);

    // Filer i scope
    let filesQ = sb
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(120);

    if (effectiveFolderIds.length > 0) filesQ = filesQ.in("folder_id", effectiveFolderIds);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) console.error("[generate-question] files error:", filesErr);

    const fileRowsAll = (files ?? []) as FileRow[];

    // Først: respekter excludeFileIds
    const fileRowsFiltered =
      excludeFileIds.length > 0 ? fileRowsAll.filter((f) => !excludeFileIds.includes(String(f.id))) : fileRowsAll;

    // Hvis filteret fjernede alt -> fallback
    const fileRows = fileRowsFiltered.length > 0 ? fileRowsFiltered : fileRowsAll;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL_QUESTION || process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Hvis ingen filer: fallback
    if (fileRows.length === 0) {
      const systemPrompt = `
Du er en dansk studieassistent, der skriver ét eksamenslignende spørgsmål.

Skriv ALT på dansk.
Returnér som gyldig JSON: { "question": "..." }
`.trim();

      const completion = await openai.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        temperature: 0.85,
        presence_penalty: 0.25,
        frequency_penalty: 0.35,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({ topic, difficulty, previousQuestion, nonce: Math.random().toString(36).slice(2) }) },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let question = "";
      try {
        question = (JSON.parse(raw) as any)?.question?.trim?.() ?? "";
      } catch {
        question = "";
      }
      if (!question) {
        question = `Forklar et centralt begreb fra ${topic}, og vis hvordan det kan bruges analytisk på et konkret eksempel.`;
      }

      const nowIso = new Date().toISOString();
      const meta0 = roundMeta ?? {};
      const used0 = n0(meta0?.attempts_used);
      const maxA = n0(meta0?.max_attempts) || ATTEMPTS_MAX;

      const meta1 = { ...meta0, attempts_used: Math.min(maxA, used0 + 1), max_attempts: maxA };

      await sb
        .from("jobs")
        .update({
          status: "succeeded",
          finished_at: nowIso,
          updated_at: nowIso,
          meta: meta1,
          result: { usedFileId: null, topic, question },
        })
        .eq("owner_id", ownerId)
        .eq("kind", "trainer_round")
        .eq("id", roundId);

      const resp: GenerateQuestionResponse = {
        ok: true,
        question,
        topic,
        folder_id: folderId,
        note_id: null,
        usedFileId: null,
        roundId,
        attemptsUsed: meta1.attempts_used ?? 1,
        attemptsMax: meta1.max_attempts ?? ATTEMPTS_MAX,
      };
      return NextResponse.json(resp, { status: 200 });
    }

    // Rotation: start efter lastUsed
    let start = 0;
    if (lastUsed) {
      const idx = fileRows.findIndex((f) => String(f.id) === String(lastUsed));
      if (idx >= 0) start = (idx + 1) % fileRows.length;
    }
    const rotated = [...fileRows.slice(start), ...fileRows.slice(0, start)];

    // Hvor mange filer blander vi?
    const desiredFiles = Math.min(6, Math.max(2, Math.ceil(maxContextChunks / 3)), rotated.length);
    const scanMax = Math.min(40, rotated.length);
    const scanList = shuffle(rotated.slice(0, scanMax));

    const pickedByFile: Record<string, ChunkRow[]> = {};
    const usedFiles: FileRow[] = [];

    const perFileTake = Math.max(2, Math.ceil(maxContextChunks / desiredFiles));
    const perFilePool = Math.min(140, Math.max(40, perFileTake * 12));

    for (const f of scanList) {
      if (usedFiles.length >= desiredFiles) break;

      const fileId = String(f.id);

      const { data: pool, error: poolErr } = await sb
        .from("doc_chunks")
        .select("id,file_id,content,created_at")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(perFilePool);

      if (poolErr) {
        console.error("[generate-question] doc_chunks pool error:", poolErr);
        continue;
      }

      const poolRows = (pool ?? []) as ChunkRow[];
      const nonEmpty = poolRows.filter((r) => (r.content ?? "").trim().length > 0);
      if (nonEmpty.length === 0) continue;

      const picked = shuffle(nonEmpty)
        .slice(0, Math.min(perFileTake, nonEmpty.length))
        .sort((a, b) => {
          const ta = a.created_at ? Date.parse(a.created_at) : 0;
          const tb = b.created_at ? Date.parse(b.created_at) : 0;
          return ta - tb;
        });

      pickedByFile[fileId] = picked;
      usedFiles.push(f);
    }

    if (usedFiles.length === 0) {
      const nowIso = new Date().toISOString();
      await sb
        .from("jobs")
        .update({ status: "failed", finished_at: nowIso, error_message: "no_context", updated_at: nowIso })
        .eq("owner_id", ownerId)
        .eq("kind", "trainer_round")
        .eq("id", roundId);

      return NextResponse.json(
        { ok: false, error: "Ingen kontekst fundet (doc_chunks) i scope. Tjek at upload/parse er kørt." },
        { status: 400 },
      );
    }

    const fileMap = new Map<string, FileRow>(usedFiles.map((f) => [String(f.id), f]));
    const fileOrder = shuffle(usedFiles.map((f) => String(f.id)));

    const interleaved = interleavePicked(fileOrder, pickedByFile, maxContextChunks);

    const contextText = interleaved
      .map((c) => {
        const f = fileMap.get(String(c.file_id));
        const title = f ? fileTitle(f) : "Ukendt kilde";
        const txt = (c.content ?? "").trim();
        return `KILDE: ${title}\n\n${txt}`;
      })
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, 9000);

    const usedFileId = String(fileOrder[0] ?? usedFiles[0]?.id ?? "");

    const templates = [
      "Redegør for et centralt begreb, og anvend det på et konkret eksempel fra konteksten.",
      "Analysér et problem i konteksten med fokus på årsager, aktører og konsekvenser.",
      "Diskutér en faglig uenighed eller afvejning i konteksten og argumentér for en løsning.",
      "Sammenlign to begreber/tilgange fra konteksten og vurder deres styrker/svagheder.",
      "Vurdér hvordan en udviklingstendens i konteksten påvirker et centralt tema og begrund med tekstnære eksempler.",
    ];
    const templateHint = templates[Math.floor(Math.random() * templates.length)];

    const systemPrompt = `
Du er en dansk studieassistent, der skriver ét eksamenslignende spørgsmål.

VIGTIGT:
- Spørgsmålet skal kunne besvares ud fra "context".
- Konteksten kan have flere KILDE-afsnit (flere filer).
- Skriv ALT på dansk.
- Skriv kun ÉT spørgsmål (1-2 sætninger).
- Undgå at starte med samme verbum hver gang (variér fx: Redegør, Analysér, Diskutér, Vurdér, Sammenlign).
- Hvis "previousQuestion" er angivet, må du ikke genbruge samme struktur/formulering — lav en ny vinkel.

Returnér som gyldig JSON:
{ "question": "..." }
`.trim();

    const userPayload = {
      topic,
      difficulty,
      templateHint,
      previousQuestion,
      context: contextText,
      nonce: Math.random().toString(36).slice(2),
    };

    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      temperature: 0.85,
      presence_penalty: 0.25,
      frequency_penalty: 0.35,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let question = "";
    try {
      const j = JSON.parse(raw) as { question?: string };
      question = (j.question ?? "").trim();
    } catch {
      question = "";
    }

    if (!question) {
      question = `Forklar et centralt begreb fra ${topic}, og vis hvordan det kan bruges analytisk på et konkret eksempel.`;
    }

    if (usedFileId) await saveLastUsedFileId(sb, ownerId, scopeKey, usedFileId);

    // ✅ runde: increment attempts + mark succeeded + gem spørgsmålet til næste forsøg
    const nowIso = new Date().toISOString();
    const meta0 = roundMeta ?? {};
    const used0 = n0(meta0?.attempts_used);
    const maxA = n0(meta0?.max_attempts) || ATTEMPTS_MAX;

    const meta1 = {
      ...meta0,
      attempts_used: Math.min(maxA, used0 + 1),
      max_attempts: maxA,
    };

    await sb
      .from("jobs")
      .update({
        status: "succeeded",
        finished_at: nowIso,
        updated_at: nowIso,
        meta: meta1,
        result: { usedFileId: usedFileId || null, topic, question },
      })
      .eq("owner_id", ownerId)
      .eq("kind", "trainer_round")
      .eq("id", roundId);

    const resp: GenerateQuestionResponse = {
      ok: true,
      question,
      topic,
      folder_id: folderId,
      note_id: null,
      usedFileId: usedFileId || null,
      roundId,
      attemptsUsed: meta1.attempts_used ?? 1,
      attemptsMax: meta1.max_attempts ?? ATTEMPTS_MAX,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    if (sb && ownerId && roundIdForCatch) {
      try {
        const nowIso = new Date().toISOString();
        await sb
          .from("jobs")
          .update({
            status: "failed",
            finished_at: nowIso,
            error_message: String(err?.message ?? "failed"),
            updated_at: nowIso,
          })
          .eq("owner_id", ownerId)
          .eq("kind", "trainer_round")
          .eq("id", roundIdForCatch);
      } catch {
        // ignore
      }
    }

    console.error("[generate-question] route error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Uventet fejl i generate-question." }, { status: 500 });
  }
}



---
## app/api/generate-mc-batch/route.ts

// app/api/generate-mc-batch/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

type GenerateMcItem = {
  ok: true;
  questionId: string;
  question: string;
  options: McOptionPayload[];
  explanation: string | null;
  citations: McCitationPayload[];
  usedFileId: string | null;
  meta: McMeta;
};

type GenerateMcBatchOk = {
  ok: true;
  batchId: string;
  requestedCount: number; // hvad klienten bad om (fx 10)
  effectiveCount: number; // hvad vi faktisk måtte forsøge (quota-aware)
  returnedCount: number; // hvad der faktisk kom tilbage
  items: GenerateMcItem[];
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
};

type ChunkRow = {
  id: string;
  file_id: string;
  content: string | null;
  created_at: string | null;
  source_url?: string | null;
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function n0(x: number | null | undefined) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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

async function getPlanAndLimit(admin: any, ownerId: string) {
  const { data: profile } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
  const plan = (profile as any)?.plan ?? "freemium";

  const { data: limits } = await admin.from("plan_limits").select("feature, monthly_limit").eq("plan", plan);
  const mcLimit = (limits ?? []).find((r: any) => r.feature === "mc_generate")?.monthly_limit ?? null;

  return { plan, mcLimit };
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

async function logMcJob(admin: any, ownerId: string, payload: any) {
  try {
    await admin.from("jobs").insert({
      owner_id: ownerId,
      kind: "mc_generate",
      status: "succeeded",
      queued_at: new Date().toISOString(),
      payload,
    });
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

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const scopeKey = scopeKeyFromFolderIds(scopeFolderIds);

    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 64);
    const avoidNorm = new Set(avoidQuestions.map(normalizeQuestion));

    const avoidTopics = uniqTrimmed(body.avoidTopics).slice(0, 12);

    const avoidChunkIds = uniqTrimmed(body.avoidChunkIds).slice(0, 800);
    const avoidChunkSet = new Set<string>(avoidChunkIds);

    // Auth
    let ownerId = "";
    try {
      const u = await requireUser(req);
      ownerId = u.id;
    } catch {
      const err: GenerateMcBatchErr = { ok: false, error: "Unauthorized", requestId };
      return NextResponse.json(err, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(new Date());

    // Quota gate (tæl per spørgsmål)
    const { plan, mcLimit } = await getPlanAndLimit(admin, ownerId);
    if (!mcLimit || mcLimit <= 0) {
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Plan limits mangler for mc_generate. Tjek plan_limits.",
        requestId,
        debug: { plan, mcLimit },
      };
      return NextResponse.json(err, { status: 500 });
    }

    const mcMonth = await countMcJobsThisMonth(admin, ownerId, monthStart, resetAt);
    const remaining = Math.max(0, mcLimit - mcMonth.used);

    if (remaining <= 0) {
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Du har nået din grænse for Multiple Choice denne måned.",
        requestId,
        code: "QUOTA_EXCEEDED",
        feature: "mc_generate",
        plan,
        usedThisMonth: mcMonth.used,
        monthlyLimit: mcLimit,
        monthStart,
        monthEnd,
        resetAt,
      };
      return NextResponse.json(err, { status: 429 });
    }

    // ✅ effectiveCount (quota-aware)
    const effectiveCount = Math.min(requestedCount, remaining);

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

    // Filer i scope
    let filesQ = admin
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) console.error("[generate-mc-batch] files error:", filesErr);

    const fileRows = (files ?? []) as FileRow[];
    if (fileRows.length === 0) {
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Ingen filer fundet i scope. Upload materiale først.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
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

    // Lazy cache af chunk-pools pr file (hurtigere batch)
    const poolCache = new Map<string, ChunkRow[]>();
    async function loadPool(fileId: string): Promise<ChunkRow[]> {
      const existing = poolCache.get(fileId);
      if (existing) return existing;

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
        return [];
      }

      const poolRows = ((pool ?? []) as ChunkRow[]).filter((r) => (r.content ?? "").trim().length > 0);
      poolCache.set(fileId, poolRows);
      return poolRows;
    }

    // Helper: vælg næste fil + få chunks pr spørgsmål (respekter avoidChunkSet først)
    async function pickFileAndChunks(): Promise<{ file: FileRow; chunks: ChunkRow[] } | null> {
      const scanMax = Math.min(30, rotated.length);
      const take = chunksPerQuestion(difficulty, maxContextChunks);

      // pass 1: respekter avoidChunkSet
      for (let tries = 0; tries < scanMax; tries++) {
        const idx = (pointer + tries) % rotated.length;
        const f = rotated[idx];
        const fileId = String(f.id);

        const pool = await loadPool(fileId);
        const usable = pool.filter((r) => !avoidChunkSet.has(String(r.id)));

        if (usable.length < 1) continue;

        const picked = shuffle(usable)
          .slice(0, Math.min(take, usable.length))
          .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));

        pointer = (idx + 1) % rotated.length;
        return { file: f, chunks: picked };
      }

      // pass 2: allow reuse
      for (let tries = 0; tries < scanMax; tries++) {
        const idx = (pointer + tries) % rotated.length;
        const f = rotated[idx];
        const fileId = String(f.id);

        const pool = await loadPool(fileId);
        if (pool.length < 1) continue;

        const picked = shuffle(pool)
          .slice(0, Math.min(take, pool.length))
          .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));

        pointer = (idx + 1) % rotated.length;
        return { file: f, chunks: picked };
      }

      return null;
    }

    const model = process.env.OPENAI_MODEL_MC || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const systemPromptBase = `
Du er en dansk studieassistent.
Du laver eksamenslignende multiple choice-spørgsmål ud fra elevens pensum-uddrag.

VIGTIGT:
- Du MÅ KUN bruge den kontekst, du får (KILDE-afsnit).
- Skriv alt på dansk.

KRAV:
- 1 spørgsmål
- 4 svarmuligheder
- Præcis 1 korrekt
- Plausible distraktorer (ikke åbenlyse)
- Spørgsmålet skal være specifikt og må ikke være en ren gentagelse af samme faktasæt.
- Undgå at gøre "samme korrekt-svar" til løsning igen og igen.

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

    const items: GenerateMcItem[] = [];
    let lastUsedFileIdInBatch: string | null = null;

    // ekstra anti-repeat: undgå samme korrekte svar-tekst gentagne gange
    const recentCorrectAnswers = new Set<string>();

    for (let i = 0; i < effectiveCount; i++) {
      const pick = await pickFileAndChunks();
      if (!pick) break;

      const usedFileId = String(pick.file.id);
      const usedFileTitle = fileTitle(pick.file);
      lastUsedFileIdInBatch = usedFileId;

      const usedChunkIds = pick.chunks.map((c) => String(c.id));
      for (const id of usedChunkIds) avoidChunkSet.add(id);

      const contextText = pick.chunks
        .map((c) => `KILDE: ${usedFileTitle}\n\n${(c.content ?? "").trim()}`)
        .filter(Boolean)
        .join("\n\n---\n\n")
        .slice(0, 7000);

      if (!contextText.trim()) continue;

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

      const focusAngle = FOCUS_ANGLES[i % FOCUS_ANGLES.length];

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

      let finalQuestion = "";
      let finalOptions: Array<{ text: string; isCorrect: boolean }> = [];
      let finalExplanation: string | null = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const systemPrompt =
          attempt === 0
            ? systemPromptBase
            : `${systemPromptBase}\nEKSTRA VIGTIGT: Du må IKKE gentage tidligere spørgsmål. Vælg et andet fokus i konteksten og et andet korrekt-svar.`;

        const completion = await openai.chat.completions.create({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.9,
          top_p: 0.95,
        });

        const raw = completion.choices[0]?.message?.content ?? "{}";

        type LlmOption = { text?: string; isCorrect?: boolean };
        type LlmPayload = { question?: string; options?: LlmOption[]; explanation?: string };

        let payload: LlmPayload = {};
        try {
          payload = JSON.parse(raw) as LlmPayload;
        } catch {
          payload = {};
        }

        const q = String(payload.question ?? "").trim();
        const opts = Array.isArray(payload.options) ? payload.options : [];
        const normQ = normalizeQuestion(q);

        if (!q || opts.length < 2) continue;
        if (avoidNorm.has(normQ)) continue;

        if (avoidTopics.length > 0 && attempt === 0) {
          if (hitsAvoidTopics(q, avoidTopics) >= 1) continue;
        }

        const normalized = opts.slice(0, 4);
        while (normalized.length < 4) normalized.push({ text: `Mulighed ${normalized.length + 1}`, isCorrect: false });

        let correctIdx = normalized.findIndex((o) => !!o.isCorrect);
        if (correctIdx === -1) correctIdx = 0;

        const fixed = normalized.map((o, idx) => ({
          text: stripLeadingLetterOption(String(o.text ?? "")) || `Mulighed ${idx + 1}`,
          isCorrect: idx === correctIdx,
        }));

        const correctText = fixed.find((x) => x.isCorrect)?.text ?? "";
        const normA = normalizeAnswer(correctText);

        if (normA && recentCorrectAnswers.has(normA)) continue;

        finalQuestion = q;
        finalOptions = fixed;
        finalExplanation = String(payload.explanation ?? "").trim() || null;
        if (normA) recentCorrectAnswers.add(normA);
        break;
      }

      if (!finalQuestion || finalOptions.length === 0) break;

      const shuffled = shuffle(finalOptions);
      const letters = ["a", "b", "c", "d"];
      const options: McOptionPayload[] = shuffled.map((o, idx) => ({
        id: letters[idx],
        text: o.text,
        isCorrect: o.isCorrect,
      }));

      const item: GenerateMcItem = {
        ok: true,
        questionId: randomUUID(),
        question: finalQuestion,
        options,
        explanation: finalExplanation,
        citations,
        usedFileId,
        meta: { requestId, usedChunkIds, usedFileTitle },
      };

      items.push(item);
      avoidNorm.add(normalizeQuestion(finalQuestion));

      // ✅ vigtig: log mc_generate NU (så quota tæller ved generering)
      await logMcJob(admin, ownerId, {
        source: "generate-mc-batch",
        requestId,
        scopeFolderIds,
        scopeKey,
        difficulty,
        model,
        usedFileId,
        usedFileTitle,
        maxContextChunks,
        chunksPerQuestion: chunksPerQuestion(difficulty, maxContextChunks),
        focusAngle,
        citationCount: citations.length,
        question: finalQuestion,
        batchIndex: i,
        batchRequestedCount: requestedCount,
        batchEffectiveCount: effectiveCount,
      });
    }

    if (lastUsedFileIdInBatch) {
      await saveLastUsedFileId(admin, ownerId, scopeKey, lastUsedFileIdInBatch);
    }

    if (items.length === 0) {
      const err: GenerateMcBatchErr = {
        ok: false,
        error: "Kunne ikke generere nogen MC-spørgsmål fra dit materiale.",
        requestId,
        debug: { scopeFolderIds, requestedCount, effectiveCount },
      };
      return NextResponse.json(err, { status: 500 });
    }

    const resp: GenerateMcBatchOk = {
      ok: true,
      batchId: randomUUID(),
      requestedCount,
      effectiveCount,
      returnedCount: items.length,
      items,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[generate-mc-batch] route error:", err);
    const out: GenerateMcBatchErr = { ok: false, error: err?.message ?? "Uventet fejl i generate-mc-batch.", requestId };
    return NextResponse.json(out, { status: 500 });
  }
}



---
## app/api/mc-submit/route.ts

// app/api/mc-submit/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  questionId?: string;
  question?: string;
  selectedOptionId?: string;
  selectedOptionText?: string;
  isCorrect?: boolean;
  scopeFolderIds?: string[] | null;
  explanation?: string | null;
};

function uniqTrimmed(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ids) {
    const s = typeof x === "string" ? x.trim() : "";
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
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

export async function POST(req: NextRequest) {
  try {
    // Auth/dev-bypass (samme mønster som andre routes)
    let sb: any;
    let ownerId = "";
    let mode: "auth" | "dev" = "auth";

    try {
      const u = await requireUser(req);
      sb = u.sb;
      ownerId = u.id;
      mode = u.mode;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const isAuth = msg.toLowerCase().includes("unauthorized");
      if (!isAuth) console.error("[mc-submit] requireUser crash:", e);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await readJsonBody<Body>(req);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const body = parsed.value ?? {};

    const questionId = String(body.questionId ?? "").trim();
    const question = String(body.question ?? "").trim();
    const selectedOptionId = String(body.selectedOptionId ?? "").trim();
    const selectedOptionText = String(body.selectedOptionText ?? "").trim();
    const isCorrect = !!body.isCorrect;

    if (!questionId || !question || !selectedOptionId || !selectedOptionText) {
      return NextResponse.json(
        { ok: false, error: "Manglende felter i mc-submit body." },
        { status: 400 },
      );
    }

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const folderId = scopeFolderIds.length ? scopeFolderIds[0] : null;

    const score = isCorrect ? 100 : 0;

    const explanation = String(body.explanation ?? "").trim();
    const feedback =
      explanation ||
      (isCorrect ? "Korrekt." : "Ikke korrekt. Gennemgå forklaringen og prøv igen.");

    const answerText = `${selectedOptionId}: ${selectedOptionText}`;

    const { error } = await sb.from("exam_sessions").insert({
      owner_id: ownerId,
      question,
      answer: answerText,
      feedback,
      score,
      source_type: "mc",
      folder_id: folderId,
      meta: {
        mode,
        questionId,
        selectedOptionId,
        selectedOptionText,
        isCorrect,
        scopeFolderIds,
      },
    });

    if (error) {
      console.error("[mc-submit] exam_sessions insert error:", error);
      return NextResponse.json(
        { ok: false, error: "Kunne ikke gemme MC-resultat i exam_sessions." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, score }, { status: 200 });
  } catch (err: any) {
    console.error("[mc-submit] route error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Uventet serverfejl i mc-submit." },
      { status: 500 },
    );
  }
}



---
## app/api/flashcards/generate/route.ts

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type GenerateFlashcardsRequest = {
  scopeFolderIds?: string[];
  difficulty?: Difficulty;
  maxContextChunks?: number;
  count?: number; // UI bruger 10
};

type Citation = {
  file_id?: string | null;
  title?: string | null;
  url?: string | null;
};

type FlashcardPayload = {
  id: string;
  front: string;
  back: string;
  citation?: Citation | null;
};

type LimitsPayload =
  | {
      plan: string;
      feature: "flashcards_generate";
      usedThisMonth: number; // units (kort)
      monthlyLimit: number;
      remainingThisMonth: number; // units (kort)
    }
  | null;

type GenerateFlashcardsResponse = {
  ok: true;
  sessionId: string;
  cards: FlashcardPayload[];
  requested: number;
  returned: number;
  difficulty: Difficulty;
  scopeFolderIds: string[];
  usedFileId: string | null;
  usedFallback: boolean;
  limits: LimitsPayload;
  // bagudkompat til klienten (viser ikke i UI, men kan gemmes)
  quota?: {
    feature: "flashcards_generate";
    plan: string;
    usedThisMonth: number;
    monthlyLimit: number;
    remaining: number;
  } | null;
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true as const, value: {} as T };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

function pickDifficulty(raw: any): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function clampInt(n: any, lo: number, hi: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

function uniqTrimmed(ids: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ids ?? []) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

function monthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  return { monthStart: start.toISOString(), resetAt: resetAt.toISOString() };
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

function pickLimit(planLimits: any[] | null | undefined, feature: string): number | null {
  const v = (planLimits ?? []).find((r: any) => r.feature === feature)?.monthly_limit ?? null;
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * Tæl flashcards-forbrug i "kort-units".
 * Primært: SUM(requested) eller SUM(returned) på flashcard_sessions denne måned.
 * Fallback: rowCount * unitsPerSession (typisk 10).
 */
async function countFlashcardUnitsThisMonth(opts: {
  sb: any;
  ownerId: string;
  monthStart: string;
  resetAt: string;
  unitsPerSession: number;
}) {
  const { sb, ownerId, monthStart, resetAt, unitsPerSession } = opts;

  const cols = ["requested", "returned", "cards_returned", "cards_count", "card_count", "count"] as const;
  const tsCols = ["created_at", "inserted_at"] as const;

  // 1) prøv at summere en kolonne
  for (const tsCol of tsCols) {
    for (const col of cols) {
      const r = await sb
        .from("flashcard_sessions")
        .select(col)
        .eq("owner_id", ownerId)
        .gte(tsCol, monthStart)
        .lt(tsCol, resetAt)
        .limit(5000);

      if (r?.error) continue;

      const rows = Array.isArray(r.data) ? r.data : [];
      let sum = 0;
      for (const row of rows) {
        const v = Number((row as any)?.[col]);
        if (Number.isFinite(v)) sum += v;
      }
      return { units: sum, meta: { mode: "sum", tsCol, col } };
    }
  }

  // 2) fallback: count rows * 10
  const r2 = await sb
    .from("flashcard_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .gte("created_at", monthStart)
    .lt("created_at", resetAt);

  if (!r2?.error && r2?.count != null) {
    const cnt = Number(r2.count ?? 0) || 0;
    return { units: cnt * unitsPerSession, meta: { mode: "rowCount", cnt, unitsPerSession } };
  }

  return { units: 0, meta: { mode: "unknown" } };
}

/**
 * Insert session med fallback payloads, så vi ikke fejler på ukendte kolonner (fx scope_key).
 */
async function insertFlashcardSessionBestEffort(sb: any, payloads: any[]) {
  let lastErr: any = null;
  for (const p of payloads) {
    const r = await sb.from("flashcard_sessions").insert(p);
    if (!r?.error) return { ok: true as const };
    lastErr = r.error;
    // prøv næste payload
  }
  return { ok: false as const, error: lastErr };
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY mangler i .env.local." }, { status: 500 });
    }

    const parsed = await readJsonBody<GenerateFlashcardsRequest>(req);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    const body = parsed.value ?? {};
    const difficulty = pickDifficulty(body.difficulty);
    const requested = clampInt(body.count, 1, 20, 10);
    const maxContextChunks = clampInt(body.maxContextChunks, 6, 40, 14);

    const scopeFolderIds = Array.isArray(body.scopeFolderIds) ? uniqTrimmed(body.scopeFolderIds) : [];

    // Auth/dev-bypass via requireUser
    let sb: any;
    let ownerId = "";
    try {
      const u = await requireUser(req);
      sb = u.sb;
      ownerId = u.id;
    } catch {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // plan + limits
    const { data: profile } = await sb.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const planKey = normalizePlan((profile as any)?.plan ?? "freemium");

    const { data: planLimits } = await sb.from("plan_limits").select("feature, monthly_limit").eq("plan", planKey);

    const monthlyLimit = pickLimit(planLimits, "flashcards_generate"); // ✅ samme key som quota/current

    // forbrug (units) denne måned
    const { monthStart, resetAt } = monthBoundsUTC(new Date());
    const usedUnitsRes = await countFlashcardUnitsThisMonth({
      sb,
      ownerId,
      monthStart,
      resetAt,
      unitsPerSession: requested, // tæller 10 pr. generation
    });
    const usedThisMonthUnits = Number(usedUnitsRes.units ?? 0) || 0;

    // stop hvis næste kald vil overskride limit
    if (typeof monthlyLimit === "number" && Number.isFinite(monthlyLimit)) {
      if (usedThisMonthUnits + requested > monthlyLimit) {
        const limits: LimitsPayload = {
          plan: planKey,
          feature: "flashcards_generate",
          usedThisMonth: usedThisMonthUnits,
          monthlyLimit,
          remainingThisMonth: Math.max(0, monthlyLimit - usedThisMonthUnits),
        };
        return NextResponse.json(
          { ok: false, error: "Du har nået din flashcards-grænse for denne måned.", limits },
          { status: 402 },
        );
      }
    }

    // filer i scope
    let filesQ = sb
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) console.error("[flashcards/generate] files error:", filesErr);

    const fileRows = (files ?? []) as any[];
    if (fileRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Ingen filer fundet i scope. Upload materiale først.", debug: { scopeFolderIds } },
        { status: 400 },
      );
    }

    // pool pr. fil
    const perFilePool = Math.min(140, Math.max(40, Math.ceil(maxContextChunks / 2) * 10));
    const pools = new Map<string, any[]>();

    async function loadPool(fileId: string) {
      if (pools.has(fileId)) return pools.get(fileId)!;

      const { data: pool, error } = await sb
        .from("doc_chunks")
        .select("id,file_id,content,created_at,source_url")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(perFilePool);

      if (error) {
        pools.set(fileId, []);
        return [];
      }

      const nonEmpty = (pool ?? []).filter((r: any) => String(r?.content ?? "").trim().length > 0);
      const shuffled = shuffle(nonEmpty);
      pools.set(fileId, shuffled);
      return shuffled;
    }

    // vælg kilder: 1 chunk pr kort
    const sources: Array<{
      fileId: string;
      title: string;
      url: string | null;
      chunkId: string;
      text: string;
    }> = [];

    let guard = 0;
    let pickIdx = 0;

    while (sources.length < requested && guard < 200) {
      guard++;
      const f = fileRows[pickIdx % fileRows.length];
      pickIdx++;

      const fileId = String(f.id);
      const title = fileTitle(f);

      const pool = await loadPool(fileId);
      if (!pool.length) continue;

      const chunk = pool.pop();
      if (!chunk) continue;

      const txt = String(chunk.content ?? "").trim();
      if (!txt) continue;

      sources.push({
        fileId,
        title,
        url: chunk.source_url ? String(chunk.source_url) : null,
        chunkId: String(chunk.id),
        text: txt.slice(0, 1600),
      });
    }

    if (sources.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Ingen kontekst fundet (doc_chunks). Tjek at upload/parse er kørt." },
        { status: 400 },
      );
    }

    const usedFallback = sources.length < requested;

    const model = process.env.OPENAI_MODEL_FLASHCARDS || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const systemPrompt = `
Du er en dansk studieassistent. Du laver flashcards ud fra kilderne nedenfor.

VIGTIGT:
- Hvert kort skal baseres på ÉN (1) bestemt kilde og returnere sourceIndex for den kilde.
- Skriv alt på dansk.
- Spørgsmål skal være præcise. Svar skal være kort og nyttigt.
- Front/back må ikke nævne "SOURCE", "sourceIndex", "JSON" eller interne instruktioner.

Returnér gyldig JSON:
{
  "cards": [
    { "front": "...", "back": "...", "sourceIndex": 1 }
  ]
}
`.trim();

    const sourcesText = sources
      .map((s, idx) => {
        const n = idx + 1;
        return `SOURCE ${n}\nTITEL: ${s.title}\nUDDRAG:\n${s.text}`;
      })
      .join("\n\n---\n\n")
      .slice(0, 11000);

    const userPrompt = [
      `Sværhedsgrad: ${difficulty}`,
      `Lav ${requested} flashcards.`,
      "",
      "KILDER (brug kun disse):",
      "",
      sourcesText,
      "",
      "KRAV:",
      `- cards.length skal være ${requested} hvis muligt.`,
      `- sourceIndex skal være 1..${sources.length}.`,
    ].join("\n");

    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let payload: any = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }

    const rawCards = Array.isArray(payload?.cards) ? payload.cards : [];
    const outCards: FlashcardPayload[] = [];

    for (const c of rawCards) {
      const front = String(c?.front ?? "").trim();
      const back = String(c?.back ?? "").trim();
      let sourceIndex = Number(c?.sourceIndex);

      if (!Number.isFinite(sourceIndex)) sourceIndex = 1;
      sourceIndex = Math.max(1, Math.min(sources.length, Math.round(sourceIndex)));

      if (!front || !back) continue;

      const src = sources[sourceIndex - 1];

      // ekstra safety: strip "SOURCE x" hvis modellen prøver at smide det ind
      const cleanFront = front.replace(/\bSOURCE\s*\d+\b/gi, "").trim();
      const cleanBack = back.replace(/\bSOURCE\s*\d+\b/gi, "").trim();

      outCards.push({
        id: randomUUID(),
        front: cleanFront,
        back: cleanBack,
        citation: {
          file_id: src.fileId,
          title: src.title,
          url: src.url,
        },
      });
    }

    // Hvis der ikke kom nogen kort => ingen session, ingen quota-forbrug
    if (outCards.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Kunne ikke generere kort (tomt output fra modellen). Prøv igen." },
        { status: 200 },
      );
    }

    const sessionId = randomUUID();
    const usedFileId = sources[0]?.fileId ? String(sources[0].fileId) : null;

    // gem session (best-effort) — prøv flere payloads pga schema-variation
    const nowIso = new Date().toISOString();
    const insertPayloads = [
      {
        id: sessionId,
        owner_id: ownerId,
        created_at: nowIso,
        requested, // ✅ 10 pr. generation
        returned: outCards.length,
        difficulty,
        scope_folder_ids: scopeFolderIds,
        used_file_id: usedFileId,
      },
      {
        id: sessionId,
        owner_id: ownerId,
        created_at: nowIso,
        requested,
        returned: outCards.length,
        difficulty,
      },
      {
        owner_id: ownerId,
        created_at: nowIso,
        requested,
        returned: outCards.length,
      },
      {
        owner_id: ownerId,
        created_at: nowIso,
      },
    ];

    const ins = await insertFlashcardSessionBestEffort(sb, insertPayloads);
    if (!ins.ok) console.error("[flashcards/generate] insert flashcard_sessions failed:", ins.error);

    // returnér limits i units
    const usedAfter = usedThisMonthUnits + requested;
    const limits: LimitsPayload =
      typeof monthlyLimit === "number" && Number.isFinite(monthlyLimit)
        ? {
            plan: planKey,
            feature: "flashcards_generate",
            usedThisMonth: usedAfter,
            monthlyLimit,
            remainingThisMonth: Math.max(0, monthlyLimit - usedAfter),
          }
        : null;

    const resp: GenerateFlashcardsResponse = {
      ok: true,
      sessionId,
      cards: outCards,
      requested,
      returned: outCards.length,
      difficulty,
      scopeFolderIds,
      usedFileId,
      usedFallback,
      limits,
      quota: limits
        ? {
            feature: "flashcards_generate",
            plan: planKey,
            usedThisMonth: limits.usedThisMonth,
            monthlyLimit: limits.monthlyLimit,
            remaining: limits.remainingThisMonth,
          }
        : null,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[flashcards/generate] route error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Uventet fejl i flashcards/generate." },
      { status: 500 },
    );
  }
}



---
## Missing files (not found)

None ✅
