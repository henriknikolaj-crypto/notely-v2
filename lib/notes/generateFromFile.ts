import "server-only";

import OpenAI from "openai";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { buildMatematikOutputStylePromptBlock, looksLikeMatematikContent } from "@/lib/matematik/outputStyle";
import {
  appendSourceMappingFallback,
  buildFocusNotePrompt,
  prepareFocusNotePlan,
} from "@/lib/notes/focusNotes";
import { buildMathFocusNoteArtifactsFromKnowledgeBlocks } from "@/lib/notes/focusNotesMath";
import { getLastMathFocusNoteAssemblyDebug } from "@/lib/notes/mathFocusNoteAssembly";
import {
  buildMathRenderedNoteMetadata,
  readMathRenderedNoteFromMetadata,
  type MathRenderedNote,
} from "@/lib/notes/mathRenderedNote";
import { resolveModelForFeature } from "@/lib/openai/model";

type NoteMode = "resume" | "golden";

type GenerateNotesParams = {
  sb: any;
  ownerId: string;
  fileId: string;
  modes: NoteMode[];
};

type GeneratedNoteRow = {
  id: string;
  title: string | null;
  content: string | null;
  created_at: string | null;
  note_type: string | null;
  metadata?: unknown;
  mathRenderedNote?: MathRenderedNote | null;
  source_title?: string | null;
  source_url?: string | null;
  file_id?: string | null;
  folder_id?: string | null;
};

type NoteChunkRow = {
  id: string;
  content: string;
  createdAt: string | null;
  pageFrom: number | null;
};

function shouldTraceNoteContent() {
  return process.env.NODE_ENV !== "production" || process.env.NOTELY_DEBUG_MATH_NOTES === "1";
}

function contentHash(value: string | null | undefined) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function contentFingerprint(value: string | null | undefined) {
  const text = String(value ?? "");
  return {
    length: text.length,
    hash: contentHash(text),
    first200: text.slice(0, 200).replace(/\r?\n/g, "\\n"),
  };
}

function traceGeneratedContent(label: string, value: string | null | undefined, extra?: Record<string, unknown>) {
  if (!shouldTraceNoteContent()) return;
  console.info("[notes/generate-content]", {
    label,
    ...contentFingerprint(value),
    ...extra,
  });
}

function withMathRenderedNoteAlias(row: GeneratedNoteRow, metadataFallback?: unknown): GeneratedNoteRow {
  const resolvedMathRenderedNote =
    readMathRenderedNoteFromMetadata(row.metadata) ??
    readMathRenderedNoteFromMetadata(metadataFallback);

  return {
    ...row,
    metadata: row.metadata ?? metadataFallback ?? null,
    mathRenderedNote: resolvedMathRenderedNote,
  };
}

async function persistStructuredMathMetadata(args: {
  sb: any;
  ownerId: string;
  noteId: string;
  metadata: Record<string, unknown>;
}) {
  const result = await args.sb
    .from("notes")
    .update({ metadata: args.metadata })
    .eq("owner_id", args.ownerId)
    .eq("id", args.noteId)
    .select("id,metadata")
    .maybeSingle();

  if (result.error) {
    return {
      ok: false as const,
      reason: result.error.message ?? "unknown_update_error",
      metadata: null,
    };
  }

  return {
    ok: true as const,
    reason: "update_metadata_after_insert",
    metadata: result.data?.metadata ?? args.metadata,
  };
}

async function insertGeneratedNote(
  sb: any,
  row: {
    owner_id: string;
    file_id: string;
    folder_id: string | null;
    title: string;
    content: string;
    source_title: string;
    source_url: string | null;
    note_type: string;
    metadata?: Record<string, unknown> | null;
  },
) {
  if (row.note_type === "focus") {
    traceGeneratedContent("savedContentUsed:before-insert", row.content, {
      title: row.title,
      fileId: row.file_id,
      folderId: row.folder_id,
    });
  }

  const attempts = [
    {
      insert: row,
      selectWithMetadata: "id,title,content,created_at,note_type,metadata,source_title,source_url,file_id,folder_id",
      selectWithoutMetadata: "id,title,content,created_at,note_type,source_title,source_url,file_id,folder_id",
    },
    {
      insert: {
        owner_id: row.owner_id,
        folder_id: row.folder_id,
        title: row.title,
        content: row.content,
        source_title: row.source_title,
        source_url: row.source_url,
        note_type: row.note_type,
      },
      selectWithMetadata: "id,title,content,created_at,note_type,metadata,source_title,source_url,folder_id",
      selectWithoutMetadata: "id,title,content,created_at,note_type,source_title,source_url,folder_id",
    },
    {
      insert: {
        owner_id: row.owner_id,
        title: row.title,
        content: row.content,
        source_title: row.source_title,
        source_url: row.source_url,
        note_type: row.note_type,
      },
      selectWithMetadata: "id,title,content,created_at,note_type,metadata,source_title,source_url",
      selectWithoutMetadata: "id,title,content,created_at,note_type,source_title,source_url",
    },
  ];

  let lastError: any = null;
  for (const attempt of attempts) {
    const insertWithMetadata =
      row.metadata && typeof row.metadata === "object"
        ? { ...attempt.insert, metadata: row.metadata }
        : attempt.insert;
    const metadataAttempts = [
      {
        insert: insertWithMetadata,
        select: attempt.selectWithMetadata,
      },
      {
        insert: attempt.insert,
        select: attempt.selectWithoutMetadata,
      },
    ];

    for (const metadataAttempt of metadataAttempts) {
      const result = await sb.from("notes").insert(metadataAttempt.insert).select(metadataAttempt.select).single();
      if (!result.error) {
        const finalRow = result.data as GeneratedNoteRow;
        let finalMetadata = finalRow?.metadata ?? null;
        let metadataPersisted = Boolean(readMathRenderedNoteFromMetadata(finalMetadata));
        let metadataPersistenceReason = metadataAttempt.select === attempt.selectWithMetadata
          ? "insert_select_with_metadata"
          : "insert_select_without_metadata";

        if (row.note_type === "focus" && row.metadata && !metadataPersisted && finalRow?.id) {
          const persistedMetadata = await persistStructuredMathMetadata({
            sb,
            ownerId: row.owner_id,
            noteId: finalRow.id,
            metadata: row.metadata,
          });

          if (persistedMetadata.ok) {
            finalMetadata = persistedMetadata.metadata;
            metadataPersisted = Boolean(readMathRenderedNoteFromMetadata(finalMetadata));
            metadataPersistenceReason = persistedMetadata.reason;
          } else {
            console.warn("[notes/generate-content]", {
              label: "structuredMathMetadataNotPersisted",
              noteId: finalRow.id,
              title: row.title,
              noteType: row.note_type,
              attemptedSelect: metadataAttempt.select,
              reason: persistedMetadata.reason,
            });
          }
        }

        if (row.note_type === "focus") {
          traceGeneratedContent("savedContentReturned:after-insert", finalRow?.content, {
            noteId: finalRow?.id ?? null,
            attemptSelect: metadataAttempt.select,
            metadataPersisted,
            metadataPersistenceReason,
            hasMathRenderedNote: Boolean(readMathRenderedNoteFromMetadata(finalMetadata ?? row.metadata ?? null)),
          });
        }
        return withMathRenderedNoteAlias(
          {
            ...finalRow,
            metadata: finalMetadata ?? row.metadata ?? null,
          },
          row.metadata,
        );
      }
      lastError = result.error;
    }
  }

  throw lastError ?? new Error("Kunne ikke gemme noten.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function normalizeModes(modes: NoteMode[]): NoteMode[] {
  const wanted = Array.isArray(modes) ? modes : [];
  const out: NoteMode[] = [];

  for (const mode of wanted) {
    if (mode !== "resume" && mode !== "golden") continue;
    if (!out.includes(mode)) out.push(mode);
  }

  return out.length > 0 ? out : ["resume"];
}

function isAudioFile(fileRow: any) {
  const mime = String(fileRow?.mime_type ?? "").trim().toLowerCase();
  if (mime.startsWith("audio/")) return true;

  const inputKind = String(fileRow?.extraction_meta?.input_kind ?? "").trim().toLowerCase();
  if (inputKind === "audio") return true;

  const name = String(fileRow?.name ?? fileRow?.original_name ?? "").trim().toLowerCase();
  return /\.(mp3|m4a|wav|mp4|mpeg|mpga|webm|ogg|oga|flac|aac)$/i.test(name);
}

function buildPrompt(args: {
  mode: NoteMode;
  contextText: string;
  sourceKind: "audio" | "document";
  focusPrompt?: { systemPrompt: string; userPrompt: string } | null;
}) {
  if (args.focusPrompt) return args.focusPrompt;

  const { mode, contextText, sourceKind } = args;
  const isMathNote = looksLikeMatematikContent(contextText);
  const shared = [
    "Du hjælper en studerende med at lave noter ud fra pensum-materiale.",
    "",
    "Krav:",
    "- Arbejd KUN ud fra context-teksten.",
    "- Brug så vidt muligt begreber, navne og pointer fra teksten.",
    "- Skriv på dansk (gymnasie/ungdomsuddannelse).",
    "- Ingen indledning om, hvad du gør; skriv kun selve noterne.",
  ];

  if (sourceKind === "audio") {
    shared.push("- Context-teksten er en transskription af lyd. Ryd kun let op i talesprog, men opfind ikke nyt indhold.");
  }

  if (isMathNote) {
    shared.push("", buildMatematikOutputStylePromptBlock("notes"));
  }

  const systemPrompt = shared.join("\n");
  const task =
    mode === "golden"
      ? "Lav fokus-noter i punktform med ekstra eksamensfokus."
      : "Lav et kort, klart resumé i sammenhængende tekst.";
  const mathTaskAddendum = isMathNote
    ? mode === "golden"
      ? "\nNår stoffet er matematik, må du gerne bruge korte, render-venlige formler og små mellemregninger, men hold noterne kompakte."
      : "\nNår stoffet er matematik, så skriv centrale formler og korte mellemregninger mere render-venligt og mindre som rå tekst."
    : "";

  return {
    systemPrompt,
    userPrompt: `${task}${mathTaskAddendum}\n\nCONTEXT:\n"""${contextText}"""`,
  };
}

function buildTitle(mode: NoteMode, fileName: string, sourceKind: "audio" | "document") {
  if (sourceKind === "audio") {
    return mode === "golden" ? `Fokus-noter fra lyd – ${fileName}` : `Resumé fra lyd – ${fileName}`;
  }
  return mode === "golden" ? `Fokus-noter – ${fileName}` : `Resumé – ${fileName}`;
}

export async function generateNotesForFile({
  sb,
  ownerId,
  fileId,
  modes,
}: GenerateNotesParams): Promise<GeneratedNoteRow[]> {
  const wantedModes = normalizeModes(modes);

  const { data: fileRow, error: fileError } = await sb
    .from("files")
    .select("id,name,original_name,mime_type,folder_id,extraction_meta")
    .eq("owner_id", ownerId)
    .eq("id", fileId)
    .maybeSingle();

  if (fileError) throw new Error("Kunne ikke slå filen op.");
  if (!fileRow) throw new Error("Filen blev ikke fundet.");

  const fileName: string = fileRow.name || fileRow.original_name || "Ukendt filnavn";
  const sourceKind: "audio" | "document" = isAudioFile(fileRow) ? "audio" : "document";

  let folderName: string | null = null;
  if (fileRow.folder_id) {
    const { data: folderRow } = await sb
      .from("folders")
      .select("id,name")
      .eq("owner_id", ownerId)
      .eq("id", fileRow.folder_id)
      .maybeSingle();
    folderName = folderRow?.name ? String(folderRow.name) : null;
  }

  const { data: chunks, error: chunkError } = await sb
    .from("doc_chunks")
    .select("id,content,created_at,page_from")
    .eq("owner_id", ownerId)
    .eq("file_id", fileId)
    .order("created_at", { ascending: true })
    .limit(60);

  if (chunkError) throw new Error("Kunne ikke hente tekstuddrag (doc_chunks).");
  if (!chunks || chunks.length === 0) {
    throw new Error("Der er endnu ingen tekstuddrag (doc_chunks) for filen.");
  }

  const chunkRows: NoteChunkRow[] = (chunks ?? [])
    .map((chunk: any) => ({
      id: String(chunk?.id ?? "").trim(),
      content: String(chunk?.content ?? "").trim(),
      createdAt: chunk?.created_at ? String(chunk.created_at) : null,
      pageFrom: Number.isFinite(Number(chunk?.page_from)) ? Number(chunk.page_from) : null,
    }))
    .filter((chunk: NoteChunkRow) => chunk.id && chunk.content);

  const contextText = chunkRows
    .map((chunk: NoteChunkRow) => chunk.content)
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 12000);

  const model = resolveModelForFeature("notes");
  const createdNotes: GeneratedNoteRow[] = [];

  for (const mode of wantedModes) {
    const focusPlan =
      mode === "golden"
        ? prepareFocusNotePlan({
            fileName,
            folderName,
            chunks: chunkRows,
          })
        : null;

    const shouldUseMathBlockAssembly =
      mode === "golden" &&
      focusPlan &&
      (focusPlan.isMath ||
        focusPlan.resolvedSubjectFamily === "matematik" ||
        focusPlan.mathKnowledgeBlocks.length > 0 ||
        looksLikeMatematikContent(contextText));

    if (mode === "golden" && focusPlan && shouldTraceNoteContent()) {
      console.info("[notes/generate-content]", {
        label: "mathAssemblyBranchDecision",
        shouldUseMathBlockAssembly,
        isMath: focusPlan.isMath,
        resolvedSubjectFamily: focusPlan.resolvedSubjectFamily,
        mathBlocks: focusPlan.mathKnowledgeBlocks.length,
        looksLikeMath: looksLikeMatematikContent(contextText),
        fileName,
      });
    }

    if (shouldUseMathBlockAssembly && focusPlan) {
      const mathAssembly = buildMathFocusNoteArtifactsFromKnowledgeBlocks(focusPlan);
      const assembledContentRaw = mathAssembly.markdown.trim();
      const renderedMathNote: MathRenderedNote = mathAssembly.renderedNote;
      const structuredMetadata = buildMathRenderedNoteMetadata(renderedMathNote);
      const mathAssemblyDebug = getLastMathFocusNoteAssemblyDebug();
      if (shouldTraceNoteContent()) {
        console.info("[notes/generate-content]", {
          label: "liveFeaturedFormulaCandidates",
          candidates: mathAssemblyDebug.featuredFormulaCandidateDecisions,
          winners: mathAssemblyDebug.selectedFeaturedFormulas,
          suppressed: mathAssemblyDebug.suppressedFeaturedFormulas,
        });
        console.info("[notes/generate-content]", {
          label: "liveFeaturedFormulaMarkdownBlock",
          markdown: mathAssemblyDebug.featuredFormulaMarkdownBlock,
        });
        console.info("[notes/generate-content]", {
          label: "mathRenderedNoteSummary",
          knowledgeBlocks: focusPlan.mathKnowledgeBlocks.length,
          renderedBlocks: renderedMathNote.blocks.length,
          keyFormulas: renderedMathNote.keyFormulas.map((formula) => formula.title),
          blockKinds: Array.from(new Set(renderedMathNote.blocks.map((block) => block.kind))),
          rendererPath: "structured_math_renderer",
        });
      }
      const assembledContentSanitized = appendSourceMappingFallback(assembledContentRaw, focusPlan).trim();
      const finalNoteContent = assembledContentSanitized;
      traceGeneratedContent("assembledContentRaw", assembledContentRaw, {
        mode,
        fileName,
        sourceKind,
        isMath: focusPlan.isMath,
        resolvedSubjectFamily: focusPlan.resolvedSubjectFamily,
        mathBlocks: focusPlan.mathKnowledgeBlocks.length,
      });
      traceGeneratedContent("assembledContentSanitized", assembledContentSanitized, {
        mode,
        fileName,
        sourceKind,
      });
      traceGeneratedContent("finalNoteContent", finalNoteContent, {
        mode,
        fileName,
        sourceKind,
      });
      const title = buildTitle(mode, fileName, sourceKind);
      const sourceUrl = sourceKind === "audio" ? `notely://audio/${fileId}` : null;

      const inserted = await insertGeneratedNote(sb, {
        owner_id: ownerId,
        file_id: fileId,
        folder_id: fileRow.folder_id ?? null,
        title,
        content: finalNoteContent,
        source_title: fileName,
        source_url: sourceUrl,
        note_type: "focus",
        metadata: structuredMetadata,
      });
      createdNotes.push({
        ...inserted,
        content: finalNoteContent,
        metadata: inserted.metadata ?? structuredMetadata,
        mathRenderedNote:
          inserted.mathRenderedNote ??
          readMathRenderedNoteFromMetadata(inserted.metadata) ??
          renderedMathNote,
      });
      continue;
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY mangler i .env.local.");
    }

    const prompt = buildPrompt({
      mode,
      contextText,
      sourceKind,
      focusPrompt: mode === "golden" && focusPlan ? buildFocusNotePrompt(focusPlan) : null,
    });
    const { completion } = await createChatCompletion(openai, {
      feature: "notes",
      modelOverride: model,
      payload: {
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.userPrompt },
        ],
      },
    });

    let noteText = String(completion.choices[0]?.message?.content ?? "").trim();
    if (!noteText) throw new Error("Modellen returnerede tomt svar.");

    if (mode === "golden" && focusPlan) {
      noteText = appendSourceMappingFallback(noteText, focusPlan);
    }

    const noteType = mode === "golden" ? "focus" : "resume";
    const title = buildTitle(mode, fileName, sourceKind);
    const sourceUrl = sourceKind === "audio" ? `notely://audio/${fileId}` : null;

    const inserted = await insertGeneratedNote(sb, {
      owner_id: ownerId,
      file_id: fileId,
      folder_id: fileRow.folder_id ?? null,
      title,
      content: noteText,
      source_title: fileName,
      source_url: sourceUrl,
      note_type: noteType,
    });
    createdNotes.push(inserted);
  }

  return createdNotes;
}
