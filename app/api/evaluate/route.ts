// app/api/evaluate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";
import { ensureQuotaAndDecrement } from "@/lib/quota";
import { requireFlowModel, type NotelyFlow } from "@/lib/openai/requireModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TRAINER_EVALS_PER_OWNER = 50;

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
};

type EvalJson = {
  score?: number | string;
  overall?: string;
  strengths?: unknown;
  improvements?: unknown;
  next_steps?: unknown;
};

function ensureStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    const out = value
      .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
      .filter(Boolean);
    return out;
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

/**
 * Byg kontekst til evaluering.
 *
 * Prioritet:
 * 1) Hvis body.file_id/fileId → brug KUN doc_chunks fra den fil.
 * 2) Ellers: vælg ÉN tilfældig fil i scope (seneste 5 filer i mapperne)
 *    og brug kun dens doc_chunks.
 * 3) Fallback: ingen kontekst → tom streng.
 */
async function buildContextForEvaluation(opts: {
  sb: any;
  ownerId: string;
  body: Partial<EvalRequest>;
  maxChars?: number;
}): Promise<{ contextText: string; usedFileId: string | null; chunkCount: number }> {
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
  const explicitFileId =
    typeof fileRaw === "string" && fileRaw.trim().length > 0 ? fileRaw.trim() : null;

  const scopeFolderIds: string[] = Array.isArray(body.scopeFolderIds)
    ? body.scopeFolderIds
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
    : [];

  const fallbackFolder =
    typeof body.folder_id === "string" && body.folder_id.trim().length > 0
      ? body.folder_id.trim()
      : null;

  const effectiveFolderIds: string[] =
    scopeFolderIds.length > 0 ? scopeFolderIds : fallbackFolder ? [fallbackFolder] : [];

  async function buildFromFileId(fileId: string): Promise<{ text: string; chunkCount: number }> {
    const { data: chunks, error } = await sb
      .from("doc_chunks")
      .select("id, content, file_id, folder_id, created_at")
      .eq("owner_id", ownerId)
      .eq("file_id", fileId)
      .order("created_at", { ascending: true })
      .limit(80);

    if (error) {
      console.error("[evaluate] doc_chunks error (file):", error);
      return { text: "", chunkCount: 0 };
    }

    const rows: ChunkRow[] = (chunks ?? []) as ChunkRow[];
    const nonEmpty = rows.map((r) => (r.content ?? "").trim()).filter(Boolean);

    if (!nonEmpty.length) return { text: "", chunkCount: 0 };

    let text = nonEmpty.join("\n\n---\n\n");
    if (text.length > maxChars) text = text.slice(0, maxChars);

    return { text, chunkCount: nonEmpty.length };
  }

  if (explicitFileId) {
    const r = await buildFromFileId(explicitFileId);
    return { contextText: r.text, usedFileId: explicitFileId, chunkCount: r.chunkCount };
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

  // fallback: hvis scope var tomt og der ikke kom filer tilbage, så prøv alle filer
  if (!filesInScope.length && effectiveFolderIds.length > 0) {
    const { data: allFiles, error: allFilesErr } = await sb
      .from("files")
      .select("id, name, original_name, folder_id, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });

    if (allFilesErr) console.error("[evaluate] global files error:", allFilesErr);
    filesInScope = (allFiles ?? []) as FileRow[];
  }

  if (!filesInScope.length) return { contextText: "", usedFileId: null, chunkCount: 0 };

  const recentFiles = filesInScope.slice(0, Math.min(filesInScope.length, 5));
  const idx = Math.floor(Math.random() * recentFiles.length);
  const chosenFile = recentFiles[idx];

  const r = await buildFromFileId(String(chosenFile.id));
  return { contextText: r.text, usedFileId: String(chosenFile.id), chunkCount: r.chunkCount };
}

async function pruneTrainerHistory(sb: any, ownerId: string) {
  // Hent kun “det der ligger ud over grænsen” (effektivt)
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

  const { error: delError } = await sb
    .from("exam_sessions")
    .delete()
    .eq("owner_id", ownerId)
    .in("id", idsToDelete);

  if (delError) console.error("[evaluate] prune delete error:", delError);
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody<Partial<EvalRequest>>(req);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const body = parsed.value ?? {};

    const question = String(body.question ?? "").trim();
    const answer = String(body.answer ?? "").trim();
    if (!question || !answer) {
      return NextResponse.json({ ok: false, error: "Mangler question eller answer" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY (required)" }, { status: 500 });
    }

    // Auth/dev-bypass (samme som dine andre routes)
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
      if (!isAuth) console.error("[evaluate] requireUser crash:", e);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Flow
    const flowRaw = (body.source_type ?? body.sourceType) as NotelyFlow | undefined;
    const flow: NotelyFlow = flowRaw === "simulator" || flowRaw === "oral" ? flowRaw : "trainer";

    // Model for flow
    let model: string;
    try {
      model = requireFlowModel(flow);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? "Missing model env" }, { status: 500 });
    }

    // Quota-check for EVALUATE
    {
      const cost = 1;
      const quota = await ensureQuotaAndDecrement(ownerId, "evaluate", cost);
      if (!quota.ok) {
        console.warn("[/api/evaluate] quota exceeded:", quota.message);
        return NextResponse.json({ ok: false, error: quota.message, feature: "evaluate" }, { status: quota.status });
      }
    }

    const includeBackground = !!body.includeBackground;

    // Kontekst (kun hvis includeBackground)
    let contextText = "";
    let usedFileId: string | null = null;
    let contextChunkCount = 0;

    if (includeBackground) {
      const ctx = await buildContextForEvaluation({ sb, ownerId, body, maxChars: 8000 });
      contextText = ctx.contextText;
      usedFileId = ctx.usedFileId;
      contextChunkCount = ctx.chunkCount;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const systemPrompt = `
Du er dansk eksamenscensor.

Du får:
- et eksamensspørgsmål ("question"),
- et elevsvar ("answer"),
- og evt. baggrundsmateriale ("context") fra elevens eget pensum.

Hvis "context" er tomt, skal du vurdere ud fra almindelige faglige kriterier og spørgmålet.

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

    const scoreRaw =
      typeof parsedEval.score === "number" ? parsedEval.score : Number(parsedEval.score);
    const score = Number.isFinite(scoreRaw)
      ? Math.max(0, Math.min(100, Math.round(scoreRaw)))
      : 0;

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

    // Gem i exam_sessions
    const folderId =
      typeof body.folder_id === "string" && body.folder_id.trim() ? body.folder_id.trim() : null;

    const noteId =
      typeof body.note_id === "string" && body.note_id.trim() ? body.note_id.trim() : null;

    const scopeFolderIds = Array.isArray(body.scopeFolderIds)
      ? body.scopeFolderIds
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
      : [];

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
        mode, // auth|dev
      },
    };

    const { error: insertError } = await sb.from("exam_sessions").insert(insertPayload);
    if (insertError) console.error("[evaluate] insert exam_sessions fejl:", insertError);

    // Autoprune kun for trainer
    if (!insertError && flow === "trainer") {
      void pruneTrainerHistory(sb, ownerId);
    }

    return NextResponse.json(
      {
        ok: true,
        score,
        feedback: feedbackText,
        // (vi viser ikke kilder i svaret som standard)
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("EVALUATE /api/evaluate error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Intern fejl i evalueringen" },
      { status: 500 },
    );
  }
}
