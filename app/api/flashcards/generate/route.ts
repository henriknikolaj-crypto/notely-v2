// app/api/flashcards/generate/route.ts
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
  count?: number; // antal kort (UI bruger 10)
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
      feature: "flashcards";
      usedThisMonth: number;
      monthlyLimit: number;
      remainingThisMonth: number;
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

function uniqTrimmed(ids: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ids) {
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

function monthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  return { monthStart: start.toISOString(), resetAt: resetAt.toISOString() };
}

async function loadLastUsedFileId(sb: any, ownerId: string, scopeKey: string): Promise<string | null> {
  try {
    const { data } = await sb
      .from("generation_state")
      .select("last_used_file_id")
      .eq("owner_id", ownerId)
      .eq("kind", "flashcards")
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
        kind: "flashcards",
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
    const scopeKey = scopeKeyFromFolderIds(scopeFolderIds);

    // Auth/dev-bypass
    let sb: any;
    let ownerId = "";
    try {
      const u = await requireUser(req);
      sb = u.sb;
      ownerId = u.id;
    } catch {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // plan + limit
    const { data: profile } = await sb.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const planRaw = (profile as any)?.plan ?? "freemium";
    const planKey = normalizePlan(planRaw);

    const { data: planLimits } = await sb
      .from("plan_limits")
      .select("feature, monthly_limit")
      .eq("plan", planKey);

    const monthlyLimitRaw =
      (planLimits ?? []).find((r: any) => r.feature === "flashcards")?.monthly_limit ?? null;

    const monthlyLimit =
      typeof monthlyLimitRaw === "number" && Number.isFinite(monthlyLimitRaw) && monthlyLimitRaw > 0
        ? Math.round(monthlyLimitRaw)
        : null;

    // usage this month = antal flashcard_sessions (sessions)
    const { monthStart, resetAt } = monthBoundsUTC(new Date());
    let usedThisMonth = 0;

    try {
      const r = await sb
        .from("flashcard_sessions")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .gte("created_at", monthStart)
        .lt("created_at", resetAt);

      if (!r.error) usedThisMonth = Number(r.count ?? 0) || 0;
    } catch {
      usedThisMonth = 0;
    }

    if (typeof monthlyLimit === "number" && usedThisMonth >= monthlyLimit) {
      const limits: LimitsPayload = {
        plan: planKey,
        feature: "flashcards",
        usedThisMonth,
        monthlyLimit,
        remainingThisMonth: 0,
      };
      return NextResponse.json(
        { ok: false, error: "Du har nået din flashcards-grænse for denne måned.", limits },
        { status: 402 },
      );
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

    // rotation
    const lastUsed = await loadLastUsedFileId(sb, ownerId, scopeKey);
    let start = 0;
    if (lastUsed) {
      const idx = fileRows.findIndex((f) => String(f.id) === String(lastUsed));
      if (idx >= 0) start = (idx + 1) % fileRows.length;
    } else {
      start = Math.floor(Math.random() * fileRows.length);
    }
    const rotated = [...fileRows.slice(start), ...fileRows.slice(0, start)];
    const rotationAnchorFileId = rotated[0]?.id ? String(rotated[0].id) : null;

    // load chunk pools pr. fil (cache)
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

    // byg SOURCES til modellen: 1 source pr. kort (giver 10/10 korrekte kilder)
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
      const f = rotated[pickIdx % rotated.length];
      pickIdx++;

      const fileId = String(f.id);
      const title = fileTitle(f);

      const pool = await loadPool(fileId);
      if (!pool.length) continue;

      const chunk = pool.pop(); // én gang pr. source
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
      outCards.push({
        id: randomUUID(),
        front,
        back,
        citation: {
          file_id: src.fileId,
          title: src.title,
          url: src.url,
        },
      });
    }

    // Hvis modellen returnerede færre, så accepter (UI viser returned)
    const sessionId = randomUUID();

    // gem session (best-effort)
    try {
      await sb.from("flashcard_sessions").insert({
        id: sessionId,
        owner_id: ownerId,
        scope_key: scopeKey,
        requested,
        returned: outCards.length,
        difficulty,
        scope_folder_ids: scopeFolderIds,
        used_file_id: rotationAnchorFileId,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      // schema kan variere - ignore
      console.error("[flashcards/generate] insert flashcard_sessions failed:", e);
    }

    if (rotationAnchorFileId) await saveLastUsedFileId(sb, ownerId, scopeKey, rotationAnchorFileId);

    const usedAfter = usedThisMonth + 1;
    const limits: LimitsPayload =
      typeof monthlyLimit === "number"
        ? {
            plan: planKey,
            feature: "flashcards",
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
      usedFileId: rotationAnchorFileId,
      usedFallback,
      limits,
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
