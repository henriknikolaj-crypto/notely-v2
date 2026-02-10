
---
## app\api\dev\quota-status\route.ts

// app/api/dev/quota-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readBearerOrShared(req: NextRequest): string {
  const h1 = req.headers.get("x-shared-secret");
  if (h1 && h1.trim()) return h1.trim();

  const h2 = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return h2.replace(/^Bearer\s+/i, "").trim();
}

function readDevSecret(req: NextRequest): string {
  return String(req.headers.get("x-dev-secret") || req.headers.get("x-shared-secret") || "").trim();
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function monthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
  const monthEnd = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0)).toISOString(); // eksklusiv
  return { monthStart, monthEnd };
}

function jsonError(
  status: number,
  payload: { ok?: boolean; code?: string; error?: string; message?: string } & Record<string, any>,
) {
  return NextResponse.json({ ok: false, ...payload }, { status });
}

function gate(req: NextRequest) {
  const isProd = process.env.NODE_ENV === "production";

  const expectedImport = String(process.env.IMPORT_SHARED_SECRET ?? "").trim();
  const expectedDev = String(process.env.DEV_BYPASS_SECRET ?? process.env.DEV_SECRET ?? "").trim();

  if (isProd) {
    // Prod: kræv IMPORT_SHARED_SECRET
    const incoming = readBearerOrShared(req);
    if (!expectedImport || incoming !== expectedImport) return { ok: false as const, status: 401 };
    return { ok: true as const, mode: "prod" as const };
  }

  // Dev: kræv dev-secret (primært) – ellers fallback til import secret hvis dev-secret ikke er sat
  if (expectedDev) {
    const incoming = readDevSecret(req);
    if (incoming !== expectedDev) return { ok: false as const, status: 404 };
    return { ok: true as const, mode: "dev" as const };
  }

  if (expectedImport) {
    const incoming = readBearerOrShared(req);
    if (incoming !== expectedImport) return { ok: false as const, status: 404 };
    return { ok: true as const, mode: "dev" as const };
  }

  // Ingen secrets sat => endpoint skal ikke være åbent
  return { ok: false as const, status: 404 };
}

export async function GET(req: NextRequest) {
  const g = gate(req);
  if (!g.ok) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: g.status });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    return jsonError(500, {
      code: "SERVER_MISCONFIG",
      message: "Supabase env vars mangler (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Owner: default DEV_USER_ID, men tillad override via ?owner_id=... når gated
  const sp = req.nextUrl.searchParams;
  const ownerOverride = (sp.get("owner_id") ?? sp.get("ownerId") ?? "").trim() || null;

  let ownerId = String(process.env.DEV_USER_ID ?? "").trim();
  if (ownerOverride) {
    if (!isUuidLike(ownerOverride)) {
      return jsonError(400, { code: "INVALID_OWNER_ID", error: "owner_id must be a UUID" });
    }
    ownerId = ownerOverride;
  }

  if (!ownerId) {
    return jsonError(400, { code: "DEV_USER_ID_MISSING", error: "DEV_USER_ID not set" });
  }

  const now = new Date();
  const { monthStart, monthEnd } = monthBoundsUTC(now);

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, email, plan, quota, quota_renew_at")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota-status] profile error:", profileErr);

  const plan = (profile as any)?.plan ?? "freemium";

  const { data: planLimitRows, error: planLimitErr } = await supabase
    .from("plan_limits")
    .select("plan, feature, monthly_limit")
    .eq("plan", plan);

  if (planLimitErr) console.error("[quota-status] plan_limits error:", planLimitErr);

  const planLimits = planLimitRows ?? [];

  const importLimit =
    planLimits.find((r: any) => r.feature === "import")?.monthly_limit ?? null;

  const evalLimit =
    planLimits.find((r: any) => r.feature === "evaluate")?.monthly_limit ?? null;

  // Import-brug (jobs.kind='import', status='succeeded')
  const { count: importThisMonth = 0, error: importMonthErr } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded")
    .gte("queued_at", monthStart)
    .lt("queued_at", monthEnd);

  if (importMonthErr) console.error("[quota-status] import month error:", importMonthErr);

  const { count: importAllTime = 0, error: importAllErr } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded");

  if (importAllErr) console.error("[quota-status] import all-time error:", importAllErr);

  // Evaluate-brug (exam_sessions, source_type='trainer')
  const { count: evalThisMonth = 0, error: evalMonthErr } = await supabase
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);

  if (evalMonthErr) console.error("[quota-status] eval month error:", evalMonthErr);

  const { count: evalAllTime = 0, error: evalAllErr } = await supabase
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer");

  if (evalAllErr) console.error("[quota-status] eval all-time error:", evalAllErr);

  return NextResponse.json({
    ok: true,
    gatedAs: g.mode,
    ownerId,
    now: now.toISOString(),
    monthStart,
    monthEnd,
    profile,
    import: {
      usedThisMonth: importThisMonth,
      totalAllTime: importAllTime,
      limitPerMonth: importLimit, // bagudkompat
      monthlyLimit: importLimit,
    },
    evaluate: {
      usedThisMonth: evalThisMonth,
      totalAllTime: evalAllTime,
      limitPerMonth: evalLimit,
      monthlyLimit: evalLimit,
    },
    planLimits,
  });
}


---
## app\api\evaluate\route.ts

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
## app\api\flashcards\generate\route.ts

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
## app\api\generate-mc-batch\route.ts

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
## app\api\generate-mc-question\route.ts

// app/api/generate-mc-question/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type GenerateMcRequest = {
  scopeFolderIds?: string[];
  difficulty?: Difficulty;
  maxContextChunks?: number;
  // ✅ sendes fra client for at undgå gentagelser i en session
  avoidQuestions?: string[];
  avoidChunkIds?: string[];
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
  scopeKey: string;
  usedChunkIds: string[];
  usedFileTitle: string | null;
  model: string;
  maxContextChunks: number;
  difficulty: Difficulty;
  avoided: {
    weber: boolean;
    magtDefinition: boolean;
  };
};

type GenerateMcResponse = {
  ok: true;
  questionId: string;
  question: string;
  options: McOptionPayload[];
  explanation: string | null;
  citations: McCitationPayload[];
  usedFileId: string | null; // ✅ den fil vi genererede ud fra
  meta: McMeta;
};

type FeatureQuota = {
  usedThisMonth: number;
  limitPerMonth: number | null;
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
  // fjerner "A) ", "B. ", "c: " osv.
  return String(t ?? "").replace(/^\s*[A-Da-d]\s*[\).:\-]\s*/g, "").trim();
}

// ✅ “topic blockers” baseret på tidligere spørgsmål i runden
function detectAvoidFlags(avoidQuestions: string[]) {
  const joined = avoidQuestions.map((x) => x.toLowerCase()).join("\n");

  const avoidWeber =
    /\bweber\b/.test(joined) ||
    /legal\s*[- ]?\s*rationel/.test(joined) ||
    /\bkarismatisk\b/.test(joined) ||
    /\btraditionel\b/.test(joined);

  const avoidMagtDefinition =
    /få\s+sin\s+vilje/.test(joined) || /over\s+for\s+modstand/.test(joined) || /kan\s+defineres\s+som/.test(joined);

  return { avoidWeber, avoidMagtDefinition };
}

function contentHasWeber(content: string) {
  const t = content.toLowerCase();
  return (
    t.includes("weber") ||
    t.includes("max weber") ||
    t.includes("legal-rationel") ||
    t.includes("legal rationel") ||
    t.includes("karismatisk") ||
    t.includes("traditionel")
  );
}

function contentHasMagtDef(content: string) {
  const t = content.toLowerCase();
  return t.includes("få sin vilje igennem") || t.includes("over for modstand") || t.includes("kan defineres som");
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY mangler i .env.local.", requestId }, { status: 500 });
    }

    const parsed = await readJsonBody<GenerateMcRequest>(req);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error, requestId }, { status: 400 });

    const body = parsed.value ?? {};
    const difficulty = pickDifficulty(body.difficulty);

    const rawMax = body.maxContextChunks;
    const maxContextChunks =
      typeof rawMax === "number" && Number.isFinite(rawMax) ? Math.min(Math.max(Math.round(rawMax), 4), 32) : 10;

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const scopeKey = scopeKeyFromFolderIds(scopeFolderIds);

    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 16);
    const avoidNorm = new Set(avoidQuestions.map(normalizeQuestion));
    const { avoidWeber, avoidMagtDefinition } = detectAvoidFlags(avoidQuestions);
    const avoidChunkIds = uniqTrimmed((body as any).avoidChunkIds).slice(0, 200);
    const avoidChunkSet = new Set(avoidChunkIds);

    // Auth
    let ownerId = "";
    try {
      const u = await requireUser(req);
      ownerId = u.id;
    } catch {
      return NextResponse.json({ ok: false, error: "Unauthorized", requestId }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(new Date());

    // Quota gate
    const { plan, mcLimit } = await getPlanAndLimit(admin, ownerId);
    if (!mcLimit || mcLimit <= 0) {
      return NextResponse.json(
        { ok: false, error: "Plan limits mangler for mc_generate. Tjek plan_limits.", requestId },
        { status: 500 },
      );
    }

    const mcMonth = await countMcJobsThisMonth(admin, ownerId, monthStart, resetAt);
    const mcQuota: FeatureQuota = { usedThisMonth: mcMonth.used, limitPerMonth: mcLimit };

    if (mcQuota.usedThisMonth >= mcQuota.limitPerMonth) {
      return NextResponse.json(
        {
          ok: false,
          code: "QUOTA_EXCEEDED",
          feature: "mc_generate",
          plan,
          usedThisMonth: mcQuota.usedThisMonth,
          monthlyLimit: mcQuota.limitPerMonth,
          monthStart,
          monthEnd,
          resetAt,
          requestId,
        },
        { status: 429 },
      );
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
      .limit(60);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) console.error("[generate-mc] files error:", requestId, filesErr);

    const fileRows = (files ?? []) as FileRow[];
    if (fileRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Ingen filer fundet i scope. Upload materiale først.", debug: { scopeFolderIds }, requestId },
        { status: 400 },
      );
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

    const scanMax = Math.min(30, rotated.length);
    const perFilePool = 200;

    let primaryFile: FileRow | null = null;
    let pickedChunks: ChunkRow[] = [];

    let fallbackFile: FileRow | null = null;
    let fallbackChunks: ChunkRow[] = [];

    for (const f of rotated.slice(0, scanMax)) {
      const fileId = String(f.id);

      const { data: pool, error: poolErr } = await admin
        .from("doc_chunks")
        .select("id,file_id,content,created_at,source_url")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(perFilePool);

      if (poolErr) {
        console.error("[generate-mc] doc_chunks pool error:", requestId, poolErr);
        continue;
      }

      const poolRows = (pool ?? []) as ChunkRow[];
      const nonEmpty = poolRows.filter((r) => (r.content ?? "").trim().length > 0);
      if (nonEmpty.length === 0) continue;

      if (!fallbackFile) {
        fallbackFile = f;
        fallbackChunks = shuffle(nonEmpty)
          .slice(0, Math.min(maxContextChunks, nonEmpty.length))
          .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));
      }

      const filtered = nonEmpty.filter((r) => {
        const txt = (r.content ?? "").toLowerCase();
        if (avoidWeber && contentHasWeber(txt)) return false;
        if (avoidMagtDefinition && contentHasMagtDef(txt)) return false;
        if (avoidChunkSet.has(String(r.id))) return false;
        return true;
      });

      const candidate = filtered.length > 0 ? filtered : null;
      if (!candidate) continue;

      primaryFile = f;
      pickedChunks = shuffle(candidate)
        .slice(0, Math.min(maxContextChunks, candidate.length))
        .sort((a, b) => (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0));

      break;
    }

    if (!primaryFile || pickedChunks.length === 0) {
      primaryFile = fallbackFile;
      pickedChunks = fallbackChunks;
    }

    if (!primaryFile || pickedChunks.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ingen kontekst fundet (doc_chunks) i scope. Tjek at upload/parse er kørt.",
          debug: { scopeFolderIds },
          requestId,
        },
        { status: 400 },
      );
    }

    const usedFileId = String(primaryFile.id);
    const usedFileTitle = fileTitle(primaryFile);

    const contextText = pickedChunks
      .map((c) => `KILDE: ${usedFileTitle}\n\n${(c.content ?? "").trim()}`)
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, 7000);

    if (!contextText.trim()) {
      return NextResponse.json({ ok: false, error: "Kontekst blev tom efter filtrering.", requestId }, { status: 400 });
    }

    const citations: McCitationPayload[] = pickedChunks.map((c) => ({
      chunkId: c.id,
      fileId: usedFileId,
      title: usedFileTitle,
      url: (c as any)?.source_url ? String((c as any).source_url) : null,
    }));

    const model = process.env.OPENAI_MODEL_MC || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const avoidBlock =
      avoidQuestions.length > 0
        ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${avoidQuestions.join("\n- ")}\n`
        : "";

    const avoidTopicsLines = [
      avoidWeber
        ? "- Undgå spørgsmål om Max Webers tre idealtypiske magtformer (traditionel/karismatisk/legal-rationel) og især 'legal-rationel magt'."
        : null,
      avoidMagtDefinition
        ? "- Undgå spørgsmål om standard-definitionen af magt ('evnen til at få sin vilje igennem... også over for modstand')."
        : null,
      "- Vælg et andet fokuspunkt i konteksten end de mest oplagte “første-linje facts”.",
      "- Lav gerne et spørgsmål der tester forståelse/anvendelse (ikke kun genkendelse).",
    ]
      .filter(Boolean)
      .join("\n");

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
- Plausible distraktorer
- Spørgsmålet skal være specifikt og må ikke være en ren gentagelse af samme faktasæt.

EKSTRA VARIATION (meget vigtigt):
${avoidTopicsLines}

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

    let finalQuestion = "";
    let finalOptions: Array<{ text: string; isCorrect: boolean }> = [];
    let finalExplanation: string | null = null;

    const blockedAnswerRe = /legal\s*[- ]?\s*rationel/i;
    const blockedWeberRe = /\bweber\b/i;
    const blockedMagtDefRe = /få\s+sin\s+vilje|over\s+for\s+modstand|kan\s+defineres\s+som/i;

    for (let attempt = 0; attempt < 3; attempt++) {
      const systemPrompt =
        attempt === 0
          ? systemPromptBase
          : `${systemPromptBase}\nEKSTRA VIGTIGT: Vælg et tydeligt andet fokus i konteksten end tidligere i runden.`;

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
      const norm = normalizeQuestion(q);

      if (!q || opts.length < 2) continue;
      if (avoidNorm.has(norm)) continue;

      const normalized = opts.slice(0, 4);
      while (normalized.length < 4) normalized.push({ text: `Mulighed ${normalized.length + 1}`, isCorrect: false });

      let correctIdx = normalized.findIndex((o) => !!o.isCorrect);
      if (correctIdx === -1) correctIdx = 0;

      const fixed = normalized.map((o, i) => ({
        text: stripLeadingLetterOption(String(o.text ?? "")) || `Mulighed ${i + 1}`,
        isCorrect: i === correctIdx,
      }));

      const correctText = String(fixed[correctIdx]?.text ?? "").trim();

      if (avoidWeber) {
        if (blockedWeberRe.test(q) || blockedAnswerRe.test(correctText)) continue;
      }
      if (avoidMagtDefinition) {
        if (blockedMagtDefRe.test(q) || blockedMagtDefRe.test(correctText)) continue;
      }

      finalQuestion = q;
      finalOptions = fixed;
      finalExplanation = String(payload.explanation ?? "").trim() || null;
      break;
    }

    if (!finalQuestion || finalOptions.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Modellen returnerede ufuldstændigt eller gentaget output.", requestId },
        { status: 500 },
      );
    }

    const shuffled = shuffle(finalOptions);
    const letters = ["a", "b", "c", "d"];
    const options: McOptionPayload[] = shuffled.map((o, i) => ({
      id: letters[i],
      text: o.text,
      isCorrect: o.isCorrect,
    }));

    await saveLastUsedFileId(admin, ownerId, scopeKey, usedFileId);

    const usedChunkIds = pickedChunks.map((c) => c.id);

    // ✅ vigtig: log mc_generate NU (så quota tæller ved generering)
    await logMcJob(admin, ownerId, {
      requestId,
      source: "generate-mc-question",
      scopeFolderIds,
      scopeKey,
      difficulty,
      model,
      usedFileId,
      usedFileTitle,
      usedChunkIds,
      maxContextChunks,
      citationCount: citations.length,
      avoided: { avoidWeber, avoidMagtDefinition },
      question: finalQuestion,
    });

    const resp: GenerateMcResponse = {
      ok: true,
      questionId: randomUUID(),
      question: finalQuestion,
      options,
      explanation: finalExplanation,
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
        avoided: { weber: avoidWeber, magtDefinition: avoidMagtDefinition },
      },
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[generate-mc] route error:", requestId, err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Uventet fejl i generate-mc-question.", requestId },
      { status: 500 },
    );
  }
}


---
## app\api\generate-question\route.ts

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
## app\api\import-status\route.ts

// app/api/import-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_TZ = "Europe/Copenhagen";

function n0(x: any) {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function errInfo(e: any) {
  if (!e) return { message: "Unknown error" };
  if (typeof e === "string") return { message: e };
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  return {
    message: e.message ?? e.error_description ?? e.error ?? e.msg ?? "",
    code: e.code,
    details: e.details,
    hint: e.hint,
    status: e.status,
  };
}

function formatDa(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: USER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getOwnerId(req: NextRequest): Promise<{ ownerId: string; isDev: boolean }> {
  const devHeader = (req.headers.get("x-dev-secret") || "").trim();
  const devSecret =
    (process.env.NOTELY_DEV_SECRET || process.env.X_DEV_SECRET || process.env.DEV_BYPASS_SECRET || "").trim();
  const devUserId = (process.env.DEV_USER_ID || "").trim();

  if (devHeader && devSecret && devUserId && devHeader === devSecret) {
    return { ownerId: devUserId, isDev: true };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ownerId: "", isDev: false };

  const cookieStore = await cookies();
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) cookieStore.set(c.name, c.value, c.options);
      },
    },
  });

  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user?.id) return { ownerId: "", isDev: false };
  return { ownerId: data.user.id, isDev: false };
}

async function getPlanAndLimit(admin: any, ownerId: string) {
  const { data: profile } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
  const plan = (profile as any)?.plan ?? "freemium";

  const { data: limitRow, error: limitErr } = await admin
    .from("plan_limits")
    .select("monthly_limit")
    .eq("plan", plan)
    .eq("feature", "import")
    .maybeSingle();

  if (limitErr) console.error("[import-status] plan_limits error:", errInfo(limitErr));

  const limitPerMonth =
    typeof (limitRow as any)?.monthly_limit === "number" ? (limitRow as any).monthly_limit : null;

  return { plan, limitPerMonth };
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();

  const { ownerId } = await getOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "Unauthorized", requestId }, { status: 401 });
  }

  let admin: any;
  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Server config mangler.", requestId }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const folderId = (searchParams.get("folder_id") || "").trim() || null;

  const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(new Date());
  const resetAtNice = formatDa(resetAt);

  const { plan, limitPerMonth } = await getPlanAndLimit(admin, ownerId);
  const monthlyLimit = typeof limitPerMonth === "number" ? limitPerMonth : null;

  // ✅ ENESTE sandhed: quota_usage (pages)
  let usedThisMonth = 0;
  try {
    const r = await admin
      .from("quota_usage")
      .select("used, reset_at, month_start")
      .eq("owner_id", ownerId)
      .eq("feature", "import")
      .eq("month_start", monthStart)
      .maybeSingle();

    if (r.error) console.error("[import-status] quota_usage read error:", errInfo(r.error));
    if (r.data?.used != null) usedThisMonth = n0((r.data as any).used);
  } catch (e) {
    console.error("[import-status] quota_usage exception:", errInfo(e));
  }

  const quotaReached = monthlyLimit != null && monthlyLimit > 0 ? usedThisMonth >= monthlyLimit : false;

  // ✅ Filer i alt: ignorer orphans (folder_id IS NULL) når der ikke er valgt folder
  let filesTotal = 0;
  let orphanedTotal = 0;

  try {
    const or = await admin
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .is("folder_id", null);

    if (!or.error && or.count != null) orphanedTotal = n0(or.count);
  } catch {}

  try {
    let q = admin.from("files").select("id", { count: "exact", head: true }).eq("owner_id", ownerId);

    if (folderId) q = q.eq("folder_id", folderId);
    else q = q.not("folder_id", "is", null);

    const r = await q;
    if (!r.error && r.count != null) filesTotal = n0(r.count);
  } catch (e) {
    console.error("[import-status] files total exception:", errInfo(e));
  }

  // Latest (samme filter)
  let latest: any = null;
  try {
    let q = admin
      .from("files")
      .select("id,name,folder_id,uploaded_at,created_at")
      .eq("owner_id", ownerId);

    if (folderId) q = q.eq("folder_id", folderId);
    else q = q.not("folder_id", "is", null);

    const r = await q
      .order("uploaded_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (r.error) {
      console.error("[import-status] latest error:", errInfo(r.error));
    } else {
      const row = Array.isArray(r.data) ? r.data[0] : null;
      if (row) {
        const ts = (row as any).uploaded_at ?? (row as any).created_at ?? null;
        latest = {
          id: (row as any).id,
          name: (row as any).name,
          folder_id: (row as any).folder_id ?? null,
          updated_at: ts,
        };
      }
    }
  } catch (e) {
    console.error("[import-status] latest exception:", errInfo(e));
  }

  return NextResponse.json(
    {
      ok: true,
      requestId,
      folderId,

      plan,
      usedThisMonth,
      reservedThisMonth: 0,
      monthlyLimit,
      resetAt,
      resetAtNice,
      monthStart,
      monthEnd,
      quotaReached,

      // legacy felter (så UI ikke knækker)
      used: usedThisMonth,
      limit: monthlyLimit,
      month: { used: usedThisMonth, limit: monthlyLimit },

      quota: {
        usedThisMonth,
        limitPerMonth: monthlyLimit,
        monthStart,
        monthEnd,
        resetAt,
        plan,
      },

      files: {
        total: filesTotal,
        hasFile: filesTotal > 0,
        latest,
      },

      filesTotal,
      latestFile: latest ? { name: latest.name ?? null, uploadedAt: latest.updated_at ?? null } : { name: null, uploadedAt: null },

      debug: { orphanedTotal },

      message: quotaReached ? `Grænse nået. Du kan uploade igen efter nulstilling (${resetAtNice}).` : null,
    },
    { status: 200 },
  );
}


---
## app\api\quota\current\route.ts

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
## app\api\quota-status\route.ts

// app/api/quota-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errInfo(e: any) {
  try {
    if (!e) return { message: "Unknown error", raw: e };
    if (typeof e === "string") return { message: e };
    if (e instanceof Error) return { message: e.message, stack: e.stack };

    const msg =
      e.message ?? e.error_description ?? e.error ?? e.msg ?? "Unknown error";

    return {
      message: msg,
      code: e.code,
      details: e.details,
      hint: e.hint,
      status: e.status,
      raw: Object.keys(e).length ? e : undefined,
    };
  } catch {
    return { message: "Unknown error" };
  }
}

/**
 * Månedens start + næste måneds start i UTC.
 * - monthStart: inklusiv
 * - resetAt: eksklusiv
 * - monthEnd: sidste millisekund i måneden (kun til visning/debug)
 */
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

function n0(x: number | null | undefined) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
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

  // Prøv først med status-filter + forskellige timestamp-kolonner.
  const tsCols = from && to ? ["queued_at", "created_at", "inserted_at"] : [null];

  let lastErr: any = null;

  for (const tsCol of tsCols) {
    // 1) Forsøg med status-filter (hvis angivet)
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

    // 2) Fallback: uden status-filter (så quota ikke crasher pga enum/values)
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

export async function GET(req: NextRequest) {
  // Auth/dev-bypass via lib/auth (+ lib/auth/owner.ts)
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

  // Profile
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, email, plan, quota, quota_renew_at")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) console.error("[quota-status] profile error:", errInfo(profileErr));

  const plan = (profile as any)?.plan ?? "freemium";

  // Plan limits
  const { data: planLimitRows, error: planLimitErr } = await admin
    .from("plan_limits")
    .select("plan, feature, monthly_limit")
    .eq("plan", plan);

  if (planLimitErr) console.error("[quota-status] plan_limits error:", errInfo(planLimitErr));

  const planLimits = planLimitRows ?? [];
  const importLimit =
    planLimits.find((r: any) => r.feature === "import")?.monthly_limit ?? null;
  const evalLimit =
    planLimits.find((r: any) => r.feature === "evaluate")?.monthly_limit ?? null;

  // Import usage (jobs(kind=import))
  const importStatuses = ["succeeded"];

  const importMonth = await countJobs({
    admin,
    ownerId,
    kind: "import",
    from: monthStart,
    to: resetAt,
    statuses: importStatuses,
  });

  if ((importMonth as any).error) {
    console.error("[quota-status] import month error:", errInfo((importMonth as any).error));
  }

  const importAll = await countJobs({
    admin,
    ownerId,
    kind: "import",
    statuses: importStatuses,
  });

  if ((importAll as any).error) {
    console.error("[quota-status] import all-time error:", errInfo((importAll as any).error));
  }

  // Evaluate usage (trainer) — inkluder både NULL og 'trainer' (bagudkompatibelt)
  const { count: evalThisMonthRaw, error: evalMonthErr } = await admin
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .or("source_type.is.null,source_type.eq.trainer")
    .gte("created_at", monthStart)
    .lt("created_at", resetAt);

  if (evalMonthErr) console.error("[quota-status] eval month error:", errInfo(evalMonthErr));

  const { count: evalAllTimeRaw, error: evalAllErr } = await admin
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .or("source_type.is.null,source_type.eq.trainer");

  if (evalAllErr) console.error("[quota-status] eval all-time error:", errInfo(evalAllErr));

  return NextResponse.json({
    ok: true,
    mode,
    ownerId,
    now: now.toISOString(),
    monthStart,
    monthEnd,
    resetAt,
    plan,
    profile,
    import: {
      usedThisMonth: n0(importMonth.count),
      totalAllTime: n0(importAll.count),
      limitPerMonth: importLimit,
    },
    evaluate: {
      usedThisMonth: n0(evalThisMonthRaw),
      totalAllTime: n0(evalAllTimeRaw),
      limitPerMonth: evalLimit,
    },
    planLimits,
    ...(process.env.NODE_ENV !== "production"
      ? { _debug: { importMonthUsed: importMonth.used, importAllUsed: importAll.used } }
      : {}),
  });
}


---
## app\api\trainer\upload\route.ts

// app/api/trainer/upload/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";
const MAX_FILE_BYTES = 30 * 1024 * 1024; // hård beskyttelse (ikke quota)

function errInfo(e: any) {
  if (!e) return { message: "Unknown error" };
  if (typeof e === "string") return { message: e };
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  return {
    message: e.message ?? e.error_description ?? e.error ?? e.msg ?? "Unknown error",
    code: e.code,
    details: e.details,
    hint: e.hint,
    status: e.status,
  };
}

function stripPathy(name: string) {
  const n = String(name ?? "").trim();
  const base = n.split(/[\\/]/g).pop() || n || "upload.pdf";
  return base.replace(/[\u0000-\u001F]/g, "").slice(0, 180) || "upload.pdf";
}

function formatDa(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getOwnerId(req: NextRequest): Promise<{ ownerId: string; isDev: boolean }> {
  const devHeader = (req.headers.get("x-dev-secret") || "").trim();
  const devSecret =
    (process.env.NOTELY_DEV_SECRET || process.env.X_DEV_SECRET || process.env.DEV_BYPASS_SECRET || "").trim();
  const devUserId = (process.env.DEV_USER_ID || "").trim();

  if (devHeader && devSecret && devUserId && devHeader === devSecret) {
    return { ownerId: devUserId, isDev: true };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ownerId: "", isDev: false };

  const cookieStore = await cookies();
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) cookieStore.set(c.name, c.value, c.options);
      },
    },
  });

  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user?.id) return { ownerId: "", isDev: false };
  return { ownerId: data.user.id, isDev: false };
}

async function tryInsertFile(admin: any, rows: any[]) {
  let lastErr: any = null;
  for (const obj of rows) {
    const r = await admin.from("files").insert(obj).select("id").maybeSingle();
    if (!r.error) return { ok: true as const, id: (r.data as any)?.id ?? obj.id };
    lastErr = r.error;
  }
  return { ok: false as const, error: lastErr };
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  const { ownerId } = await getOwnerId(req);
  if (!ownerId) return NextResponse.json({ ok: false, error: "Unauthorized", requestId }, { status: 401 });

  let admin: any;
  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Server config mangler.", requestId }, { status: 500 });
  }

  try {
    const form = await req.formData();

    const folderId = String(form.get("folder_id") ?? form.get("folderId") ?? form.get("folder") ?? "").trim() || null;
    const file = form.get("file") as unknown as File | null;

    if (!folderId) return NextResponse.json({ ok: false, error: "Manglende folder_id.", requestId }, { status: 400 });
    if (!file) return NextResponse.json({ ok: false, error: "Manglende fil.", requestId }, { status: 400 });

    if ((file as any).size != null && Number((file as any).size) > MAX_FILE_BYTES) {
      return NextResponse.json(
        { ok: false, error: `Filen er for stor (maks ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`, requestId },
        { status: 413 },
      );
    }

    // folder ownership
    const { data: folderRow, error: folderErr } = await admin
      .from("folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("id", folderId)
      .maybeSingle();

    if (folderErr) console.error("[trainer/upload] folder lookup error:", errInfo(folderErr));
    if (!folderRow) return NextResponse.json({ ok: false, error: "Ugyldig mappe (folder_id).", requestId }, { status: 400 });

    const originalName = stripPathy(file.name || "upload.pdf");
    const mimeType = String((file as any).type || "application/pdf") || "application/pdf";

    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const md5 = createHash("md5").update(buf).digest("hex");

    // duplicate check (før quota)
    const { data: existing, error: existingErr } = await admin
      .from("files")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("md5", md5)
      .maybeSingle();

    if (existingErr) console.error("[trainer/upload] duplicate lookup error:", errInfo(existingErr));
    if (existing?.id) {
      return NextResponse.json(
        {
          ok: false,
          code: "DUPLICATE_FILE",
          message: "Denne fil er allerede uploadet. Du kan ikke uploade den samme fil to gange.",
          existingFileId: existing.id,
          requestId,
        },
        { status: 409 },
      );
    }

    // ✅ præcis side-tæller (PDF pages)
let pages = 0;
try {
  const pdf = await PDFDocument.load(new Uint8Array(ab));
  pages = pdf.getPageCount();
} catch (e) {
  return NextResponse.json(
    { ok: false, code: "PDF_UNREADABLE", error: "PDF kunne ikke læses (side-tæller fejlede).", requestId },
    { status: 400 },
  );
}

if (!pages || pages < 1) {
  return NextResponse.json({ ok: false, code: "PDF_NO_PAGES", error: "PDF har ingen sider.", requestId }, { status: 400 });
}

// ✅ Freemium: max 10 sider pr PDF (justér tallet hvis du vil)
let plan = "freemium";
try {
  const p = await getPlanAndImportLimit(admin, ownerId);
  plan = (p?.plan ?? "freemium").toString();
} catch {}

if (plan === "freemium" && pages > 10) {
  return NextResponse.json(
    {
      ok: false,
      code: "FILE_TOO_LONG",
      message: "Freemium: maks 10 sider pr PDF.",
      pages,
      requestId,
    },
    { status: 413 },
  );
}

// ✅ quota: forbrug = sider
const quota = await admin.rpc("quota_try_consume", {
  p_owner_id: ownerId,
  p_feature: "import",
  p_amount: pages,
});

if (quota.error) {
  console.error("[trainer/upload] quota_try_consume error:", errInfo(quota.error));
  return NextResponse.json(
    { ok: false, code: "QUOTA_CHECK_FAILED", message: "Kunne ikke tjekke din grænse lige nu. Prøv igen om lidt.", requestId },
    { status: 503 },
  );
}

const row = Array.isArray(quota.data) ? quota.data[0] : quota.data;
const ok = !!row?.ok;

if (!ok) {
  const used = Number(row?.out_used ?? 0);
  const lim = row?.out_limit_per_month == null ? null : Number(row?.out_limit_per_month);
  const resetAt = row?.out_reset_at ? String(row.out_reset_at) : "";

  return NextResponse.json(
    {
      ok: false,
      code: "QUOTA_EXCEEDED",
      feature: "import",
      usedThisMonth: used,
      monthlyLimit: lim,
      resetAt,
      pages,
      message: `Grænse nået. Du kan uploade igen efter nulstilling (${resetAt ? formatDa(resetAt) : "snart"}).`,
      requestId,
    },
    { status: 429 },
  );
}

    // storage
    const fileId = randomUUID();
    const storagePath = `${ownerId}/${folderId}/${fileId}.pdf`;

    const up = await admin.storage.from(UPLOAD_BUCKET).upload(storagePath, buf, {
      contentType: mimeType || "application/pdf",
      upsert: false,
    });

    if (up.error) {
      console.error("[trainer/upload] storage upload error:", errInfo(up.error));
      return NextResponse.json({ ok: false, error: "Kunne ikke uploade filen til storage.", requestId }, { status: 500 });
    }

    const uploadedAt = new Date().toISOString();

    // insert files (robust fallback)
    const insertAttempts = [
      {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        original_name: originalName,
        mime_type: mimeType,
        size_bytes: (file as any).size ?? null,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
      },
      {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        mime_type: mimeType,
        size_bytes: (file as any).size ?? null,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
      },
      {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        storage_path: storagePath,
        md5,
        uploaded_at: uploadedAt,
      },
      {
        id: fileId,
        owner_id: ownerId,
        folder_id: folderId,
        name: originalName,
        uploaded_at: uploadedAt,
      },
    ];

    const ins = await tryInsertFile(admin, insertAttempts);
    if (!ins.ok) {
      console.error("[trainer/upload] files insert error:", errInfo(ins.error));

      // rollback storage (best-effort)
      try {
        await admin.storage.from(UPLOAD_BUCKET).remove([storagePath]);
      } catch {}

      return NextResponse.json({ ok: false, error: "Kunne ikke gemme fil i databasen.", requestId }, { status: 500 });
    }

    // valgfri job-log (best-effort)
    try {
      await admin.from("jobs").insert({
        id: randomUUID(),
        owner_id: ownerId,
        kind: "import",
        status: "queued",
        queued_at: uploadedAt,
        payload: { source: "trainer_upload", folder_id: folderId, file_id: fileId, md5, pages, storage_path: storagePath },
      });
    } catch {}

    return NextResponse.json(
      {
        ok: true,
        requestId,
        fileId,
        folderId,
        md5,
        pages,
        storage: { bucket: UPLOAD_BUCKET, path: storagePath },
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("[trainer/upload] route error:", errInfo(e));
    return NextResponse.json({ ok: false, error: e?.message ?? "Uventet fejl i upload.", requestId }, { status: 500 });
  }
}


---
## app\traener\_ui\LimitNotice.tsx

"use client";

import type { ReactNode } from "react";

type Props = {
  feature?: string | null;   // fx "trainer_round", "mc_generate", "flashcards_generate"
  message?: string | null;   // fx rate-limit tekst eller server-fejl
  children?: ReactNode;
  className?: string;
};

function labelFromFeature(feature?: string | null) {
  switch (String(feature ?? "").trim()) {
    case "trainer_round":
      return "Træner-runder";
    case "mc_generate":
    case "mc_round":
      return "Multiple Choice";
    case "flashcards_generate":
    case "flashcards_round":
      return "Flashcards";
    default:
      return null;
  }
}

function defaultMessage(feature?: string | null) {
  const label = labelFromFeature(feature);
  return label ? `Du har nået din grænse for ${label} denne måned.` : "Du har nået din grænse denne måned.";
}

export default function LimitNotice({ feature, message, children, className }: Props) {
  const msg = message && message.trim() ? message.trim() : null;

  const content =
    msg ??
    (typeof children === "string" ? children : null) ??
    defaultMessage(feature);

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700",
        className ?? "",
      ].join(" ")}
    >
      {typeof children !== "undefined" && typeof children !== "string" ? children : content}
    </div>
  );
}


---
## app\traener\flashcards\FlashcardsClient.tsx

// app/traener/flashcards/FlashcardsClient.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import LimitNotice from "../_ui/LimitNotice";

type Citation = {
  file_id?: string | null;
  title?: string | null;
  url?: string | null;

  // legacy
  fileId?: string | null;
  detail?: string | null;
};

type Flashcard = {
  id: string;
  front: string;
  back: string;
  citation?: Citation | null;
};

type Quota =
  | {
      feature?: string;
      plan?: string;
      usedThisMonth?: number;
      monthlyLimit?: number;
      remaining?: number;
      remainingThisMonth?: number; // bagudkompat
    }
  | null;

const DEMO_CARDS: Flashcard[] = [
  {
    id: "demo-1",
    front: "Hvad kendetegner en realistisk novelle?",
    back:
      "Hverdagsnært miljø, nøgternt sprog og konflikter, der udspringer af relationer og sociale vilkår. Personerne er ofte almindelige og komplekse.",
    citation: { title: "Demo", detail: "Eksempel" },
  },
  {
    id: "demo-2",
    front: "Hvad er en synsvinkel i en tekst?",
    back:
      "Synsvinklen er den position, teksten fortælles fra. Den styrer, hvad læseren får adgang til, og hvor tæt vi kommer på personers tanker og følelser.",
    citation: { title: "Demo", detail: "Eksempel" },
  },
  {
    id: "demo-3",
    front: "Nævn to typiske temaer i realistiske noveller.",
    back: "Identitet, sociale forskelle, moral/dilemmaer, relationer og ensomhed.",
    citation: { title: "Demo", detail: "Eksempel" },
  },
];

type Props = {
  scopeFolderIds?: string[];
};

const QUOTA_MSG = "Du har nået din grænse for Flashcards denne måned.";

async function readJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
}

function normalizeCard(raw: any): Flashcard | null {
  const id = String(raw?.id ?? "").trim();
  const front = String(raw?.front ?? "").trim();
  const back = String(raw?.back ?? "").trim();
  if (!id || !front || !back) return null;

  const cit =
    raw?.citation ?? {
      file_id: raw?.citation_file_id ?? null,
      title: raw?.citation_title ?? null,
      url: raw?.citation_url ?? null,
    };

  return { id, front, back, citation: cit ?? null };
}

function getScopeFromUrl(sp: ReturnType<typeof useSearchParams> | null): string[] {
  const s = sp?.get("scope");
  if (!s || !s.trim()) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function buildScopeFolderIds(propsScope: string[] | undefined, urlScopeIds: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const x of propsScope ?? []) {
    const s = String(x || "").trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }

  if (out.length === 0 && urlScopeIds.length > 0) {
    for (const s of urlScopeIds) {
      const t = String(s || "").trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }

  return out;
}

function pickFlashcardsQuota(json: any): { used: number; limit: number | null } {
  const used =
    (typeof json?.flashcards_generate?.usedThisMonth === "number" ? json.flashcards_generate.usedThisMonth : null) ??
    (typeof json?.flashcardsUsedThisMonth === "number" ? json.flashcardsUsedThisMonth : 0);

  const limit =
    (typeof json?.flashcards_generate?.limitPerMonth === "number" ? json.flashcards_generate.limitPerMonth : null) ??
    (typeof json?.flashcardsLimitPerMonth === "number" ? json.flashcardsLimitPerMonth : null);

  return { used: Number.isFinite(used) ? used : 0, limit: typeof limit === "number" ? limit : null };
}

export default function FlashcardsClient({ scopeFolderIds }: Props) {
  const sp = useSearchParams();
  const urlScopeIds = React.useMemo(() => getScopeFromUrl(sp), [sp]);

  const effectiveScopeFolderIds = React.useMemo(
    () => buildScopeFolderIds(scopeFolderIds, urlScopeIds),
    [scopeFolderIds, urlScopeIds],
  );

  const [cards, setCards] = React.useState<Flashcard[]>([]);
  const [i, setI] = React.useState(0);
  const [showBack, setShowBack] = React.useState(false);

  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [limitReached, setLimitReached] = React.useState(false);

  const [quota, setQuota] = React.useState<Quota>(null);
  void quota;

  const hasCards = cards.length > 0;
  const card = hasCards ? cards[i] : null;

  const canPrev = hasCards && i > 0;
  const canNext = hasCards && i < cards.length - 1;

  const pageLabel = hasCards ? `Kort ${i + 1} / ${cards.length}` : "Ingen kort endnu.";

  const citation = card?.citation ?? null;
  const citationTitle = String(citation?.title ?? "").trim();
  const citationUrl = String(citation?.url ?? "").trim();
  const citationFileId = String(citation?.file_id ?? citation?.fileId ?? "").trim();
  const citationDetail = String(citation?.detail ?? "").trim();

  const dispatchQuotaChanged = React.useCallback(() => {
    try {
      window.dispatchEvent(new Event("notely-quota-changed"));
      window.dispatchEvent(new Event("flashcards:changed"));
    } catch {
      // ignore
    }
  }, []);

  const precheckQuota = React.useCallback(async () => {
    try {
      const res = await fetch("/api/quota/current", { method: "GET" });
      if (!res.ok) return;

      const json = await readJsonSafe(res);
      if (!json?.ok) return;

      const { used, limit } = pickFlashcardsQuota(json);
      if (typeof limit === "number" && limit > 0) {
        const remaining = Math.max(0, limit - used);
        if (remaining <= 0) {
          setLimitReached(true);
          setNotice(QUOTA_MSG);
        } else {
          setLimitReached(false);
          setNotice(null);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // ✅ Vis limit med det samme ved load + når quota ændrer sig
  React.useEffect(() => {
    void precheckQuota();

    const onQuota = () => void precheckQuota();
    window.addEventListener("notely-quota-changed", onQuota);
    return () => window.removeEventListener("notely-quota-changed", onQuota);
  }, [precheckQuota]);

  const generate = React.useCallback(async () => {
    if (limitReached) return;

    setLoading(true);
    setNotice(null);

    try {
      const res = await fetch("/api/flashcards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeFolderIds: effectiveScopeFolderIds,
          count: 10,
          difficulty: "medium",
          maxContextChunks: 14,
        }),
      });

      const data = await readJsonSafe(res);

      if (data?.quota) setQuota(data.quota as Quota);
      else if (data?.limits) setQuota(data.limits as Quota);

      if (res.status === 402 || res.status === 429) {
        setLimitReached(true);
        setNotice(String(data?.error ?? QUOTA_MSG));
        dispatchQuotaChanged();
        return;
      }

      const rawCards = Array.isArray(data?.cards) ? data.cards : [];
      const next = rawCards.map(normalizeCard).filter(Boolean) as Flashcard[];

      if (res.ok && data?.ok && next.length > 0) {
        setLimitReached(false);
        setCards(next);
        setI(0);
        setShowBack(false);
        if (data?.warning) setNotice(String(data.warning));
        dispatchQuotaChanged();
        return;
      }

      setLimitReached(false);
      setCards(DEMO_CARDS);
      setI(0);
      setShowBack(false);
      setNotice(String(data?.warning ?? data?.error ?? "Kunne ikke generere kort – bruger demo-kort i stedet."));
      dispatchQuotaChanged();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("flashcards generate error:", err);
      setCards(DEMO_CARDS);
      setI(0);
      setShowBack(false);
      setNotice("Kunne ikke generere kort – bruger demo-kort i stedet.");
      dispatchQuotaChanged();
    } finally {
      setLoading(false);
    }
  }, [effectiveScopeFolderIds, dispatchQuotaChanged, limitReached]);

  function prev() {
    if (!canPrev) return;
    setI((x) => Math.max(0, x - 1));
    setShowBack(false);
  }

  function next() {
    if (!canNext) return;
    setI((x) => Math.min(cards.length - 1, x + 1));
    setShowBack(false);
  }

  function flip() {
    if (!hasCards) return;
    setShowBack((x) => !x);
  }

  const hasScope = effectiveScopeFolderIds.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          <span className="font-medium text-zinc-900">{pageLabel}</span>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={loading || !hasScope || limitReached}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          {loading ? "Genererer…" : "Generér 10 kort"}
        </button>
      </div>

      {/* ✅ ens “grå boks” ved limit */}
      {limitReached ? <LimitNotice feature="flashcards_generate" message={notice ?? QUOTA_MSG} /> : null}
      {!limitReached && notice ? <div className="text-xs text-zinc-500">{notice}</div> : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-zinc-900">{showBack ? "Svar" : "Spørgsmål"}</div>

        <div className="mt-3 min-h-[120px] text-[15px] leading-6 text-zinc-900">
          {card ? (showBack ? card.back : card.front) : "Vælg mappe(r) i venstre side og tryk “Generér 10 kort”."}
        </div>

        <div className="mt-4 text-xs text-zinc-500">
          {citationTitle ? (
            <span>
              Kilde:{" "}
              {citationUrl ? (
                <a
                  href={citationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-zinc-700"
                >
                  {citationTitle}
                </a>
              ) : citationFileId ? (
                <Link
                  href={`/traener/upload?fileId=${encodeURIComponent(citationFileId)}`}
                  className="underline underline-offset-2 hover:text-zinc-700"
                >
                  {citationTitle}
                </Link>
              ) : (
                <span>{citationTitle}</span>
              )}
              {citationDetail ? ` (${citationDetail})` : ""}
            </span>
          ) : (
            "\u00A0"
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={prev}
          disabled={!canPrev || loading}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          Forrige
        </button>

        <button
          type="button"
          onClick={flip}
          disabled={!hasCards || loading}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          {showBack ? "Vis spørgsmål" : "Vis svar"}
        </button>

        <button
          type="button"
          onClick={next}
          disabled={!canNext || loading}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          Næste
        </button>
      </div>
    </div>
  );
}


---
## app\traener\mc\ClientMC.tsx

// app/traener/mc/ClientMC.tsx
"use client";
import LimitNotice from "@/app/traener/_ui/LimitNotice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MCOption = {
  id: string;
  text: string;
  isCorrect: boolean;
};

type MCCitation = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type MCMeta = {
  requestId?: string | null;
  usedChunkIds?: string[] | null;
  usedFileTitle?: string | null;
};

type MCQuestion = {
  id: string;
  question: string;
  options: MCOption[];
  explanation?: string | null;
  citations?: MCCitation[];
  usedFileId?: string | null;
  meta?: MCMeta;
  source: "api" | "fallback";
};

type GenerateMcItemOk = {
  ok: true;
  questionId: string;
  question: string;
  options: MCOption[];
  explanation: string | null;
  citations: MCCitation[];
  usedFileId: string | null;
  meta?: MCMeta;
};

type GenerateMcItemErr = {
  ok: false;
  error?: string;
};

type GenerateMcItem = GenerateMcItemOk | GenerateMcItemErr;

type GenerateMcSingleResponseOk = GenerateMcItemOk;
type GenerateMcSingleResponseErr = { ok: false; error?: string; code?: string; requestId?: string };
type GenerateMcSingleResponse = GenerateMcSingleResponseOk | GenerateMcSingleResponseErr;

type GenerateMcBatchResponseOk = {
  ok: true;
  batchId: string;
  requestedCount: number;
  effectiveCount?: number; // quota-aware count fra API (hvis sendt)
  returnedCount: number;
  items: GenerateMcItem[];
  requestId?: string;
};

type GenerateMcBatchResponseErr = {
  ok: false;
  error?: string;
  code?: string;
  requestId?: string;
};

type GenerateMcBatchResponse = GenerateMcBatchResponseOk | GenerateMcBatchResponseErr;

// Fallback-spørgsmål hvis API'et ikke svarer
const FALLBACK_QUESTIONS: MCQuestion[] = [
  {
    id: "local-q1",
    question: "Hvad er hovedformålet med Notely?",
    options: [
      { id: "a", text: "At være en nordisk studieassistent, der hjælper dig med at forstå dit eget pensum", isCorrect: true },
      { id: "b", text: "At erstatte alle lærebøger, så du aldrig behøver at læse igen", isCorrect: false },
      { id: "c", text: "At være et generelt AI-chatværktøj uden fokus på studier", isCorrect: false },
      { id: "d", text: "Kun at lave marketing-tekster til sociale medier", isCorrect: false },
    ],
    explanation:
      "Notely er tænkt som en studieassistent/eksamenstræner, der arbejder ud fra dit eget pensum – ikke som en erstatning for alt andet.",
    source: "fallback",
  },
  {
    id: "local-q2",
    question: "Hvad er en god tommelfingerregel for Multiple Choice-spørgsmål i Notely?",
    options: [
      { id: "a", text: "Kun ét korrekt svar, tydeligt adskilt fra distraktorerne", isCorrect: true },
      { id: "b", text: "Flere svar, der alle er lige korrekte", isCorrect: false },
      { id: "c", text: "Svarmuligheder, der er så uklare som muligt", isCorrect: false },
      { id: "d", text: "Altid mindst 8 svarmuligheder", isCorrect: false },
    ],
    explanation: "MC-spørgsmål bliver stærkest, når der er én klar korrekt mulighed og nogle plausible distraktorer.",
    source: "fallback",
  },
  {
    id: "local-q3",
    question: "Hvordan skal MC-delen på sigt fungere i Notely ift. dit pensum?",
    options: [
      { id: "a", text: "Spørgsmålene skal genereres ud fra dine egne noter og filer", isCorrect: true },
      { id: "b", text: "Spørgsmålene skal være helt tilfældige uden relation til pensum", isCorrect: false },
      { id: "c", text: "Spørgsmålene skal kun handle om Notelys funktioner", isCorrect: false },
      { id: "d", text: "Spørgsmålene skal kun komme fra en global amerikansk syllabus", isCorrect: false },
    ],
    explanation: "Planen er, at MC-spørgsmål genereres ud fra dit eget materiale, så træningen matcher dit fag.",
    source: "fallback",
  },
];

type Props = {
  scopeFolderIds?: string[];
};

const DEFAULT_SESSION_SIZE = 10;
const QUOTA_MSG = "Du har nået din grænse for Multiple Choice denne måned.";

function clampInt(n: number, min: number, max: number) {
  const x = Number.isFinite(n) ? Math.round(n) : min;
  return Math.min(max, Math.max(min, x));
}

function pickQuota(json: any): { used: number; limit: number | null } {
  const used =
    (typeof json?.mc_generate?.usedThisMonth === "number" ? json.mc_generate.usedThisMonth : null) ??
    (typeof json?.mcUsedThisMonth === "number" ? json.mcUsedThisMonth : 0);

  const limit =
    (typeof json?.mc_generate?.limitPerMonth === "number" ? json.mc_generate.limitPerMonth : null) ??
    (typeof json?.mcLimitPerMonth === "number" ? json.mcLimitPerMonth : null);

  return { used: Number.isFinite(used) ? used : 0, limit: typeof limit === "number" ? limit : null };
}

export default function ClientMC({ scopeFolderIds }: Props) {
  const scopeKey = useMemo(() => JSON.stringify(scopeFolderIds ?? []), [scopeFolderIds]);

  // ✅ bruger skal selv starte
  const [started, setStarted] = useState(false);

  const [currentQuestion, setCurrentQuestion] = useState<MCQuestion | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const [sessionTotal, setSessionTotal] = useState(DEFAULT_SESSION_SIZE);
  const [questionNumber, setQuestionNumber] = useState(1);
  const [attemptCount, setAttemptCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [loadingNext, setLoadingNext] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<string | null>(null);

  const [fallbackIndex, setFallbackIndex] = useState(0);

  // batch queue
  const [queue, setQueue] = useState<MCQuestion[]>([]);
  const [queuePos, setQueuePos] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  // husk de seneste spørgsmål/chunks i en runde for at undgå gentagelser
  const recentQuestionsRef = useRef<string[]>([]);
  const recentChunkIdsRef = useRef<string[]>([]);

  // afgør om batch endpoint findes (hvis 404, falder vi tilbage til single)
  const batchSupportedRef = useRef<boolean | null>(null);

  const dispatchQuotaChanged = useCallback(() => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("notely-quota-changed"));
  }, []);

  const dispatchMcUpdated = useCallback(() => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("notely:mc-updated"));
  }, []);

  const readJson = useCallback(async <T,>(res: Response): Promise<T> => {
    const txt = await res.text();
    if (!txt.trim()) return {} as T;
    return JSON.parse(txt) as T;
  }, []);

  const computeSessionSize = useCallback(async () => {
    try {
      const res = await fetch("/api/quota/current", { method: "GET" });
      if (!res.ok) return DEFAULT_SESSION_SIZE;

      const json = await readJson<any>(res);
      if (!json?.ok) return DEFAULT_SESSION_SIZE;

      const { used, limit } = pickQuota(json);
      if (typeof limit === "number" && limit > 0) {
        const remaining = Math.max(0, limit - used);
        return clampInt(Math.min(DEFAULT_SESSION_SIZE, remaining), 0, DEFAULT_SESSION_SIZE);
      }
      return DEFAULT_SESSION_SIZE;
    } catch {
      return DEFAULT_SESSION_SIZE;
    }
  }, [readJson]);

  function registerAntiRepeat(q: MCQuestion) {
    const qt = String(q.question ?? "").trim();
    if (qt) recentQuestionsRef.current = [...recentQuestionsRef.current, qt].slice(-20);

    const usedChunkIds = (q.meta?.usedChunkIds ?? []) || [];
    if (Array.isArray(usedChunkIds) && usedChunkIds.length > 0) {
      const merged = [...recentChunkIdsRef.current, ...usedChunkIds.map((x) => String(x))];

      const seen = new Set<string>();
      const out: string[] = [];
      for (let i = merged.length - 1; i >= 0; i--) {
        const s = String(merged[i] ?? "").trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
        if (out.length >= 120) break;
      }
      recentChunkIdsRef.current = out.reverse();
    }
  }

  const fetchBatch = useCallback(
    async (count: number) => {
      setLoadingNext(true);
      setLoadError(null);
      setQuotaBlocked(null);

      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const avoidQuestions = recentQuestionsRef.current.slice(-12);
        const avoidChunkIds = recentChunkIdsRef.current.slice(-80);

        const res = await fetch("/api/generate-mc-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scopeFolderIds: scopeFolderIds ?? [],
            difficulty: "medium" as const,
            maxContextChunks: 10,
            count,
            avoidQuestions,
            avoidChunkIds,
            avoidTopics: [],
          }),
          signal: ac.signal,
        });

        if (res.status === 404) {
          batchSupportedRef.current = false;
          throw new Error("BATCH_NOT_FOUND");
        }
        batchSupportedRef.current = true;

        if (res.status === 429) {
          const j = await readJson<any>(res).catch(() => null);
          const msg = String(j?.error ?? "").trim() || QUOTA_MSG;
          setQuotaBlocked(msg);
          setCurrentQuestion(null);
          setIsFinished(true);
          dispatchQuotaChanged();
          return;
        }

        if (res.status === 401) {
          const j = await readJson<any>(res).catch(() => null);
          setLoadError(String(j?.error ?? "Unauthorized. Log ind igen."));
          throw new Error("Unauthorized");
        }

        if (res.status === 400) {
          const j = await readJson<any>(res).catch(() => null);
          setLoadError(String(j?.error ?? "Kunne ikke generere spørgsmål fra dit materiale (400)."));
          throw new Error("BadRequest");
        }

        if (!res.ok) {
          const j = await readJson<any>(res).catch(() => null);
          const msg = String(j?.error ?? "").trim() || `Serverfejl (${res.status}).`;
          throw new Error(msg);
        }

        const data = (await readJson<GenerateMcBatchResponse>(res)) as GenerateMcBatchResponse;

        if (!data || (data as any).ok === false) {
          const msg = String((data as any)?.error ?? "Kunne ikke generere MC-batch.");
          throw new Error(msg);
        }

        const ok = data as GenerateMcBatchResponseOk;
        const items = Array.isArray(ok.items) ? ok.items : [];

        const apiQuestionsAll: MCQuestion[] = items
          .filter((it) => it && (it as any).ok === true)
          .map((it) => {
            const v = it as GenerateMcItemOk;
            return {
              id: v.questionId,
              question: v.question,
              options: v.options,
              explanation: v.explanation,
              citations: v.citations ?? [],
              usedFileId: v.usedFileId ?? null,
              meta: v.meta ?? {},
              source: "api" as const,
            };
          })
          .filter((q) => (q.question ?? "").trim().length > 0 && Array.isArray(q.options) && q.options.length === 4);

        if (apiQuestionsAll.length === 0) throw new Error("Batch returnerede ingen gyldige spørgsmål.");

        const effective =
          typeof ok.effectiveCount === "number" && Number.isFinite(ok.effectiveCount)
            ? Math.max(1, ok.effectiveCount)
            : typeof ok.returnedCount === "number" && Number.isFinite(ok.returnedCount)
              ? ok.returnedCount
              : apiQuestionsAll.length;

        const apiQuestions = apiQuestionsAll.slice(0, Math.min(effective, apiQuestionsAll.length));

        // sessionTotal = det vi faktisk har i runden
        setSessionTotal(apiQuestions.length);

        setQueue(apiQuestions);
        setQueuePos(0);
        setCurrentQuestion(apiQuestions[0] ?? null);
        setQuestionNumber(1);

        dispatchQuotaChanged();
        registerAntiRepeat(apiQuestions[0]);
      } finally {
        setLoadingNext(false);
        setSelectedId(null);
        setChecked(false);
        setSaveError(null);
      }
    },
    [dispatchQuotaChanged, readJson, scopeFolderIds],
  );

  const fetchSingle = useCallback(
    async (mode: "initial" | "next") => {
      setLoadingNext(true);
      setLoadError(null);
      setQuotaBlocked(null);

      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const avoidQuestions = recentQuestionsRef.current.slice(-12);
        const avoidChunkIds = recentChunkIdsRef.current.slice(-80);

        const res = await fetch("/api/generate-mc-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scopeFolderIds: scopeFolderIds ?? [],
            difficulty: "medium" as const,
            maxContextChunks: 10,
            avoidQuestions,
            avoidChunkIds,
            avoidTopics: [],
          }),
          signal: ac.signal,
        });

        if (res.status === 429) {
          const j = await readJson<any>(res).catch(() => null);
          const msg = String(j?.error ?? "").trim() || QUOTA_MSG;
          setQuotaBlocked(msg);
          setCurrentQuestion(null);
          setIsFinished(true);
          dispatchQuotaChanged();
          return;
        }

        if (res.status === 401) {
          const j = await readJson<any>(res).catch(() => null);
          setLoadError(String(j?.error ?? "Unauthorized. Log ind igen."));
          throw new Error("Unauthorized");
        }

        if (res.status === 400) {
          const j = await readJson<any>(res).catch(() => null);
          setLoadError(String(j?.error ?? "Kunne ikke generere spørgsmål fra dit materiale (400)."));
          throw new Error("BadRequest");
        }

        if (!res.ok) {
          const j = await readJson<any>(res).catch(() => null);
          const msg = String(j?.error ?? "").trim() || `Serverfejl (${res.status}).`;
          throw new Error(msg);
        }

        const data = (await readJson<GenerateMcSingleResponse>(res)) as GenerateMcSingleResponse;

        if (!data || (data as any).ok === false) {
          const msg = String((data as any)?.error ?? "Kunne ikke generere MC-spørgsmål.");
          throw new Error(msg);
        }

        const ok = data as GenerateMcSingleResponseOk;

        const apiQuestion: MCQuestion = {
          id: ok.questionId,
          question: ok.question,
          options: ok.options,
          explanation: ok.explanation,
          citations: ok.citations ?? [],
          usedFileId: ok.usedFileId ?? null,
          meta: ok.meta ?? {},
          source: "api",
        };

        setCurrentQuestion(apiQuestion);

        dispatchQuotaChanged();
        registerAntiRepeat(apiQuestion);

        if (mode === "next") setQuestionNumber((prev) => prev + 1);
        else setQuestionNumber(1);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (quotaBlocked) return;

        if (err?.message !== "BATCH_NOT_FOUND") {
          // eslint-disable-next-line no-console
          console.error("generate-mc-question error:", err);
        }

        setLoadError((prev) => prev || "Kunne ikke hente nyt spørgsmål – bruger demo-spørgsmål i stedet.");

        setFallbackIndex((prev) => {
          const next = (prev + (mode === "next" ? 1 : 0)) % FALLBACK_QUESTIONS.length;
          setCurrentQuestion(FALLBACK_QUESTIONS[next]);
          return next;
        });

        if (mode === "next") setQuestionNumber((prev) => prev + 1);
        else setQuestionNumber(1);
      } finally {
        setLoadingNext(false);
        setSelectedId(null);
        setChecked(false);
        setSaveError(null);
      }
    },
    [dispatchQuotaChanged, quotaBlocked, readJson, scopeFolderIds],
  );

  const startNewRound = useCallback(async () => {
    // ✅ markér at bruger har startet (så vi ikke viser “Start” samtidigt med “Session afsluttet”)
    setStarted(true);

    setIsFinished(false);
    setQuotaBlocked(null);
    setLoadError(null);
    setSaveError(null);

    setAttemptCount(0);
    setCorrectCount(0);

    // reset anti-repeat per runde
    recentQuestionsRef.current = [];
    recentChunkIdsRef.current = [];

    // reset queue
    setQueue([]);
    setQueuePos(0);

    const sz = await computeSessionSize();

    if (sz <= 0) {
      setSessionTotal(0);
      setCurrentQuestion(null);
      setIsFinished(true);
      setQuotaBlocked(QUOTA_MSG);
      dispatchQuotaChanged();
      return;
    }

    setSessionTotal(sz);
    setQuestionNumber(1);

    // prøv batch hvis muligt, ellers single
    const batchSupported = batchSupportedRef.current;

    if (batchSupported === false) {
      await fetchSingle("initial");
      return;
    }

    try {
      await fetchBatch(sz);
    } catch (e: any) {
      if (e?.message === "BATCH_NOT_FOUND") {
        await fetchSingle("initial");
        return;
      }
      await fetchSingle("initial");
    }
  }, [computeSessionSize, dispatchQuotaChanged, fetchBatch, fetchSingle]);

  // ✅ ved scope-skift: stop alt og gå tilbage til “Start”
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();

    setStarted(false);

    setCurrentQuestion(null);
    setSelectedId(null);
    setChecked(false);

    setAttemptCount(0);
    setCorrectCount(0);
    setIsFinished(false);

    setSaving(false);
    setSaveError(null);

    setLoadingNext(false);
    setLoadError(null);

    setQueue([]);
    setQueuePos(0);

    recentQuestionsRef.current = [];
    recentChunkIdsRef.current = [];

    // lille precheck: hvis der ikke er flere tilbage, så skjul “Start”
    void (async () => {
      const sz = await computeSessionSize();
      setSessionTotal(sz);
      if (sz <= 0) setQuotaBlocked(QUOTA_MSG);
      else setQuotaBlocked(null);
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const correctOption = currentQuestion?.options.find((o) => o.isCorrect) || null;

  const isCorrect =
    checked && selectedId && currentQuestion
      ? (currentQuestion.options.find((o) => o.id === selectedId)?.isCorrect ?? false)
      : false;

  function handleSelect(optionId: string) {
    if (checked) return;
    setSelectedId(optionId);
  }

  async function handleCheck() {
    if (!selectedId || checked || !currentQuestion) return;

    const selectedOption = currentQuestion.options.find((o) => o.id === selectedId);
    if (!selectedOption) return;

    const correct = !!selectedOption.isCorrect;

    setChecked(true);
    setSaving(true);
    setSaveError(null);

    setAttemptCount((prev) => prev + 1);
    if (correct) setCorrectCount((prev) => prev + 1);

    try {
      const res = await fetch("/api/mc-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          question: currentQuestion.question,
          selectedOptionId: selectedOption.id,
          selectedOptionText: selectedOption.text,
          isCorrect: correct,
          scopeFolderIds,
          explanation: currentQuestion.explanation ?? null,
          meta: currentQuestion.meta ?? null,
          usedFileId: currentQuestion.usedFileId ?? null,
        }),
      });

      if (!res.ok) throw new Error(`mc-submit bad status: ${res.status}`);

      dispatchMcUpdated();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("mc-submit fetch error:", err);
      setSaveError("Kunne ikke gemme resultatet (lokal fejl).");
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    if (!checked || loadingNext) return;

    // hvis sessionen er slut, så tjek om der reelt er mere quota
    if (questionNumber >= sessionTotal) {
      const sz = await computeSessionSize();
      if (sz <= 0) setQuotaBlocked(QUOTA_MSG);

      setIsFinished(true);
      setCurrentQuestion(null);
      return;
    }

    if (queue.length > 0) {
      const nextPos = queuePos + 1;
      const nextQ = queue[nextPos];

      if (nextQ) {
        setQueuePos(nextPos);
        setCurrentQuestion(nextQ);
        setQuestionNumber((prev) => prev + 1);

        setSelectedId(null);
        setChecked(false);
        setSaveError(null);
        setLoadError(null);

        registerAntiRepeat(nextQ);
        return;
      }

      // queue er tom -> session slut (tjek quota)
      const sz = await computeSessionSize();
      if (sz <= 0) setQuotaBlocked(QUOTA_MSG);

      setIsFinished(true);
      setCurrentQuestion(null);
      return;
    }

    await fetchSingle("next");
  }

  // vis kun kilder fra usedFileId + dedupe pr fil
  const shownSources = useMemo(() => {
    const cits = currentQuestion?.citations ?? [];
    if (cits.length === 0) return [];

    const usedFileId = currentQuestion?.usedFileId ?? null;
    const filtered = usedFileId ? cits.filter((c) => c.fileId === usedFileId) : cits;

    const seen = new Set<string>();
    const out: Array<{ key: string; title: string; url: string | null; fileId: string | null }> = [];

    for (const c of filtered) {
      const title = (c.title ?? "").trim();
      if (!title) continue;

      const k = `${c.fileId ?? ""}|${title}|${c.url ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);

      out.push({
        key: k,
        title,
        url: c.url ?? null,
        fileId: c.fileId ?? null,
      });
    }

    return out.slice(0, 3);
  }, [currentQuestion]);

  const requestIdShown = currentQuestion?.meta?.requestId ? String(currentQuestion.meta.requestId) : null;

  // ✅ “start state” – ingen auto-generering når man lander på siden
  if (!started && !currentQuestion && !isFinished) {
    const hasScope = (scopeFolderIds ?? []).length > 0;

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-semibold text-zinc-900">Multiple Choice</div>
          <div className="mt-1 text-xs text-zinc-600">
            Vælg først mappe(r) i venstre side. Tryk derefter “Start” for at generere en runde.
          </div>

          {quotaBlocked ? <LimitNotice className="mt-3">{quotaBlocked}</LimitNotice> : null}

<div className="mt-4 flex flex-wrap gap-2">
  <button
    type="button"
    onClick={() => void startNewRound()}
    disabled={!hasScope || !!quotaBlocked}
    className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
  >
    Start
  </button>
</div>
        </div>
      </div>
    );
  }

  if (isFinished && !currentQuestion) {
    const isQuota = !!quotaBlocked;

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-semibold text-zinc-900">Session afsluttet</div>
          <div className="mt-1 text-xs text-zinc-600">{isQuota ? quotaBlocked : "Du er færdig med denne runde."}</div>

          {!isQuota && (
            <div className="mt-3 text-xs text-zinc-700">
              Resultat: <span className="font-medium">{correctCount}/{sessionTotal}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
  {isQuota ? null : (
    <button
      type="button"
      onClick={() => void startNewRound()}
      className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white"
    >
      Ny runde
    </button>
  )}
</div>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="space-y-2 text-xs text-zinc-600">
        <div>Genererer spørgsmål …</div>
        {loadError && <div className="text-[11px] text-zinc-500">{loadError}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-600">
        <span>
          Spørgsmål {questionNumber}/{sessionTotal}
          {currentQuestion.source === "fallback" && <span className="ml-2 italic text-zinc-400">(demo)</span>}
        </span>
        <span>
          Rigtige i denne session:{" "}
          <span className="font-medium">
            {correctCount}/{sessionTotal}
          </span>
        </span>
      </div>

      <div className="text-sm font-medium text-zinc-900">{currentQuestion.question}</div>

      <div className="space-y-2">
        {currentQuestion.options.map((opt) => {
          const isActive = selectedId === opt.id;
          const showCorrect = checked && opt.isCorrect;
          const showWrong = checked && isActive && !opt.isCorrect;

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              className={[
                "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition",
                !checked && !isActive ? "border-zinc-200 bg-white hover:border-zinc-400" : "",
                isActive && !checked ? "border-zinc-900 bg-zinc-900 text-white" : "",
                showCorrect ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "",
                showWrong ? "border-red-500 bg-red-50 text-red-900" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span>{opt.text}</span>
              {showCorrect && <span className="ml-3 text-xs font-semibold">Korrekt svar</span>}
              {showWrong && <span className="ml-3 text-xs font-semibold">Forkert svar</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {checked && correctOption ? (
            isCorrect ? (
              <>Flot – du svarede rigtigt.</>
            ) : (
              <>
                Korrekt svar: <span className="font-medium">{correctOption.text}</span>
              </>
            )
          ) : (
            <>Vælg et svar og tryk “Tjek svar”.</>
          )}
        </div>

        <div className="flex items-center gap-3">
          {saving && <span className="text-[11px] text-zinc-500">Gemmer resultat …</span>}
          {saveError && !saving && <span className="text-[11px] text-red-600">{saveError}</span>}
          {loadError && !loadingNext && (
            <span className="text-[11px] text-zinc-500">
              {loadError}
              {requestIdShown ? <span className="ml-2 text-zinc-400">RequestId: {requestIdShown}</span> : null}
            </span>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCheck}
              disabled={!selectedId || checked}
              className="rounded-full border border-zinc-900 px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              Tjek svar
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!checked || loadingNext}
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {loadingNext ? "Henter…" : questionNumber >= sessionTotal ? "Afslut" : "Næste spørgsmål"}
            </button>
          </div>
        </div>
      </div>

      {checked && currentQuestion.explanation && (
        <div className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-700">{currentQuestion.explanation}</div>
      )}

      {checked && shownSources.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="text-[11px] font-semibold tracking-wide text-zinc-500">KILDER</div>
          <div className="mt-2 space-y-1 text-xs">
            {shownSources.map((s) => {
              const href = s.url ? s.url : s.fileId ? `/traener/upload?fileId=${encodeURIComponent(s.fileId)}` : null;

              return href ? (
                <a
                  key={s.key}
                  href={href}
                  target={s.url ? "_blank" : undefined}
                  rel={s.url ? "noreferrer" : undefined}
                  className="block text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600"
                >
                  {s.title}
                </a>
              ) : (
                <div key={s.key} className="text-zinc-900">
                  {s.title}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


---
## app\traener\ui\SidebarQuotaBox.tsx

// app/traener/ui/SidebarQuotaBox.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type FeatureQuota = {
  usedThisMonth: number;
  limitPerMonth: number | null;
};

type ApiResponse = {
  ok: boolean;
  plan?: string;

  import?: FeatureQuota;
  trainer_round?: FeatureQuota;
  mc_generate?: FeatureQuota;
  flashcards_generate?: FeatureQuota;

  error?: string;
};

function asQuota(used?: number | null, limit?: number | null): FeatureQuota {
  return {
    usedThisMonth: typeof used === "number" ? used : 0,
    limitPerMonth: typeof limit === "number" ? limit : null,
  };
}

function formatLine(label: string, fq?: FeatureQuota) {
  if (!fq) return `${label}: ingen data`;
  const usedRaw = fq.usedThisMonth ?? 0;
  const limit = fq.limitPerMonth;

  const used = typeof limit === "number" && limit > 0 ? Math.min(usedRaw, limit) : usedRaw;

  if (typeof limit === "number" && limit > 0) return `${label}: ${used} af ${limit} denne måned`;
  return `${label}: ${used} denne måned`;
}

export default function SidebarQuotaBox() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const res = await fetch("/api/quota/current", {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;

      setData(json);
      if (!json.ok) setError(json.error ?? "Kunne ikke hente forbrug.");
      else setError(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("SidebarQuotaBox fetch error:", e);
      setError("Kunne ikke hente forbrug endnu.");
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    const safeLoad = async () => {
      if (cancelled) return;
      await load();
    };

    void safeLoad();

    const onQuotaChanged = () => void safeLoad();
    window.addEventListener("notely-quota-changed", onQuotaChanged);

    const onFocus = () => void safeLoad();
    window.addEventListener("focus", onFocus);

    const onVis = () => {
      if (document.visibilityState === "visible") void safeLoad();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.removeEventListener("notely-quota-changed", onQuotaChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let body: React.ReactNode = null;

  if (!data && !error) {
    body = <div className="text-[11px] text-zinc-500">Henter månedligt forbrug …</div>;
  } else if (error || !data?.ok) {
    body = <div className="text-[11px] text-red-600">{error ?? "Kunne ikke hente forbrug."}</div>;
  } else {
    const planLabel =
      data.plan === "pro"
        ? "Pro"
        : data.plan === "basis" || data.plan === "basic"
          ? "Basis"
          : data.plan === "freemium"
            ? "Freemium"
            : data.plan ?? "";

    const importQ = data.import ?? asQuota();
    const trainerRoundQ = data.trainer_round ?? asQuota();
    const mcQ = data.mc_generate ?? asQuota();
    const flashGenQ = data.flashcards_generate ?? asQuota();

    body = (
      <>
        <div className="mb-1 text-[12px] font-semibold text-zinc-800">
          Månedligt forbrug{planLabel ? ` (${planLabel})` : ""}
        </div>

        <p>{formatLine("Upload / ret materiale", importQ)}</p>
        <p>{formatLine("Træner (runder)", trainerRoundQ)}</p>
        <p>{formatLine("Multiple Choice", mcQ)}</p>
        <p>{formatLine("Flashcards (generering)", flashGenQ)}</p>
      </>
    );
  }

  return (
    <div id="notely-quota-box" className="mt-3 border-t border-zinc-200 pt-3 text-[11px] text-zinc-600">
      {body}
    </div>
  );
}


---
## app\traener\upload\ImportStatusBox.tsx

// app/traener/upload/ImportStatusBox.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LimitNotice from "@/app/traener/_ui/LimitNotice";

type ImportStatusResponse = {
  ok: boolean;

  // optional (nyere API)
  plan?: string;
  usedThisMonth?: number;
  monthlyLimit?: number | null;
  resetAt?: string | null;

  // optional (ældre/nestet)
  folderId?: string | null;
  quota?: {
    usedThisMonth: number;
    limitPerMonth: number | null;
    resetAt?: string;
    plan?: string;
  };

  files?: {
    total: number;
    hasFile: boolean;
    latest: { id: string; name: string; folder_id: string | null; updated_at: string | null } | null;
  };

  // optional (nyere “flat” helpers)
  filesTotal?: number;
  latestFile?: { name?: string; uploadedAt?: string | null; updated_at?: string | null } | null;

  error?: string;
  details?: string;
};

function n0(x: any) {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmtDa(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function prettyPlan(plan: string) {
  const p = (plan || "freemium").toLowerCase();
  if (p === "freemium") return "Freemium";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

async function safeJson(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default function ImportStatusBox(props: { folderId?: string | null; refreshMs?: number }) {
  const folderId = props.folderId ?? null;
  const refreshMs = typeof props.refreshMs === "number" ? props.refreshMs : 10_000;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ImportStatusResponse | null>(null);

  const url = useMemo(() => {
    const qs = folderId ? `folder_id=${encodeURIComponent(folderId)}` : "";
    return qs ? `/api/import-status?${qs}` : `/api/import-status`;
  }, [folderId]);

  const load = useCallback(async () => {
    try {
      setErr(null);

      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const json = (await safeJson(res)) as ImportStatusResponse | null;

      if (!res.ok || !json) {
        setData(null);
        setErr(`Kunne ikke hente status (${res.status}).`);
        return;
      }

      if (json.ok === false) {
        setData(null);
        setErr(String(json.error ?? "Kunne ikke hente status."));
        return;
      }

      setData(json);
    } catch (e) {
      console.error("[ImportStatusBox] load error", e);
      setData(null);
      setErr("Kunne ikke hente status.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    setLoading(true);
    void load();

    const onRefresh = () => void load();
    window.addEventListener("notely:import-status-refresh", onRefresh);

    const t = setInterval(() => void load(), Math.max(5000, refreshMs));

    return () => {
      window.removeEventListener("notely:import-status-refresh", onRefresh);
      clearInterval(t);
    };
  }, [load, refreshMs]);

  // ✅ robust udlæsning (nestet + flat)
  const planRaw = (data?.quota?.plan ?? data?.plan ?? "freemium").toString();
  const used = n0(data?.quota?.usedThisMonth ?? data?.usedThisMonth ?? (data as any)?.used ?? 0);
  const limit =
    (data?.quota?.limitPerMonth ?? data?.monthlyLimit ?? (data as any)?.limit ?? null) as number | null;
  const resetAt = (data?.quota?.resetAt ?? data?.resetAt ?? null) as string | null;

  const hasLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0;
  const remaining = hasLimit ? Math.max(0, (limit as number) - used) : null;

  const atOrOverLimit = hasLimit ? used >= (limit as number) : false;

  const pct = useMemo(() => {
    if (!hasLimit) return 0;
    return Math.min(1, Math.max(0, used / (limit as number)));
  }, [used, limit, hasLimit]);

  const filesTotal = n0(data?.files?.total ?? data?.filesTotal ?? 0);
  const latestName = data?.files?.latest?.name ?? data?.latestFile?.name ?? null;
  const latestAt =
    data?.files?.latest?.updated_at ?? data?.latestFile?.uploadedAt ?? data?.latestFile?.updated_at ?? null;

  // ✅ info-tekst om slet (frigiver ikke sider)
  const showDeleteWarning = true;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-zinc-900">Plan: {prettyPlan(planRaw)}</div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm font-semibold text-zinc-900">Materiale gjort klar denne måned</div>
        <div className="text-sm font-semibold text-zinc-900">
          {hasLimit ? `${used} / ${limit}` : `${used}`}
        </div>
      </div>

      <div className="mt-2 h-2 w-full rounded-full bg-zinc-100">
        <div className="h-2 rounded-full bg-zinc-900" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>

      {/* ✅ tilbage-tæller */}
      {hasLimit ? (
        <div className="mt-2 text-xs text-zinc-600">Tilbage denne måned: {remaining} sider</div>
      ) : null}

      <div className="mt-1 text-xs text-zinc-500">{resetAt ? `Nulstilles: ${fmtDa(resetAt)}` : ""}</div>

      {showDeleteWarning ? (
        <div className="mt-2 text-[11px] text-zinc-500">
          Bemærk: Hvis du sletter en fil, frigiver det ikke sider tilbage i denne måned.
          {planRaw.toLowerCase() === "freemium" ? " Freemium: maks. 10 sider pr. PDF." : ""}
        </div>
      ) : null}

      {atOrOverLimit ? (
        <LimitNotice className="mt-3">
          Grænse nået. Du kan uploade igen efter nulstilling{resetAt ? ` (${fmtDa(resetAt)})` : ""}.
        </LimitNotice>
      ) : null}

      <div className="mt-4 rounded-xl bg-zinc-50 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-900">Filer i alt</div>
          <div className="text-sm font-semibold text-zinc-900">{filesTotal}</div>
        </div>

        <div className="mt-1 text-xs text-zinc-600">
          {latestName ? (
            <>
              Senest: {latestName}
              {latestAt ? ` · ${fmtDa(latestAt)}` : ""}
            </>
          ) : (
            "Ingen filer endnu."
          )}
        </div>
      </div>

      {loading ? <div className="mt-3 text-xs text-zinc-500">Indlæser…</div> : null}
      {err ? <div className="mt-3 text-xs text-red-600">{err}</div> : null}
    </div>
  );
}


---
## app\traener\upload\QuotaStatus.tsx

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Status = {
  ok: boolean;

  plan?: string | null;

  usedThisMonth?: number | null;
  monthlyLimit?: number | null;

  // fallback hvis du havde gamle feltnavne
  used?: number | null;
  limit?: number | null;
  month?: { used?: number | null; limit?: number | null } | null;

  resetAt?: string | null;
  resetAtNice?: string | null;

  quotaReached?: boolean | null;

  filesTotal?: number | null;
  latestFile?: { name?: string | null; uploadedAt?: string | null } | null;

  error?: string | null;
};

function n0(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtDa(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function QuotaStatus() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const parseUsedLimit = useCallback((j: Status) => {
    const used =
      j.usedThisMonth ?? j.used ?? j.month?.used ?? 0;

    const limit =
      j.monthlyLimit ?? j.limit ?? j.month?.limit ?? null;

    return { used: n0(used), limit: limit == null ? null : n0(limit) };
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/import-status", { method: "GET", cache: "no-store" });

      const text = await res.text();
      const json: any = (() => {
        try { return text ? JSON.parse(text) : null; } catch { return null; }
      })();

      if (!res.ok || !json) {
        setStatus(null);
        setErr(`Kunne ikke hente status (${res.status}).`);
        return;
      }
      if (json.ok === false) {
        setStatus(json);
        setErr(String(json.error ?? "Kunne ikke hente status."));
        return;
      }

      setStatus(json);
    } catch {
      setStatus(null);
      setErr("Kunne ikke hente status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    const onEvt = () => void load();
    window.addEventListener("notely:import-status-refresh", onEvt);
    window.addEventListener("notely-quota-changed", onEvt);
    return () => {
      clearInterval(t);
      window.removeEventListener("notely:import-status-refresh", onEvt);
      window.removeEventListener("notely-quota-changed", onEvt);
    };
  }, [load]);

  const { used, limit } = useMemo(() => parseUsedLimit(status ?? { ok: false }), [status, parseUsedLimit]);

  const pct = useMemo(() => {
    if (!limit || limit <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
  }, [used, limit]);

  const plan = (status?.plan ?? "Freemium").toString();
  const resetNice = status?.resetAtNice ?? (status?.resetAt ? fmtDa(status.resetAt) : "");

  const quotaReached =
    typeof status?.quotaReached === "boolean"
      ? status!.quotaReached
      : (limit != null && limit > 0 ? used >= limit : false);

  const latestName = status?.latestFile?.name ?? null;
  const latestAt = status?.latestFile?.uploadedAt ?? null;
  const filesTotal = status?.filesTotal ?? 0;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-zinc-900">Plan: {plan}</div>

      <div className="mt-4 text-sm font-semibold text-zinc-900">Materiale gjort klar denne måned</div>

      <div className="mt-1 flex items-center justify-between text-sm text-zinc-700">
        <div />
        <div className="font-medium">
          {limit != null ? `${used} / ${limit}` : `${used}`}
        </div>
      </div>

      <div className="mt-2 h-2 w-full rounded-full bg-zinc-100">
        <div className="h-2 rounded-full bg-zinc-900" style={{ width: `${pct}%` }} />
      </div>

      {resetNice ? <div className="mt-2 text-xs text-zinc-500">Nulstilles: {resetNice}</div> : null}

      {quotaReached ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
          Grænse nået. Du kan uploade igen efter nulstilling ({resetNice || "snart"}).
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-900">Filer i alt</div>
          <div className="text-sm font-semibold text-zinc-900">{n0(filesTotal)}</div>
        </div>
        <div className="mt-1 text-xs text-zinc-600">
          {latestName ? (
            <>Senest: {latestName}{latestAt ? ` · ${fmtDa(latestAt)}` : ""}</>
          ) : (
            <>Ingen filer endnu.</>
          )}
        </div>
      </div>

      {loading ? null : err ? <div className="mt-3 text-xs text-red-600">{err}</div> : null}
    </div>
  );
}


---
## app\traener\ux\ClientTrainer.tsx

// app/traener/ux/ClientTrainer.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LimitNotice from "../_ui/LimitNotice";

type Folder = { id: string; name: string };

type Props = {
  ownerId?: string;
  activeFolderId?: string | null;
  folders?: Folder[];
  scopeFolderIds?: string[];

  folderId?: string | null;
  folderName?: string | null;
  noteId?: string | null;
  selectedNoteTitle?: string | null;
};

type Citation = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type EvalResult = {
  feedback: string;
  score: number | null;
  citations: Citation[];
  usedFileId: string | null;
};

type CitationObj = {
  chunkId?: string;
  id?: string;
  fileId?: string | null;
  file_id?: string | null;
  title?: string | null;
  url?: string | null;
};

function clampScore(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];

  for (const c of citations) {
    const key = [
      (c.title ?? "").trim().toLowerCase(),
      (c.url ?? "").trim().toLowerCase(),
      (c.fileId ?? "").trim().toLowerCase(),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }

  return out;
}

function normalizeCitations(input: unknown): Citation[] {
  if (!input) return [];

  if (Array.isArray(input) && input.every((x) => typeof x === "string")) {
    const out: Citation[] = (input as string[])
      .map((s, i) => {
        const t = String(s ?? "").trim();
        if (!t) return null;
        return { chunkId: `legacy-${i}`, fileId: null, title: t, url: null };
      })
      .filter(Boolean) as Citation[];

    return dedupeCitations(out);
  }

  if (Array.isArray(input)) {
    const out: Citation[] = [];
    for (const x of input) {
      if (!x || typeof x !== "object") continue;
      const obj = x as CitationObj;

      const chunkId = String(obj.chunkId ?? obj.id ?? "").trim();
      const fileIdRaw = obj.fileId ?? obj.file_id ?? null;
      const fileId = fileIdRaw ? String(fileIdRaw).trim() : null;

      const title = obj.title != null && String(obj.title).trim() ? String(obj.title).trim() : null;
      const url = obj.url != null && String(obj.url).trim() ? String(obj.url).trim() : null;

      if (!chunkId && !title && !url && !fileId) continue;

      out.push({
        chunkId: chunkId || `c-${out.length}`,
        fileId,
        title,
        url,
      });
    }

    return dedupeCitations(out);
  }

  return [];
}

function citationLabel(c: Citation, i: number) {
  return c.title || c.url || `Kilde ${i + 1}`;
}

async function readJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
}

function clampInt(n: any, min: number, max: number) {
  const x = Number.isFinite(Number(n)) ? Math.round(Number(n)) : min;
  return Math.min(max, Math.max(min, x));
}

function pickTrainerQuota(json: any): { used: number; limit: number | null } {
  const used =
    (typeof json?.trainer_round?.usedThisMonth === "number" ? json.trainer_round.usedThisMonth : null) ??
    (typeof json?.trainer_round?.used_this_month === "number" ? json.trainer_round.used_this_month : null) ??
    (typeof json?.trainerUsedThisMonth === "number" ? json.trainerUsedThisMonth : null) ??
    0;

  const limit =
    (typeof json?.trainer_round?.limitPerMonth === "number" ? json.trainer_round.limitPerMonth : null) ??
    (typeof json?.trainer_round?.limit_per_month === "number" ? json.trainer_round.limit_per_month : null) ??
    (typeof json?.trainerLimitPerMonth === "number" ? json.trainerLimitPerMonth : null) ??
    (typeof json?.trainer_round?.monthlyLimit === "number" ? json.trainer_round.monthlyLimit : null) ??
    null;

  return { used: clampInt(used, 0, 1_000_000), limit: typeof limit === "number" ? clampInt(limit, 0, 1_000_000) : null };
}

export default function ClientTrainer({
  ownerId,
  activeFolderId,
  folders,
  scopeFolderIds,
  folderId,
  folderName,
  noteId,
  selectedNoteTitle,
}: Props) {
  void ownerId;

  const router = useRouter();

  const effectiveFolderId = folderId ?? activeFolderId ?? null;

  const effectiveFolderName =
    folderName ??
    (effectiveFolderId ? folders?.find((f) => f.id === effectiveFolderId)?.name ?? null : null);

  const scopeNames =
    scopeFolderIds && folders ? folders.filter((f) => scopeFolderIds.includes(f.id)).map((f) => f.name) : [];

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const includeBackground = true;

  const [questionFileId, setQuestionFileId] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);

  // ✅ runde-id (betales på generate)
  const [roundId, setRoundId] = useState<string | null>(null);

  // ✅ “Tilpas / Færdig”
  const [questionEditable, setQuestionEditable] = useState(false);

  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [loadingEval, setLoadingEval] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const [noteSavedMsg, setNoteSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ✅ quota state som MC: vis med det samme + disable knap
  const [limitReached, setLimitReached] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  const clearMessages = () => {
    setErrorMsg(null);
    setNoteSavedMsg(null);
  };

  const scopeLabel = (() => {
    if (noteId) {
      return selectedNoteTitle ? `Udvalgt materiale: ${selectedNoteTitle}` : "Udvalgt materiale i mappen";
    }

    if (scopeNames.length > 1) {
      const preview = scopeNames.length <= 3 ? scopeNames.join(", ") : `${scopeNames.slice(0, 3).join(", ")} m.fl.`;
      return `Flere mapper: ${preview}`;
    }

    if (scopeNames.length === 1) return `Hele mappen: ${scopeNames[0]}`;
    if (effectiveFolderName) return `Hele mappen: ${effectiveFolderName}`;

    return "Vælg en mappe eller et materiale i venstre side.";
  })();

  const dispatchQuotaChanged = () => {
    try {
      window.dispatchEvent(new Event("notely-quota-changed"));
    } catch {
      // ignore
    }
  };

  const checkQuotaNow = useMemo(() => {
    return async () => {
      try {
        const res = await fetch("/api/quota/current", { method: "GET", cache: "no-store" });
        if (!res.ok) return;

        const json = await readJsonSafe(res).catch(() => null);
        if (!json?.ok) return;

        const { used, limit } = pickTrainerQuota(json);
        if (typeof limit === "number" && limit > 0 && used >= limit) {
          setLimitReached(true);
          setLimitMessage(null);
        } else {
          setLimitReached(false);
          setLimitMessage(null);
        }
      } catch {
        // fail-open
      }
    };
  }, []);

  // ✅ ved load + når sidebar siger quota ændret
  useEffect(() => {
    let alive = true;

    void (async () => {
      if (!alive) return;
      await checkQuotaNow();
    })();

    const onQuota = () => void checkQuotaNow();
    window.addEventListener("notely-quota-changed", onQuota);
    return () => {
      alive = false;
      window.removeEventListener("notely-quota-changed", onQuota);
    };
  }, [checkQuotaNow]);

  const handleGenerateQuestion = async () => {
    clearMessages();

    if (limitReached) return;

    setLoadingQuestion(true);

    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: effectiveFolderId ?? null,
          scopeFolderIds: scopeFolderIds ?? [],
          roundId,
        }),
      });

      const data = await res.json().catch(() => null);

      // ✅ quota / limit: vis grå boks (ikke rød error bar)
      if (res.status === 402 || res.status === 429) {
        setLimitReached(true);
        setLimitMessage(String((data as any)?.error ?? "").trim() || null);
        dispatchQuotaChanged();
        router.refresh();
        return;
      }

      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke generere spørgsmål";
        throw new Error(msg);
      }

      const q =
        (data as any)?.question ||
        (data as any)?.prompt ||
        "Formulér et kort eksamensspørgsmål inden for dette emne.";

      const usedFileId = (data as any)?.usedFileId ? String((data as any).usedFileId) : null;
      const newRoundId = (data as any)?.roundId ? String((data as any).roundId) : null;

      setQuestion(String(q));
      setQuestionEditable(false);
      setAnswer("");
      setEvalResult(null);

      setQuestionFileId(usedFileId);
      setRoundId(newRoundId);

      // generate koster -> opdatér quota UI
      dispatchQuotaChanged();
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved generering af spørgsmål.");
    } finally {
      setLoadingQuestion(false);
    }
  };

  const handleEvaluate = async () => {
    clearMessages();

    if (!question || !answer.trim()) {
      setErrorMsg("Udfyld både spørgsmål og svar før du evaluerer.");
      return;
    }

    if (!roundId) {
      setErrorMsg("Tryk “Generér nyt spørgsmål” først for at starte en runde.");
      return;
    }

    setLoadingEval(true);

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: question, // legacy
          question,
          answer,
          includeBackground,
          folder_id: effectiveFolderId ?? null,
          note_id: noteId ?? null,
          scopeFolderIds: scopeFolderIds ?? [],
          source_type: "trainer",

          round_id: roundId,
          file_id: questionFileId ?? null,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke evaluere (tomt svar fra server).";
        throw new Error(msg);
      }

      const score = clampScore((data as any).score ?? (data as any).grade);
      const feedback = String((data as any).feedback ?? (data as any).evaluation ?? "").trim();

      const citations = normalizeCitations((data as any).citations ?? (data as any).sources ?? []);
      const usedFileId = (data as any).usedFileId ? String((data as any).usedFileId) : null;

      setEvalResult({
        feedback: feedback || "Ingen feedback (tomt svar).",
        score,
        citations,
        usedFileId,
      });

      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved evaluering.");
    } finally {
      setLoadingEval(false);
    }
  };

  const handleSaveNote = async () => {
    clearMessages();

    if (!question && !answer && !evalResult?.feedback) {
      setErrorMsg("Der er intet at gemme som note endnu.");
      return;
    }

    setSavingNote(true);

    try {
      const baseTitle = effectiveFolderName ? `${effectiveFolderName} – træner` : "Træner";

      const title =
        noteId && selectedNoteTitle
          ? `${baseTitle}: ${selectedNoteTitle}`
          : `${baseTitle}: ${question ? question.replace(/\s+/g, " ").slice(0, 80) : "Øvelse"}`;

      const citationsLines =
        evalResult?.citations?.length
          ? dedupeCitations(evalResult.citations).map((c, idx) => {
              const label = citationLabel(c, idx);
              return c.url ? `- ${label} (${c.url})` : `- ${label}`;
            })
          : [];

      const contentLines = [
        question ? `**Spørgsmål**\n${question}` : "",
        answer ? `\n\n**Svar**\n${answer}` : "",
        evalResult?.score != null ? `\n\n**Score**: ${evalResult.score}/100` : "",
        evalResult?.feedback ? `\n\n**Feedback**\n${evalResult.feedback}` : "",
        citationsLines.length ? `\n\n**Kilder**\n${citationsLines.join("\n")}` : "",
      ].filter(Boolean);

      const content = contentLines.join("");

      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          source_title: "Træner",
          source_url: "/traener",
          folder_id: effectiveFolderId ?? null,
          note_type: "trainer_feedback",
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke gemme note";
        throw new Error(msg);
      }

      setNoteSavedMsg("Note gemt.");
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved gem som note.");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Valgt emne</h2>
        <p className="text-xs text-zinc-600">Træn på hele mapper eller udvalgte noter/materialer fra venstre side.</p>
        <p className="mt-1 text-xs text-zinc-500">{scopeLabel}</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Spørgsmål / øvelse</h3>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuestionEditable((v) => !v)}
              disabled={!question}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              title="Lås op for redigering af spørgsmålet"
            >
              {questionEditable ? "Færdig" : "Tilpas"}
            </button>

            {/* ✅ knappen er der altid, men bliver grå når limit er nået */}
            <button
              type="button"
              onClick={handleGenerateQuestion}
              disabled={loadingQuestion || limitReached}
              className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
            >
              {loadingQuestion ? "Genererer..." : "Generér nyt spørgsmål"}
            </button>
          </div>
        </div>

        {limitReached ? <LimitNotice feature="trainer_round" message={limitMessage} /> : null}

        <textarea
          readOnly={!questionEditable}
          className="mt-1 w-full min-h-[96px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5 read-only:bg-zinc-50"
          value={question}
          onChange={(e) => {
            clearMessages();
            setQuestion(e.target.value);
          }}
          placeholder="Tryk “Generér nyt spørgsmål” for at starte."
        />

        <p className="text-[10px] text-zinc-500">Du kan tilpasse spørgsmålet til det stof, du vil træne.</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Dit svar / 100</h3>
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={loadingEval}
            className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
          >
            {loadingEval ? "Evaluerer..." : "Evaluer svar"}
          </button>
        </div>

        <textarea
          className="mt-1 w-full min-h-[140px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5"
          value={answer}
          onChange={(e) => {
            clearMessages();
            setAnswer(e.target.value);
          }}
          placeholder="Skriv dit svar her..."
        />
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Feedback</h3>
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={savingNote}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-60"
          >
            {savingNote ? "Gemmer..." : "Gem som note"}
          </button>
        </div>

        <div className="text-xs text-zinc-600">
          {evalResult ? (
            <>
              <div className="font-medium">Score: {evalResult.score ?? 0}/100</div>
              <p className="mt-1 whitespace-pre-wrap">{evalResult.feedback}</p>

              {evalResult.citations.length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-500">
                  <div className="font-semibold text-zinc-600">Baggrundslitteratur / kilder</div>
                  <ul className="mt-1 space-y-0.5">
                    {dedupeCitations(evalResult.citations).map((c, idx) => {
                      const label = citationLabel(c, idx);
                      return (
                        <li key={c.chunkId || `${c.fileId ?? "file"}-${idx}`} className="break-all">
                          {c.url ? (
                            <a className="underline" href={c.url} target="_blank" rel="noreferrer">
                              {label}
                            </a>
                          ) : (
                            <span>{label}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>Ingen feedback endnu. Skriv dit svar og tryk &quot;Evaluer svar&quot;.</p>
          )}
        </div>
      </section>

      {noteSavedMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {noteSavedMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}
    </div>
  );
}


---
## C:\Projects\ai-studiepakke\notely-v2\supabase\migrations\20251117193000_add_source_type_folder_to_exam_sessions.sql

-- Tilføj kilde-type og mappe-reference til exam_sessions
alter table public.exam_sessions
  add column if not exists source_type text,
  add column if not exists folder_id uuid;

-- (Valgfri, men god til Overblik-siden senere)
create index if not exists exam_sessions_owner_source_created_idx
  on public.exam_sessions (owner_id, source_type, created_at desc);


---
## lib\quota.ts

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

