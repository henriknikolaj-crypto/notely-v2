// app/api/generate-mc-batch/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

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

async function getOwnerId(req: NextRequest): Promise<string> {
  try {
    const u = await requireUser(req);
    return u.id;
  } catch {
    const hdr = String(req.headers.get("x-dev-secret") || req.headers.get("x-shared-secret") || "").trim();
    const secret =
      process.env.IMPORT_SHARED_SECRET || process.env.DEV_SHARED_SECRET || process.env.DEV_SECRET || "";
    if (hdr && secret && hdr === secret) {
      const devUserId = process.env.DEV_USER_ID;
      if (!devUserId) throw new Error("DEV_USER_ID mangler i .env.local (dev-bypass).");
      return devUserId;
    }
    throw new Error("Unauthorized");
  }
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
    const r = await admin.from("plan_limits").select("feature, monthly_limit, monthlyLimit").eq("plan", p);
    if (!r.error && Array.isArray(r.data) && r.data.length > 0) {
      limits = r.data;
      break;
    }
  }

  const plan = tryPlans[0] || planNorm;

  const row = (limits ?? []).find((r: any) => String(r?.feature ?? "") === "mc_generate");
  if (!row) return { plan: planNorm, mcLimit: null }; // mangler række => behandl som unlimited for at undgå 500-støj

  const rawLimit = (row as any).monthly_limit ?? (row as any).monthlyLimit ?? null;
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

    const ownerId = await getOwnerId(req);

    const admin = supabaseAdmin();
    const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(new Date());

    // plan + limit (NULL = ubegrænset)
    const { plan, mcLimit } = await getPlanAndMcLimit(admin, ownerId);

    let remaining = Number.POSITIVE_INFINITY;
    let usedThisMonth = 0;

    if (typeof mcLimit === "number" && mcLimit > 0) {
      const mcMonth = await countMcJobsThisMonth(admin, ownerId, monthStart, resetAt);
      usedThisMonth = mcMonth.used;
      remaining = Math.max(0, mcLimit - usedThisMonth);

      if (remaining <= 0) {
        const err: GenerateMcBatchErr = {
          ok: false,
          error: "Du har nået din grænse for Multiple Choice denne måned.",
          requestId,
          code: "QUOTA_EXCEEDED",
          feature: "mc_generate",
          plan,
          usedThisMonth,
          monthlyLimit: mcLimit,
          monthStart,
          monthEnd,
          resetAt,
        };
        return NextResponse.json(err, { status: 429 });
      }
    }

    const effectiveCount =
      remaining === Number.POSITIVE_INFINITY ? requestedCount : Math.min(requestedCount, remaining);

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

    // Lazy cache af chunk-pools pr file
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

    const items: GenerateMcItemOk[] = [];
    let lastUsedFileIdInBatch: string | null = null;

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

      const item: GenerateMcItemOk = {
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
        plan,
        mcLimit,
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
    const status = out.error === "Unauthorized" ? 401 : 500;
    return NextResponse.json(out, { status });
  }
}
