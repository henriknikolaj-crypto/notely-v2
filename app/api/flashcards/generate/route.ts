import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { enforceRateLimit } from "@/lib/rateLimit";
import { quotaTryConsume, supabaseAdminOrNull } from "@/lib/quota/rpc";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { resolveModelForFeature } from "@/lib/openai/model";
import {
  formatSuspiciousPreview,
  hasSuspiciousFlashcardChars,
  normalizeFlashcardMathText,
} from "@/lib/text/flashcardMath";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";

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

type FlashcardSessionSnapshotItem = {
  id: string;
  front: string;
  back: string;
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
  if ((row as any).is_unlimited === true) return null;
  const v = (row as any).monthly_limit;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

async function insertFlashcardSessionBestEffort(client: any, payloads: any[]) {
  let lastErr: any = null;
  for (const p of payloads) {
    const r = await client.from("flashcard_sessions").insert(p);
    if (!r?.error) return { ok: true as const };
    lastErr = r.error;
  }
  return { ok: false as const, error: lastErr };
}

function buildCardsSnapshot(cards: FlashcardPayload[]): FlashcardSessionSnapshotItem[] {
  return cards
    .map((card) => ({
      id: String(card?.id ?? "").trim(),
      front: String(card?.front ?? "").trim(),
      back: String(card?.back ?? "").trim(),
    }))
    .filter((card) => card.id && card.front && card.back);
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
    const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);

    // Auth: session-first, read-only route client
    let sb: any;
    let ownerId = "";
    try {
      sb = supabaseServerRouteReadOnly(req);
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

      let resolvedUserId = sessionUserId;
      let getUserError: string | null = null;

      if (!resolvedUserId) {
        const { data: authData, error: authError } = await sb.auth.getUser();
        getUserError = authError?.message ?? null;
        resolvedUserId = authData?.user?.id ? String(authData.user.id) : null;
      }

      if (!resolvedUserId) {
        return NextResponse.json(
          {
            ok: false,
            error: "unauthorized",
            ...(process.env.VERCEL_ENV === "preview"
              ? {
                  debug: {
                    hasSession: !!sessionData?.session,
                    sessionUserId,
                    sessionError: sessionError?.message ?? null,
                    getUserError,
                    cookieNames,
                  },
                }
              : {}),
          },
          { status: 401 },
        );
      }

      ownerId = resolvedUserId;
    } catch {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // Stopklods (rate-limit)
    try {
      const rl = await enforceRateLimit(
        ownerId,
        "flashcards_generate",
        process.env.NODE_ENV === "production"
          ? { limit: 6, windowSeconds: 60, minIntervalMs: 3000 }
          : { limit: 120, windowSeconds: 60, minIntervalMs: 0 },
        "Generér flashcards",
      );
      if (!rl.ok) {
        return NextResponse.json({ ok: false, error: rl.message }, { status: rl.status });
      }
    } catch {
      // fail-open
    }

    const quotaAdmin = supabaseAdminOrNull();
    if (!quotaAdmin) {
      return NextResponse.json(
        { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kræves til quota)." },
        { status: 500 },
      );
    }

    // plan + limits
    const { data: profile } = await sb.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const planKey = normalizePlan((profile as any)?.plan ?? "freemium");

    const { data: planLimits, error: plErr } = await sb.from("plan_limits").select("feature, monthly_limit, is_unlimited").eq("plan", planKey);
    if (plErr) console.error("[flashcards/generate] plan_limits error:", plErr);

    const monthlyLimit = getFlashLimit(planLimits); // undefined | null | number

    if (monthlyLimit === undefined) {
      return NextResponse.json(
        { ok: false, error: "Plan limits mangler for flashcards_generate. Tjek plan_limits.", debug: { plan: planKey } },
        { status: 500 },
      );
    }

    const quotaSnapshot = await quotaTryConsume({
      admin: quotaAdmin,
      ownerId,
      feature: "flashcards_generate",
      amount: 0,
      exceededMessage: "Du har nået din flashcards-grænse for denne måned.",
    });

    if (!quotaSnapshot.ok) {
      if (quotaSnapshot.status === 503) {
        console.error("[flashcards/generate] quota_try_consume error:", quotaSnapshot.raw);
      }
      const limits: LimitsPayload =
        typeof quotaSnapshot.limitPerMonth === "number"
          ? {
              plan: planKey,
              feature: "flashcards_generate",
              usedThisMonth: quotaSnapshot.used,
              monthlyLimit: quotaSnapshot.limitPerMonth,
              remainingThisMonth: Math.max(0, quotaSnapshot.limitPerMonth - quotaSnapshot.used),
            }
          : null;

      return NextResponse.json(
        {
          ok: false,
          error: quotaSnapshot.message,
          code: quotaSnapshot.status === 429 ? "QUOTA_EXCEEDED" : "QUOTA_CHECK_FAILED",
          limits,
          resetAt: quotaSnapshot.resetAt,
        },
        { status: quotaSnapshot.status },
      );
    }

    const effectiveRequested =
      typeof quotaSnapshot.limitPerMonth === "number"
        ? Math.max(1, Math.min(requested, Math.max(0, quotaSnapshot.limitPerMonth - quotaSnapshot.used)))
        : requested;

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
      folderId: string | null;
      title: string;
      url: string | null;
      chunkId: string;
      text: string;
    }> = [];

    let guard = 0;
    let pickIdx = 0;

    while (sources.length < effectiveRequested && guard < 200) {
      guard++;
      const f = fileRows[pickIdx % fileRows.length];
      pickIdx++;

      const fileId = String(f.id);
      const folderId = f?.folder_id ? String(f.folder_id) : null;
      const title = fileTitle(f);

      const pool = await loadPool(fileId);
      if (!pool.length) continue;

      const chunk = pool.pop();
      if (!chunk) continue;

      const txt = String(chunk.content ?? "").trim();
      if (!txt) continue;

      sources.push({
        fileId,
        folderId,
        title,
        url: chunk.source_url ? String(chunk.source_url) : null,
        chunkId: String(chunk.id),
        text: normalizeFlashcardMathText(txt).slice(0, 1600),
      });
    }

    if (sources.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Ingen kontekst fundet (doc_chunks). Tjek at upload/parse er kørt." },
        { status: 400 },
      );
    }

    const usedFallback = sources.length < effectiveRequested;

    const model = resolveModelForFeature("flashcards");

    const systemPrompt = `
Du er en dansk studieassistent. Du laver flashcards ud fra kilderne nedenfor.

VIGTIGT:
- Hvert kort skal baseres på ÉN (1) bestemt kilde og returnere sourceIndex for den kilde.
- Skriv alt på dansk.
- Front skal være et kort, præcist spørgsmål.
- Back skal være mere uddybende og pædagogisk:
  - 2-5 korte sætninger
  - tilføj 1 konkret eksempel hvis relevant
  - du må bruge maks 2 bullets, men undgå lange tekstmure
- Hold tonen rolig, klar og nordisk.
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
      `Lav ${effectiveRequested} flashcards.`,
      "",
      "KILDER (brug kun disse):",
      "",
      sourcesText,
      "",
      "KRAV:",
      `- cards.length skal være ${effectiveRequested} hvis muligt.`,
      `- sourceIndex skal være 1..${sources.length}.`,
      "- front: kort spørgsmål (helst 1 sætning).",
      "- back: 2-5 korte sætninger, gerne 1 konkret eksempel hvis relevant.",
      "- back må gerne bruge op til 2 bullets, men ikke være en lang mur af tekst.",
    ].join("\n");

    const { completion } = await createChatCompletion(openai, {
      feature: "flashcards",
      purpose: "json",
      modelOverride: model,
      payload: {
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
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

      const cleanFront = normalizeFlashcardMathText(front.replace(/\bSOURCE\s*\d+\b/gi, "").trim());
      const cleanBack = normalizeFlashcardMathText(back.replace(/\bSOURCE\s*\d+\b/gi, "").trim());

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

    if (process.env.NODE_ENV !== "production") {
      const suspiciousSource = sources.find((source) => hasSuspiciousFlashcardChars(source.text));
      const suspiciousCard = outCards.find((card) =>
        hasSuspiciousFlashcardChars(card.front) || hasSuspiciousFlashcardChars(card.back),
      );

      if (suspiciousSource || suspiciousCard) {
        console.warn("[flashcards/generate] suspicious math symbols detected", {
          rawChunkText: suspiciousSource ? formatSuspiciousPreview(suspiciousSource.text) : null,
          generatedFlashcardText: suspiciousCard
            ? {
                front: formatSuspiciousPreview(suspiciousCard.front),
                back: formatSuspiciousPreview(suspiciousCard.back),
              }
            : null,
        });
      }
    }

    const quotaConsume = await quotaTryConsume({
      admin: quotaAdmin,
      ownerId,
      feature: "flashcards_generate",
      amount: outCards.length,
      exceededMessage: "Du har nået din flashcards-grænse for denne måned.",
    });

    if (!quotaConsume.ok) {
      if (quotaConsume.status === 503) {
        console.error("[flashcards/generate] quota_try_consume error:", quotaConsume.raw);
      }
      const limits: LimitsPayload =
        typeof quotaConsume.limitPerMonth === "number"
          ? {
              plan: planKey,
              feature: "flashcards_generate",
              usedThisMonth: quotaConsume.used,
              monthlyLimit: quotaConsume.limitPerMonth,
              remainingThisMonth: Math.max(0, quotaConsume.limitPerMonth - quotaConsume.used),
            }
          : null;

      return NextResponse.json(
        {
          ok: false,
          error: quotaConsume.message,
          code: quotaConsume.status === 429 ? "QUOTA_EXCEEDED" : "QUOTA_CHECK_FAILED",
          limits,
          resetAt: quotaConsume.resetAt,
        },
        { status: quotaConsume.status },
      );
    }

    const sessionId = randomUUID();
    const usedFileId = sources[0]?.fileId ? String(sources[0].fileId) : null;
    const derivedScopeFolderIds = uniqTrimmed(
      sources
        .map((source) => source.folderId)
        .filter((folderId): folderId is string => typeof folderId === "string" && folderId.trim().length > 0),
    );
    const sessionScopeFolderIds = scopeFolderIds.length > 0 ? scopeFolderIds : derivedScopeFolderIds;

    const nowIso = new Date().toISOString();
    const cardsSnapshot = buildCardsSnapshot(outCards);
    if (cardsSnapshot.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Kunne ikke gemme kort-snapshot for sessionen." },
        { status: 500 },
      );
    }

    if (process.env.NODE_ENV !== "production") {
      const suspiciousStored = cardsSnapshot.find((card) =>
        hasSuspiciousFlashcardChars(card.front) || hasSuspiciousFlashcardChars(card.back),
      );
      if (suspiciousStored) {
        console.warn("[flashcards/generate] suspicious stored flashcard snapshot", {
          storedFlashcardText: {
            front: formatSuspiciousPreview(suspiciousStored.front),
            back: formatSuspiciousPreview(suspiciousStored.back),
          },
        });
      }
    }

    const insertPayloads = [
      {
        id: sessionId,
        owner_id: ownerId,
        created_at: nowIso,
        requested: effectiveRequested,
        returned: outCards.length,
        difficulty,
        scope_folder_ids: sessionScopeFolderIds,
        used_file_id: usedFileId,
        cards_snapshot: cardsSnapshot,
      },
      {
        owner_id: ownerId,
        created_at: nowIso,
        requested: effectiveRequested,
        returned: outCards.length,
        difficulty,
        scope_folder_ids: sessionScopeFolderIds,
        used_file_id: usedFileId,
        cards_snapshot: cardsSnapshot,
      },
      {
        id: sessionId,
        owner_id: ownerId,
        created_at: nowIso,
        requested: effectiveRequested,
        returned: outCards.length,
        difficulty,
        scope_folder_ids: sessionScopeFolderIds,
        cards_snapshot: cardsSnapshot,
      },
      {
        owner_id: ownerId,
        created_at: nowIso,
        requested: effectiveRequested,
        returned: outCards.length,
        difficulty,
        scope_folder_ids: sessionScopeFolderIds,
        cards_snapshot: cardsSnapshot,
      },
    ];

    const ins = await insertFlashcardSessionBestEffort(quotaAdmin, insertPayloads);
    if (!ins.ok) {
      console.error("[flashcards/generate] insert flashcard_sessions failed:", ins.error);
      return NextResponse.json(
        { ok: false, error: "Kunne ikke gemme flashcard-sessionen." },
        { status: 500 },
      );
    }

    const usedAfter = quotaConsume.used;
    const finalLimit = quotaConsume.limitPerMonth ?? monthlyLimit ?? quotaSnapshot.limitPerMonth;

    const limits: LimitsPayload =
      typeof finalLimit === "number"
        ? {
            plan: planKey,
            feature: "flashcards_generate",
            usedThisMonth: usedAfter,
            monthlyLimit: finalLimit,
            remainingThisMonth: Math.max(0, finalLimit - usedAfter),
          }
        : null;

    const resp: GenerateFlashcardsResponse = {
      ok: true,
      sessionId,
      cards: outCards,
      requested: effectiveRequested,
      returned: outCards.length,
      difficulty,
      scopeFolderIds: sessionScopeFolderIds,
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
