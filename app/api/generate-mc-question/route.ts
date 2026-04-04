// app/api/generate-mc-question/route.ts
import "server-only";

import { resolveModelForFeature } from "@/lib/openai/model";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { consumeMcQuota, getMcQuotaSnapshot } from "@/lib/quota/mc";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type GenerateMcRequest = {
  scopeFolderIds?: string[];
  difficulty?: Difficulty;
  maxContextChunks?: number;

  avoidQuestions?: string[];
  avoidChunkIds?: string[];
  avoidTopics?: string[];
};

type McOptionPayload = {
  id: string; // "a"|"b"|"c"|"d"
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

type GenerateMcOk = {
  ok: true;
  questionId: string;
  question: string;
  options: McOptionPayload[];
  explanation: string | null;
  citations: McCitationPayload[];
  usedFileId: string | null;
  meta: McMeta;
};

type GenerateMcErr = {
  ok: false;
  error: string;
  requestId: string;
  code?: string;
  feature?: string;
  plan?: string;
  usedThisMonth?: number;
  monthlyLimit?: number | null;
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
const MC_SINGLE_CONTEXT_CHAR_LIMIT = 4000;
const MC_SINGLE_MAX_COMPLETION_TOKENS = 1600;

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
  const { data: profile } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();

  const planRaw = String((profile as any)?.plan ?? "freemium").trim();
  const planNorm = normalizePlan(planRaw);

  const tryPlans = [planRaw.toLowerCase(), planNorm].filter(Boolean);
  let limits: any[] | null = null;

  for (const p of tryPlans) {
    const r = await admin.from("plan_limits").select("feature, monthly_limit, is_unlimited").eq("plan", p);
    if (!r.error && Array.isArray(r.data) && r.data.length > 0) {
      limits = r.data;
      break;
    }
  }

  const row = (limits ?? []).find((r: any) => String(r?.feature ?? "") === "mc_generate");
  if (!row) return { plan: planNorm, mcLimit: null }; // fail-open: undgå 500-støj
  if ((row as any).is_unlimited === true) return { plan: planNorm, mcLimit: null };
  const rawLimit = (row as any).monthly_limit ?? null;
  if (rawLimit == null) return { plan: planNorm, mcLimit: null };
  const n = Number(rawLimit);
  return { plan: planNorm, mcLimit: Number.isFinite(n) ? Math.round(n) : null };
}

function getMonthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  return { monthStart: start.toISOString(), resetAt: resetAt.toISOString() };
}

async function readJsonBody<T>(req: NextRequest) {
  try {
    const v = (await req.json()) as T;
    return { ok: true as const, value: (v ?? ({} as T)) };
  } catch {
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
    console.error("[generate-mc] save generation_state failed:", e);
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

    if (!r.error && r.count != null) return Number(r.count ?? 0) || 0;
  }

  return 0;
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
    console.warn("[generate-mc] jobs insert warning:", e);
  }
}

function normalizeQuestion(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
}

function stripLeadingLetterOption(t: string) {
  return String(t ?? "").replace(/^\s*[A-Da-d]\s*[\).:\-]\s*/g, "").trim();
}

function chunksPerQuestion(difficulty: Difficulty, maxContextChunks: number) {
  const base = difficulty === "hard" ? 3 : 2;
  return Math.max(1, Math.min(base, maxContextChunks));
}

const SYSTEM_PROMPT = `
Du er en dansk studieassistent.
Du laver eksamenslignende multiple choice-spørgsmål ud fra elevens pensum-uddrag.

VIGTIGT:
- Du MÅ KUN bruge den kontekst, du får (KILDE-afsnit).
- Skriv alt på dansk.
- Returnér kun ét kompakt JSON-objekt. Ingen markdown, ingen kodeblok, ingen ekstra tekst.
- Hold hele JSON-svaret så kort som muligt.

KRAV:
- 1 spørgsmål
- 4 svarmuligheder
- Præcis 1 korrekt
- Plausible distraktorer (ikke åbenlyse)
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

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = Date.now();
  const timings = {
    topicLookupMs: 0,
    filesLookupMs: 0,
    retrievalMs: 0,
    promptBuildMs: 0,
    modelMs: 0,
    parsingAndPostProcessingMs: 0,
  };

  try {
    if (!process.env.OPENAI_API_KEY) {
      const err: GenerateMcErr = { ok: false, error: "OPENAI_API_KEY mangler i .env.local.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    const parsed = await readJsonBody<GenerateMcRequest>(req);
    if (!parsed.ok) {
      const err: GenerateMcErr = { ok: false, error: parsed.error, requestId };
      return NextResponse.json(err, { status: 400 });
    }

    const body = parsed.value ?? {};
    const difficulty = pickDifficulty(body.difficulty);
    const maxContextChunks = clampInt(body.maxContextChunks, 2, 32, 10);

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const scopeKey = scopeKeyFromFolderIds(scopeFolderIds);

    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 64);
    const avoidNorm = new Set(avoidQuestions.map(normalizeQuestion));

    const avoidChunkIds = uniqTrimmed(body.avoidChunkIds).slice(0, 800);
    const avoidChunkSet = new Set<string>(avoidChunkIds);

    const ownerId = await getOwnerId(req);

    const admin = supabaseAdmin();

    const quotaSnapshot = await getMcQuotaSnapshot(admin, ownerId);
    if (process.env.NODE_ENV !== "production") {
      console.info("[generate-mc-question] quota-snapshot", {
        requestId,
        ownerId,
        feature: "mc_generate",
        usedThisMonth: quotaSnapshot.used,
        monthlyLimit: quotaSnapshot.limitPerMonth,
        remainingThisMonth: quotaSnapshot.remainingThisMonth,
      });
    }
    if (!quotaSnapshot.ok) {
      const err: GenerateMcErr = {
        ok: false,
        error: quotaSnapshot.message,
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

    // topic (første mappe-navn hvis muligt)
    let topic = "pensum";
    const topicStartedAt = Date.now();
    if (scopeFolderIds.length > 0) {
      const { data: f } = await admin
        .from("folders")
        .select("name")
        .eq("owner_id", ownerId)
        .eq("id", scopeFolderIds[0])
        .maybeSingle();
      if ((f as any)?.name) topic = String((f as any).name);
    }
    timings.topicLookupMs = Date.now() - topicStartedAt;

    // files
    const filesStartedAt = Date.now();
    let filesQ = admin
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const { data: files } = await filesQ;
    timings.filesLookupMs = Date.now() - filesStartedAt;
    const fileRows = (files ?? []) as FileRow[];

    if (fileRows.length === 0) {
      const err: GenerateMcErr = { ok: false, error: "Ingen filer fundet i scope. Upload materiale først.", requestId };
      return NextResponse.json(err, { status: 400 });
    }

    // rotation
    const lastUsed = await loadLastUsedFileId(admin, ownerId, scopeKey);
    let start = 0;
    if (lastUsed) {
      const idx = fileRows.findIndex((f) => String(f.id) === String(lastUsed));
      if (idx >= 0) start = (idx + 1) % fileRows.length;
    } else {
      start = Math.floor(Math.random() * fileRows.length);
    }
    const rotated = [...fileRows.slice(start), ...fileRows.slice(0, start)];

    // pick a file + chunks
    const take = chunksPerQuestion(difficulty, maxContextChunks);

    let chosenFile: FileRow | null = null;
    let chosenChunks: ChunkRow[] = [];

    // pass 1 (undgå avoidChunkIds)
    for (let i = 0; i < Math.min(30, rotated.length); i++) {
      const f = rotated[i];
      const fileId = String(f.id);

      const poolStartedAt = Date.now();
      const { data: pool } = await admin
        .from("doc_chunks")
        .select("id,file_id,content,created_at,source_url")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(400);
      timings.retrievalMs += Date.now() - poolStartedAt;

      const usable = (pool ?? [])
        .filter((r: any) => String(r?.content ?? "").trim().length > 0)
        .filter((r: any) => !avoidChunkSet.has(String(r.id)));

      if (usable.length < 1) continue;

      chosenFile = f;
      chosenChunks = shuffle(usable).slice(0, Math.min(take, usable.length));
      break;
    }

    // pass 2 (allow reuse)
    if (!chosenFile) {
      for (let i = 0; i < Math.min(30, rotated.length); i++) {
        const f = rotated[i];
        const fileId = String(f.id);

        const poolStartedAt = Date.now();
        const { data: pool } = await admin
          .from("doc_chunks")
          .select("id,file_id,content,created_at,source_url")
          .eq("owner_id", ownerId)
          .eq("file_id", fileId)
          .order("created_at", { ascending: false })
          .limit(400);
        timings.retrievalMs += Date.now() - poolStartedAt;

        const usable = (pool ?? []).filter((r: any) => String(r?.content ?? "").trim().length > 0);
        if (usable.length < 1) continue;

        chosenFile = f;
        chosenChunks = shuffle(usable).slice(0, Math.min(take, usable.length));
        break;
      }
    }

    if (!chosenFile || chosenChunks.length === 0) {
      const err: GenerateMcErr = {
        ok: false,
        error: "Ingen kontekst fundet (doc_chunks). Tjek at upload/parse er kørt.",
        requestId,
      };
      return NextResponse.json(err, { status: 400 });
    }

    const usedFileId = String(chosenFile.id);
    const usedFileTitle = fileTitle(chosenFile);

    const usedChunkIds = chosenChunks.map((c) => String(c.id));
    const promptStartedAt = Date.now();
    const contextText = chosenChunks
      .map((c) => `KILDE: ${usedFileTitle}\n\n${String(c.content ?? "").trim()}`)
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, MC_SINGLE_CONTEXT_CHAR_LIMIT);

    const citations: McCitationPayload[] = chosenChunks.map((c) => ({
      chunkId: String(c.id),
      fileId: usedFileId,
      title: usedFileTitle,
      url: (c as any)?.source_url ? String((c as any).source_url) : null,
    }));

    const avoidBlock =
      avoidNorm.size > 0
        ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${Array.from(avoidNorm)
            .slice(0, 24)
            .join("\n- ")}\n`
        : "";

    const userPrompt = [
      `Fag/tema: ${topic}`,
      `Sværhedsgrad: ${difficulty}`,
      `Kilde (primary): ${usedFileTitle}`,
      avoidBlock.trim(),
      "",
      "KONTEKST (brug dette som eneste grundlag):",
      "",
      contextText,
    ]
      .filter(Boolean)
      .join("\n");
    timings.promptBuildMs = Date.now() - promptStartedAt;

    const model = resolveModelForFeature("mc");

    const modelStartedAt = Date.now();
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model,
        max_completion_tokens: MC_SINGLE_MAX_COMPLETION_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
    } catch (err: any) {
      timings.modelMs = Date.now() - modelStartedAt;
      if (isOpenAiOutputLimitError(err)) {
        console.warn("[generate-mc-question] invalid-model-output", {
          requestId,
          model,
          finishReason: "sdk_output_limit_error",
          parseOk: false,
          rawLength: 0,
          questionLength: 0,
          optionsLength: 0,
          errorStatus: err?.status ?? null,
          errorMessage: String(err?.message ?? ""),
        });
        const out: GenerateMcErr = { ok: false, error: "Kunne ikke generere spørgsmål (tomt output).", requestId };
        return NextResponse.json(out, { status: 500 });
      }
      throw err;
    }
    timings.modelMs = Date.now() - modelStartedAt;

    const parseStartedAt = Date.now();
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const finishReason = completion.choices[0]?.finish_reason ?? null;

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

    if (!q || opts.length < 2) {
      console.warn("[generate-mc-question] invalid-model-output", {
        requestId,
        model,
        finishReason,
        parseOk,
        rawLength: raw.length,
        questionLength: q.length,
        optionsLength: opts.length,
      });
      const err: GenerateMcErr = { ok: false, error: "Kunne ikke generere spørgsmål (tomt output).", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    if (avoidNorm.has(normalizeQuestion(q))) {
      const err: GenerateMcErr = { ok: false, error: "Spørgsmålet blev en gentagelse. Prøv igen.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    const normalized = opts.slice(0, 4);
    while (normalized.length < 4) normalized.push({ text: `Mulighed ${normalized.length + 1}`, isCorrect: false });

    let correctIdx = normalized.findIndex((o) => !!o.isCorrect);
    if (correctIdx === -1) correctIdx = 0;

    const fixed = normalized.map((o, idx) => ({
      text: stripLeadingLetterOption(String(o.text ?? "")) || `Mulighed ${idx + 1}`,
      isCorrect: idx === correctIdx,
    }));

    const shuffled = shuffle(fixed);
    const letters = ["a", "b", "c", "d"];
    const options: McOptionPayload[] = shuffled.map((o, idx) => ({
      id: letters[idx],
      text: o.text,
      isCorrect: o.isCorrect,
    }));

    const quotaConsume = await consumeMcQuota(admin, ownerId, 1);
    if (process.env.NODE_ENV !== "production") {
      console.info("[generate-mc-question] quota-consume", {
        requestId,
        ownerId,
        feature: "mc_generate",
        consumedAmount: 1,
        usedBefore: quotaSnapshot.used,
        usedAfter: quotaConsume.used,
        monthlyLimit: quotaConsume.limitPerMonth,
        remainingBefore: quotaSnapshot.remainingThisMonth,
        remainingAfter: quotaConsume.remainingThisMonth,
      });
    }
    if (!quotaConsume.ok) {
      const err: GenerateMcErr = {
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

    await saveLastUsedFileId(admin, ownerId, scopeKey, usedFileId);

    await logMcJob(admin, ownerId, {
      source: "generate-mc-question",
      requestId,
      scopeFolderIds,
      scopeKey,
      difficulty,
      model,
      usedFileId,
      usedFileTitle,
      usedChunkIds,
      question: q,
      citationCount: citations.length,
      plan: quotaConsume.plan,
      mcLimit: quotaConsume.limitPerMonth,
    });
    if (process.env.NODE_ENV !== "production") {
      console.info("[generate-mc-question] jobs-persisted", {
        requestId,
        ownerId,
        jobRowsInserted: 1,
      });
    }

    const out: GenerateMcOk = {
      ok: true,
      questionId: randomUUID(),
      question: q,
      options,
      explanation: String(payload.explanation ?? "").trim() || null,
      citations,
      usedFileId,
      meta: { requestId, usedChunkIds, usedFileTitle },
    };

    timings.parsingAndPostProcessingMs = Date.now() - parseStartedAt;
    console.info("[generate-mc-question] timings", {
      requestId,
      scopeFolderIds,
      model,
      usedFileId,
      usedChunkIds,
      stageTimingsMs: {
        topicLookup: timings.topicLookupMs,
        filesLookup: timings.filesLookupMs,
        retrieval: timings.retrievalMs,
        promptBuild: timings.promptBuildMs,
        model: timings.modelMs,
        parsingAndPostProcessing: timings.parsingAndPostProcessingMs,
        total: Date.now() - requestStartedAt,
      },
    });

    return NextResponse.json(out, { status: 200 });
  } catch (err: any) {
    console.error("[generate-mc-question] route error:", err);
    console.info("[generate-mc-question] timings", {
      requestId,
      stageTimingsMs: {
        topicLookup: timings.topicLookupMs,
        filesLookup: timings.filesLookupMs,
        retrieval: timings.retrievalMs,
        promptBuild: timings.promptBuildMs,
        model: timings.modelMs,
        parsingAndPostProcessing: timings.parsingAndPostProcessingMs,
        total: Date.now() - requestStartedAt,
      },
    });
    const out: GenerateMcErr = { ok: false, error: err?.message ?? "Uventet fejl i generate-mc-question.", requestId };
    const status = out.error === "Unauthorized" ? 401 : 500;
    return NextResponse.json(out, { status });
  }
}
