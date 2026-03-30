// app/api/evaluate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { ensureQuotaAndDecrement } from "@/lib/quota";
import { enforceRateLimit } from "@/lib/rateLimit";
import { type NotelyFlow } from "@/lib/openai/requireModel";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { resolveModelForFeature } from "@/lib/openai/model";
import { quotaTryConsume, supabaseAdminOrNull } from "@/lib/quota/rpc";
import { rankChunksForPrompt } from "@/lib/retrieval/structureAware";
import { buildTrainerFeedbackText } from "@/lib/trainer/feedback";
import { scopeKeyFromFolderIds } from "@/lib/trainer/generate-question";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { trackProductEvent } from "@/lib/server/trackProductEvent";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

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
  weak_points?: unknown;
  weakPoints?: unknown;
  meta?: { weak_points?: unknown; weakPoints?: unknown } | null;
  metadata?: { weak_points?: unknown; weakPoints?: unknown } | null;
  feedback_meta?: { weak_points?: unknown; weakPoints?: unknown } | null;
  evaluation_meta?: { weak_points?: unknown; weakPoints?: unknown } | null;
  feedback_structured?: { weak_points?: unknown; weakPoints?: unknown } | null;
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

type WeakPoint = {
  key: string;
  label: string;
  action?: string;
};

function normalizeWeakPoints(value: unknown): WeakPoint[] {
  if (!Array.isArray(value)) return [];

  const out: WeakPoint[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item === "string") {
      const label = item.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label });
      continue;
    }

    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const rawKey = String(obj.key ?? "").trim().toLowerCase();
    const rawLabel = String(obj.label ?? obj.text ?? obj.key ?? "").trim();
    const rawAction = String(obj.action ?? "").trim();
    const key = rawKey || rawLabel.toLowerCase();
    const label = rawLabel || rawKey;
    if (!key || !label) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rawAction ? { key, label, action: rawAction } : { key, label });
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
  usedFolderId: string | null;
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
    extraction_method?: string | null;
    extraction_quality?: string | null;
    page_from?: number | null;
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
    folderId: string | null;
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
      .select("id, content, file_id, folder_id, created_at, extraction_method, extraction_quality, page_from")
      .eq("owner_id", ownerId)
      .eq("file_id", fileId)
      .order("created_at", { ascending: true })
      .limit(80);

    if (error) {
      console.error("[evaluate] doc_chunks error (file):", error);
      return { text: "", folderId: (fileRow as any)?.folder_id ?? null, chunkCount: 0, citations: [] };
    }

    const rows: ChunkRow[] = (chunks ?? []) as ChunkRow[];
    const nonEmptyRows = rows.filter((r) => (r.content ?? "").trim().length > 0);
    const nonEmpty = nonEmptyRows.map((r) => (r.content ?? "").trim());

    if (!nonEmpty.length) return { text: "", folderId: (fileRow as any)?.folder_id ?? null, chunkCount: 0, citations: [] };

    const rankedRows = rankChunksForPrompt(nonEmptyRows, `${body.question ?? ""} ${body.answer ?? ""}`)
      .slice(0, Math.min(nonEmptyRows.length, 18))
      .map((r) => r.chunk)
      .sort((a, b) => (Date.parse(String(a.created_at ?? "0")) || 0) - (Date.parse(String(b.created_at ?? "0")) || 0));

    let text = rankedRows.map((r) => (r.content ?? "").trim()).join("\n\n---\n\n");
    if (text.length > maxChars) text = text.slice(0, maxChars);

    const firstChunkId = String(rankedRows[0]?.id ?? fileId);
    const citations: Citation[] = [
      {
        chunkId: firstChunkId,
        fileId,
        title,
        url: null,
      },
    ];

    return { text, folderId: (fileRow as any)?.folder_id ?? null, chunkCount: rankedRows.length, citations };
  }

  if (explicitFileId) {
    const r = await buildFromFileId(explicitFileId);
    return {
      contextText: r.text,
      usedFileId: explicitFileId,
      usedFolderId: r.folderId,
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

  if (!filesInScope.length) return { contextText: "", usedFileId: null, usedFolderId: null, chunkCount: 0, citations: [] };

  const recentFiles = filesInScope.slice(0, Math.min(filesInScope.length, 5));
  const idx = Math.floor(Math.random() * recentFiles.length);
  const chosenFile = recentFiles[idx];

  const r = await buildFromFileId(String(chosenFile.id));
  return {
    contextText: r.text,
    usedFileId: String(chosenFile.id),
    usedFolderId: r.folderId ?? (chosenFile.folder_id ?? null),
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
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
  const hasCookieHeader = cookieNames.length > 0;
  const hasSbAuthCookie = cookieNames.some((name) => name.includes("auth-token"));
  const hasVercelJwtCookie = cookieNames.some(
    (name) => name.toLowerCase().includes("vercel") && name.toLowerCase().includes("jwt"),
  );

  try {
    const parsed = await readJsonBody<Partial<EvalRequest>>(req);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    const body = parsed.value ?? {};
    const question = String((body as any).question ?? (body as any).prompt ?? "").trim();
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

    const sessionFolderIds = scopeFolderIds.length > 0 ? scopeFolderIds : folderId ? [folderId] : [];
    const sessionFolderId = sessionFolderIds.length === 1 ? sessionFolderIds[0] : null;
    const sessionFolderIdsMeta = sessionFolderIds.length > 1 ? sessionFolderIds : undefined;

    const flow: NotelyFlow = pickFlow(body);
const roundId = pickRoundId(body);

const includeBackgroundClient = !!body.includeBackground;
const includeBackground = flow === "trainer" ? true : includeBackgroundClient;

    // Auth: session først, getUser kun som fallback
    let mode: "auth" | "dev" = "auth";
    try {
      sb = await supabaseServerRoute();
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

      let userId = sessionUserId;
      let getUserError: string | null = null;

      if (!userId) {
        const { data: authData, error: authError } = await sb.auth.getUser();
        getUserError = authError?.message ?? null;
        userId = authData?.user?.id ? String(authData.user.id) : null;
      }

      if (!userId) {
        return NextResponse.json(
          {
            ok: false,
            error: "Unauthorized",
            ...(process.env.VERCEL_ENV === "preview"
              ? {
                  debug: {
                    vercelEnv: process.env.VERCEL_ENV ?? null,
                    hasCookieHeader,
                    cookieNames,
                    hasSbAuthCookie,
                    hasVercelJwtCookie,
                    hasSession: !!sessionData?.session,
                    sessionUserId,
                    sessionError: sessionError?.message ?? null,
                    getUserError,
                    userId,
                  },
                }
              : {}),
          },
          { status: 401 },
        );
      }

      ownerId = userId;
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
      console.error("[evaluate] auth crash:", e);
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
          ...(process.env.VERCEL_ENV === "preview"
            ? {
                debug: {
                  vercelEnv: process.env.VERCEL_ENV ?? null,
                  hasCookieHeader,
                  cookieNames,
                  hasSbAuthCookie,
                  hasVercelJwtCookie,
                  hasSession: false,
                  sessionUserId: null,
                  sessionError: e?.message ?? null,
                  getUserError: e?.message ?? null,
                  userId: null,
                },
              }
            : {}),
        },
        { status: 401 },
      );
    }

    const profileAdmin = supabaseAdminOrNull();
    if (profileAdmin) {
      try {
        await ensureProfile(profileAdmin, ownerId);
      } catch (profileError) {
        console.warn("[evaluate] ensureProfile warning:", profileError);
      }
    } else {
      console.warn("[evaluate] ensureProfile skipped: missing service-role client");
    }
	
	    let model: string;
    try {
      model =
        flow === "trainer" || flow === "simulator"
          ? resolveModelForFeature("weakness")
          : resolveModelForFeature(flow);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? "Missing model env" }, { status: 500 });
    }

    // ✅ Trainer-runde gating (2 evals pr. runde) + ingen evaluate-quota for trainer
    let trainerRoundMeta: any = null;
    let shouldConsumeTrainerRound = false;
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

      shouldConsumeTrainerRound = evalsUsed === 0;
      if (shouldConsumeTrainerRound) {
        const quotaAdmin = supabaseAdminOrNull();
        if (!quotaAdmin) {
          return NextResponse.json(
            { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kræves til quota)." },
            { status: 500 },
          );
        }

        const quotaConsume = await quotaTryConsume({
          admin: quotaAdmin,
          ownerId,
          feature: "trainer_round",
          amount: 1,
          exceededMessage: "Du har nået din grænse for Træner-runder denne måned.",
        });

        if (!quotaConsume.ok) {
          if (quotaConsume.status === 503) {
            console.error("[evaluate] quota_try_consume error:", quotaConsume.raw);
          }
          return NextResponse.json(
            {
              ok: false,
              error: quotaConsume.message,
              code: quotaConsume.status === 429 ? "QUOTA_EXCEEDED" : "QUOTA_CHECK_FAILED",
              feature: "trainer_round",
              usedThisMonth: quotaConsume.used,
              monthlyLimit: quotaConsume.limitPerMonth,
              resetAt: quotaConsume.resetAt,
            },
            { status: quotaConsume.status },
          );
        }
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
          folder_id: sessionFolderId,
          file_id: null,
          meta: {
            flow,
            includeBackground,
            scopeFolderIds,
            ...(sessionFolderIdsMeta ? { folder_ids: sessionFolderIdsMeta } : {}),
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
    let usedFolderId: string | null = null;
    let contextChunkCount = 0;
    let citations: Citation[] = [];

    if (includeBackground) {
      const ctx = await buildContextForEvaluation({ sb, ownerId, body, maxChars: 8000 });
      contextText = ctx.contextText;
      usedFileId = ctx.usedFileId;
      usedFolderId = ctx.usedFolderId;
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
                ...(sessionFolderIdsMeta ? { folder_ids: sessionFolderIdsMeta } : {}),
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
  "next_steps": string[],
  "weak_points": [{ "key": string, "label": string, "action"?: string }]
}

Felter "strengths", "improvements" og "next_steps" SKAL indeholde mindst ét element.
Feltet "weak_points" SKAL altid være et array (kan være tomt).
Ingen tekst uden for JSON-objektet.
`.trim();

    const userPayload = { question, answer, context: contextText };

    const { completion } = await createChatCompletion(openai, {
      feature: flow === "trainer" || flow === "simulator" ? "weakness" : flow,
      purpose: "json",
      modelOverride: model,
      payload: {
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      },
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
    const weakPointsRaw =
      parsedEval.weak_points ??
      parsedEval.weakPoints ??
      parsedEval.meta?.weak_points ??
      parsedEval.meta?.weakPoints ??
      parsedEval.metadata?.weak_points ??
      parsedEval.metadata?.weakPoints ??
      parsedEval.feedback_meta?.weak_points ??
      parsedEval.feedback_meta?.weakPoints ??
      parsedEval.evaluation_meta?.weak_points ??
      parsedEval.evaluation_meta?.weakPoints ??
      parsedEval.feedback_structured?.weak_points ??
      parsedEval.feedback_structured?.weakPoints;
    const normalizedWeakPoints = normalizeWeakPoints(weakPointsRaw);

    if (!strengths.length) strengths = ["Du rammer noget af kernen, men kan blive mere præcis."];
    if (!improvements.length) improvements = ["Uddyb centrale begreber og knyt dem tydeligere til spørgsmålet."];
    if (!nextSteps.length) nextSteps = ["Skriv et forbedret svar, hvor du bruger 2–3 nøglebegreber og et konkret eksempel."];

    const feedbackText = buildTrainerFeedbackText({
      overall,
      strengths,
      improvements,
      nextSteps,
    });

    // ✅ bump evals_used på runden (LLM-kald er gennemført)
    if (flow === "trainer" && roundId) {
      const baseMeta = trainerRoundMeta ?? {};
      await bumpTrainerRoundEval(sb, ownerId, roundId, baseMeta);
    }

    const sessionMeta = {
      includeBackground,
      scopeFolderIds,
      ...(sessionFolderIdsMeta ? { folder_ids: sessionFolderIdsMeta } : {}),
      note_id: noteId,
      file_id: usedFileId,
      contextChunkCount,
      contextPreview: contextText ? contextText.slice(0, 400) : null,
      citations,
      mode,
      round_id: flow === "trainer" ? roundId : null,
      weak_points: normalizedWeakPoints,
    };

    const resolvedTrackingFolderId = usedFolderId ?? sessionFolderId;
    const resolvedTrackingScopeIds =
      scopeFolderIds.length > 0 ? scopeFolderIds : resolvedTrackingFolderId ? [resolvedTrackingFolderId] : [];
    const resolvedTrackingScope = resolvedTrackingScopeIds.length > 0 ? scopeKeyFromFolderIds(resolvedTrackingScopeIds) : null;

    const insertPayload = {
      owner_id: ownerId,
      question,
      answer,
      feedback: feedbackText,
      score,
      folder_id: sessionFolderId,
      source_type: flow,
      meta: sessionMeta,
      metadata: sessionMeta,
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

    if (flow === "trainer") {
      await trackProductEvent({
        ownerId,
        eventName: "trainer_answer_evaluated",
        metadata: {
          source: "own",
          folder_id: resolvedTrackingFolderId,
          file_id: usedFileId,
          scope: resolvedTrackingScope,
          feature: "trainer",
        },
      });
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
