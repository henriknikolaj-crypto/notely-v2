// app/api/generate-question/route.ts
import "server-only";

import { requireFlowModel } from "@/lib/openai/requireModel";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { ensureQuotaAndDecrement } from "@/lib/quota";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type GenerateQuestionRequest = {
  scopeFolderIds?: string[];
  difficulty?: Difficulty;
  maxContextChunks?: number;

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

function normalizeQuestion(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
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

  const { data: limits } = await db.from("plan_limits").select("feature, monthly_limit").eq("plan", plan);
  const row = (limits ?? []).find((r: any) => r.feature === "trainer_round");
  if (!row) return { plan, limit: undefined as number | null | undefined };

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

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const scopeKey = scopeKeyFromFolderIds(scopeFolderIds);

    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 24);
    const avoidNorm = new Set(avoidQuestions.map(normalizeQuestion));
    const avoidChunkIds = uniqTrimmed(body.avoidChunkIds).slice(0, 500);
    const avoidChunkSet = new Set<string>(avoidChunkIds);

    // Auth
    let ownerId = "";
    try {
      const u: any = await requireUser(req);
      ownerId = u.id;
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

    // Quota gate (trainer_round)
    const q = await ensureQuotaAndDecrement(ownerId, "trainer_round", 1);
    if (!q.ok) {
      try {
        const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(new Date());
        const { plan, limit } = await getPlanAndLimit(admin, ownerId);
        const used = await countTrainerRoundsThisMonth(admin, ownerId, monthStart, resetAt);

        const err: GenerateQuestionErr = {
          ok: false,
          error: q.message,
          requestId,
          code: q.status === 500 ? "SETUP_ERROR" : "QUOTA_EXCEEDED",
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
          code: q.status === 500 ? "SETUP_ERROR" : "QUOTA_EXCEEDED",
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
        .select("id,file_id,content,created_at,source_url")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(perFilePool);

      const poolRows = (pool ?? []) as ChunkRow[];
      const nonEmpty = poolRows.filter((r) => (r.content ?? "").trim().length > 0);
      if (nonEmpty.length === 0) continue;

      if (!fallbackFile) {
        fallbackFile = f;
        fallbackChunks = shuffle(nonEmpty)
          .slice(0, Math.min(maxContextChunks, nonEmpty.length))
          .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));
      }

      const filtered = nonEmpty.filter((r) => !avoidChunkSet.has(String(r.id)));
      const candidate = filtered.length > 0 ? filtered : null;
      if (!candidate) continue;

      chosenFile = f;
      pickedChunks = shuffle(candidate)
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

    const model = requireFlowModel("trainer");

    const avoidBlock =
      avoidQuestions.length > 0
        ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${avoidQuestions.join("\n- ")}\n`
        : "";

    const systemPrompt = `
Du er en dansk studieassistent.
Du laver ét (1) eksamenslignende frit-svar spørgsmål ud fra elevens pensum-uddrag.

VIGTIGT:
- Du MÅ KUN bruge konteksten (KILDE-afsnit).
- Skriv alt på dansk.
- Ingen multiple choice.
- Spørgsmålet skal være konkret og teste forståelse/anvendelse (ikke kun genkendelse).

Returnér gyldig JSON:
{
  "question": "..."
}
`.trim();

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

function isSamplingUnsupported(e: any) {
  const msg = String(e?.message ?? "");
  const param = String(e?.param ?? e?.error?.param ?? "");
  return (
    param === "temperature" ||
    param === "top_p" ||
    msg.includes("Unsupported value: 'temperature'") ||
    msg.includes("Unsupported value: 'top_p'") ||
    msg.includes("Only the default (1) value is supported")
  );
}

// ... behold userPrompt som du har det

let finalQuestion = "";

for (let attempt = 0; attempt < 3; attempt++) {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  const baseReq = {
    model,
    response_format: { type: "json_object" as const },
    messages,
  } satisfies import("openai").OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

  const completion = await openai.chat.completions.create(baseReq);

  const raw = completion.choices?.[0]?.message?.content ?? "{}";
  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const qText = String(payload?.question ?? "").trim();
  if (!qText) continue;

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
      },
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[generate-question] route error:", requestId, err);
    const out: GenerateQuestionErr = { ok: false, error: err?.message ?? "Uventet fejl i generate-question.", requestId };
    return NextResponse.json(out, { status: 500 });
  }
}
