// app/api/evaluate/route.ts
import "server-only";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { ensureQuotaAndDecrement } from "@/lib/quota";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_TRAINER_EVALS_PER_OWNER = 50;

type EvalRequest = {
  question: string;
  answer: string;
  includeBackground?: boolean;
  folder_id?: string | null;
  note_id?: string | null;
  /** Mapper fra venstre side / scope-tjekbokse */
  scopeFolderIds?: string[];
  /** Valgfrit: specifik kilde-fil til kontekst (kommer senere fra Træner-UI) */
  file_id?: string | null;
  fileId?: string | null;
};

type EvalJson = {
  score?: number;
  overall?: string;
  strengths?: string[] | string;
  improvements?: string[] | string;
  next_steps?: string[] | string;
};

function ensureArray(value: string[] | string | undefined | null): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // lokal dev → fallback
  }
  return process.env.DEV_USER_ID ?? null;
}

/**
 * Byg kontekst til evaluering.
 *
 * Prioritet:
 * 1) Hvis body.file_id/fileId → brug KUN doc_chunks fra den fil.
 * 2) Ellers: vælg ÉN tilfældig fil i scope (seneste 5 filer i mapperne)
 *    og brug kun dens doc_chunks.
 * 3) Fallback: ingen kontekst → tom streng (modellen bruger kun question/answer).
 */
async function buildContextForEvaluation(opts: {
  sb: any;
  ownerId: string;
  body: Partial<EvalRequest>;
  maxChars?: number;
}): Promise<{ contextText: string; usedFileId: string | null }> {
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
    typeof fileRaw === "string" && fileRaw.trim().length > 0
      ? fileRaw.trim()
      : null;

  // Scope-mapper (fra venstre kolonne)
  const scopeFolderIds: string[] = Array.isArray(body.scopeFolderIds)
    ? body.scopeFolderIds.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      )
    : [];

  const fallbackFolder =
    typeof body.folder_id === "string" && body.folder_id.trim().length > 0
      ? body.folder_id.trim()
      : null;

  const effectiveFolderIds: string[] =
    scopeFolderIds.length > 0
      ? scopeFolderIds
      : fallbackFolder
      ? [fallbackFolder]
      : [];

  // Lille helper til at samle tekst fra en konkret fil
  async function buildFromFileId(fileId: string): Promise<string> {
    const { data: chunks, error } = await sb
      .from("doc_chunks")
      .select("id, content, file_id, folder_id, created_at")
      .eq("owner_id", ownerId)
      .eq("file_id", fileId)
      .order("created_at", { ascending: true })
      .limit(80);

    if (error) {
      console.error("[EVALUATE] doc_chunks error (file):", error);
      return "";
    }

    const rows: ChunkRow[] = (chunks ?? []) as ChunkRow[];
    if (!rows.length) return "";

    let text = rows
      .map((r) => r.content ?? "")
      .filter(Boolean)
      .join("\n\n---\n\n");

    if (text.length > maxChars) text = text.slice(0, maxChars);
    return text;
  }

  // 1) Hvis vi har en eksplicit file_id → brug den
  if (explicitFileId) {
    const text = await buildFromFileId(explicitFileId);
    return { contextText: text, usedFileId: explicitFileId };
  }

  // 2) Ellers: find filer i scope, vælg én tilfældig blandt de seneste 5
  let filesQuery = sb
    .from("files")
    .select("id, name, original_name, folder_id, created_at")
    .eq("owner_id", ownerId);

  if (effectiveFolderIds.length > 0) {
    filesQuery = filesQuery.in("folder_id", effectiveFolderIds);
  }

  const { data: fileRows, error: filesError } = await filesQuery.order(
    "created_at",
    { ascending: false },
  );

  if (filesError) {
    console.error("[EVALUATE] files error:", filesError);
  }

  let filesInScope: FileRow[] = (fileRows ?? []) as FileRow[];

  // Fallback: ingen filer i scope → kig globalt på brugerens filer
  if (!filesInScope.length) {
    const { data: allFiles, error: allFilesErr } = await sb
      .from("files")
      .select("id, name, original_name, folder_id, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });

    if (allFilesErr) {
      console.error("[EVALUATE] global files error:", allFilesErr);
    }
    filesInScope = (allFiles ?? []) as FileRow[];
  }

  if (!filesInScope.length) {
    return { contextText: "", usedFileId: null };
  }

  const recentFiles = filesInScope.slice(
    0,
    Math.min(filesInScope.length, 5),
  );
  const idx = Math.floor(Math.random() * recentFiles.length);
  const chosenFile = recentFiles[idx];

  console.log("[EVALUATE] chosen file for context:", {
    chosenFileId: chosenFile.id,
    totalFilesInScope: filesInScope.length,
  });

  const text = await buildFromFileId(chosenFile.id);
  return { contextText: text, usedFileId: chosenFile.id };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<EvalRequest>;

    const question = (body.question ?? "").trim();
    const answer = (body.answer ?? "").trim();

    if (!question || !answer) {
      return NextResponse.json(
        { error: "Mangler question eller answer" },
        { status: 400 },
      );
    }

    const includeBackground = !!body.includeBackground;

    // Supabase + owner_id (bruges både til context og til exam_sessions)
    const sb = await supabaseServerRoute();
    const ownerId = await getOwnerId(sb);

    // 1) Quota-check for EVALUATE
    if (ownerId) {
      const cost = 1; // 1 "evaluering" pr. kald
      const quota = await ensureQuotaAndDecrement(ownerId, "evaluate", cost);

      if (!quota.ok) {
        console.warn("[/api/evaluate] quota exceeded:", quota.message);
        return NextResponse.json(
          { error: quota.message, feature: "evaluate" },
          { status: quota.status },
        );
      }

      console.log(
        "[/api/evaluate] quota OK for owner",
        ownerId,
        "remaining approx:",
        quota.remaining,
      );
    } else {
      console.warn(
        "[/api/evaluate] ingen ownerId – springer quota-check over (dev-only).",
      );
    }

    // 2) Byg kontekst ud fra én fil i scope, hvis includeBackground = true
    let contextText = "";
    let usedFileId: string | null = null;

    if (includeBackground && ownerId) {
      try {
        const ctx = await buildContextForEvaluation({
          sb,
          ownerId,
          body,
          maxChars: 8000,
        });
        contextText = ctx.contextText;
        usedFileId = ctx.usedFileId;
      } catch (err) {
        console.error("EVALUATE: fejl ved hentning af doc_chunks:", err);
      }
    }

    // 3) LLM-kald – eksplicit “pensum-smart” prompt
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const systemPrompt = `
Du er dansk eksamenscensor.

Du får:
- et eksamensspørgsmål ("question"),
- et elevsvar ("answer"),
- og evt. baggrundsmateriale ("context") fra elevens eget pensum.

“context” er uddrag (doc_chunks) fra elevens noter/pensum inden for det valgte emne.
Du skal så vidt muligt bedømme svaret i forhold til dette materiale:
- Identificér de vigtigste pointer, begreber og eksempler i context.
- Vurder hvor godt elevens svar dækker disse pointer.
- Vær eksplicit omkring vigtige begreber fra pensum, som eleven bruger godt eller mangler.

Du skal:
- give en score i procent (0–100) – 100% betyder at svaret dækker de centrale pointer fra context meget sikkert og præcist.
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
Ingen forklarende tekst uden for JSON-objektet.
    `.trim();

    const userPayload = {
      question,
      answer,
      // kan være tom streng – modellen skal stadig håndtere det
      context: contextText,
    };

    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(userPayload),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsed: EvalJson;
    try {
      parsed = JSON.parse(raw) as EvalJson;
    } catch (e) {
      console.error("EVALUATE: JSON-parse fejl på raw:", raw, e);
      parsed = {};
    }

    const scoreRaw =
      typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
    const score = Number.isFinite(scoreRaw)
      ? Math.max(0, Math.min(100, Math.round(scoreRaw)))
      : 0;

    const overall =
      (parsed.overall &&
        String(parsed.overall).trim().replace(/\s+/g, " ")) ||
      "Overordnet et fint, men kort svar.";

    const strengths = ensureArray(parsed.strengths);
    const improvements = ensureArray(parsed.improvements);
    const nextSteps = ensureArray(parsed.next_steps);

    const feedbackLines: string[] = [
      `Samlet vurdering: ${overall}`,
      "",
      "Styrker:",
      ...(strengths.length
        ? strengths.map((s) => `- ${s}`)
        : ["- Ingen særlige styrker fremhævet."]),
      "",
      "Det kan forbedres:",
      ...(improvements.length
        ? improvements.map((s) => `- ${s}`)
        : ["- Ingen konkrete forbedringspunkter angivet."]),
      "",
      "Forslag til næste skridt:",
      ...(nextSteps.length
        ? nextSteps.map((s) => `- ${s}`)
        : ["- Arbejd videre med at uddybe og eksemplificere dine pointer."]),
    ];

    const feedbackText = feedbackLines.join("\n");

    // 4) GEM I exam_sessions
    if (!ownerId) {
      console.warn(
        "EVALUATE: mangler ownerId – gemmer ikke i exam_sessions (men returnerer svar).",
      );
    } else {
      const { folder_id, note_id, scopeFolderIds } = body;

      const insertPayload = {
        owner_id: ownerId,
        question,
        answer,
        feedback: feedbackText,
        score,
        folder_id: folder_id ?? null,
        source_type: "trainer" as const,
        meta: {
          includeBackground,
          scopeFolderIds: scopeFolderIds ?? [],
          note_id: note_id ?? null,
          file_id: usedFileId,
          // lille snippet til debug/overblik – ikke hele konteksten
          contextPreview: contextText ? contextText.slice(0, 400) : null,
        },
      };

      const { error: insertError } = await sb
        .from("exam_sessions")
        .insert(insertPayload);

      if (insertError) {
        console.error("EVALUATE: insert i exam_sessions fejl:", insertError);
      } else {
        // AUTOPRUNE: behold kun de seneste 50 Træner-evalueringer pr. bruger
        try {
          const { data: evalRows, error: fetchError } = await sb
            .from("exam_sessions")
            .select("id, created_at")
            .eq("owner_id", ownerId)
            .eq("source_type", "trainer")
            .order("created_at", { ascending: false });

          if (fetchError) {
            console.error("EVALUATE: cleanup fetch fejl:", fetchError);
          } else if (
            evalRows &&
            evalRows.length > MAX_TRAINER_EVALS_PER_OWNER
          ) {
            const idsToDelete = (evalRows as any[])
              .slice(MAX_TRAINER_EVALS_PER_OWNER)
              .map((row) => row.id);

            if (idsToDelete.length > 0) {
              const { error: delError } = await sb
                .from("exam_sessions")
                .delete()
                .eq("owner_id", ownerId)
                .in("id", idsToDelete);

              if (delError) {
                console.error("EVALUATE: cleanup delete fejl:", delError);
              }
            }
          }
        } catch (cleanupErr) {
          console.error("EVALUATE: cleanup unhandled fejl:", cleanupErr);
        }
      }
    }

    return NextResponse.json({
      score,
      feedback: feedbackText,
    });
  } catch (err) {
    console.error("EVALUATE /api/evaluate error:", err);
    return NextResponse.json(
      { error: "Intern fejl i evalueringen" },
      { status: 500 },
    );
  }
}
