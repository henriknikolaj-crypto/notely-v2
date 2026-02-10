import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rateLimit";

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

/**
 * flashLimit semantics:
 * - undefined => mangler række i plan_limits (opsætningsfejl)
 * - null      => ∞
 * - number    => månedlig grænse (units=kort)
 */
function getFlashLimit(planLimits: any[] | null | undefined): number | null | undefined {
  const row = (planLimits ?? []).find((r: any) => r.feature === "flashcards_generate");
  if (!row) return undefined;
  const v = (row as any).monthly_limit;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
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

async function insertFlashcardSessionBestEffort(sb: any, payloads: any[]) {
  let lastErr: any = null;
  for (const p of payloads) {
    const r = await sb.from("flashcard_sessions").insert(p);
    if (!r?.error) return { ok: true as const };
    lastErr = r.error;
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

    // Stopklods (rate-limit)
    try {
      const rl = await enforceRateLimit(
        ownerId,
        "flashcards_generate",
        { limit: 6, windowSeconds: 60, minIntervalMs: 3000 },
        "Generér flashcards",
      );
      if (!rl.ok) {
        return NextResponse.json({ ok: false, error: rl.message }, { status: rl.status });
      }
    } catch {
      // fail-open
    }

    // plan + limits
    const { data: profile } = await sb.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const planKey = normalizePlan((profile as any)?.plan ?? "freemium");

    const { data: planLimits, error: plErr } = await sb.from("plan_limits").select("feature, monthly_limit").eq("plan", planKey);
    if (plErr) console.error("[flashcards/generate] plan_limits error:", plErr);

    const monthlyLimit = getFlashLimit(planLimits); // undefined | null | number

    if (monthlyLimit === undefined) {
      return NextResponse.json(
        { ok: false, error: "Plan limits mangler for flashcards_generate. Tjek plan_limits.", debug: { plan: planKey } },
        { status: 500 },
      );
    }

    // forbrug (units) denne måned
    const { monthStart, resetAt } = monthBoundsUTC(new Date());
    const usedUnitsRes = await countFlashcardUnitsThisMonth({
      sb,
      ownerId,
      monthStart,
      resetAt,
      unitsPerSession: requested,
    });
    const usedThisMonthUnits = Number(usedUnitsRes.units ?? 0) || 0;

    // Tal => stop hvis næste kald vil overskride limit. NULL => ∞
    if (typeof monthlyLimit === "number") {
      if (usedThisMonthUnits + requested > monthlyLimit) {
        const limits: LimitsPayload = {
          plan: planKey,
          feature: "flashcards_generate",
          usedThisMonth: usedThisMonthUnits,
          monthlyLimit,
          remainingThisMonth: Math.max(0, monthlyLimit - usedThisMonthUnits),
        };
        return NextResponse.json(
          { ok: false, error: "Du har nået din flashcards-grænse for denne måned.", code: "QUOTA_EXCEEDED", limits },
          { status: 429 },
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

    if (outCards.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Kunne ikke generere kort (tomt output fra modellen). Prøv igen." },
        { status: 200 },
      );
    }

    const sessionId = randomUUID();
    const usedFileId = sources[0]?.fileId ? String(sources[0].fileId) : null;

    const nowIso = new Date().toISOString();
    const insertPayloads = [
      {
        id: sessionId,
        owner_id: ownerId,
        created_at: nowIso,
        requested,
        returned: outCards.length,
        difficulty,
        scope_folder_ids: scopeFolderIds,
        used_file_id: usedFileId,
      },
      { id: sessionId, owner_id: ownerId, created_at: nowIso, requested, returned: outCards.length, difficulty },
      { owner_id: ownerId, created_at: nowIso, requested, returned: outCards.length },
      { owner_id: ownerId, created_at: nowIso },
    ];

    const ins = await insertFlashcardSessionBestEffort(sb, insertPayloads);
    if (!ins.ok) console.error("[flashcards/generate] insert flashcard_sessions failed:", ins.error);

    const usedAfter = usedThisMonthUnits + requested;

    const limits: LimitsPayload =
      typeof monthlyLimit === "number"
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
