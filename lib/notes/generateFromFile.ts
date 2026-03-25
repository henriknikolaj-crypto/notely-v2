import "server-only";

import OpenAI from "openai";
import { createChatCompletion } from "@/lib/openai/buildRequest";
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
  source_title?: string | null;
  source_url?: string | null;
  file_id?: string | null;
  folder_id?: string | null;
};

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
  },
) {
  const attempts = [
    {
      insert: row,
      select: "id,title,content,created_at,note_type,source_title,source_url,file_id,folder_id",
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
      select: "id,title,content,created_at,note_type,source_title,source_url,folder_id",
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
      select: "id,title,content,created_at,note_type,source_title,source_url",
    },
  ];

  let lastError: any = null;
  for (const attempt of attempts) {
    const result = await sb.from("notes").insert(attempt.insert).select(attempt.select).single();
    if (!result.error) return result.data as GeneratedNoteRow;
    lastError = result.error;
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

function buildPrompt(mode: NoteMode, contextText: string, sourceKind: "audio" | "document") {
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

  const systemPrompt = shared.join("\n");
  const task =
    mode === "golden"
      ? "Lav fokus-noter i punktform med ekstra eksamensfokus."
      : "Lav et kort, klart resumé i sammenhængende tekst.";

  return {
    systemPrompt,
    userPrompt: `${task}\n\nCONTEXT:\n"""${contextText}"""`,
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
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY mangler i .env.local.");
  }

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

  const { data: chunks, error: chunkError } = await sb
    .from("doc_chunks")
    .select("content")
    .eq("owner_id", ownerId)
    .eq("file_id", fileId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (chunkError) throw new Error("Kunne ikke hente tekstuddrag (doc_chunks).");
  if (!chunks || chunks.length === 0) {
    throw new Error("Der er endnu ingen tekstuddrag (doc_chunks) for filen.");
  }

  const contextText = chunks
    .map((c: any) => (c?.content ? String(c.content) : ""))
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 12000);

  const model = resolveModelForFeature("notes");
  const createdNotes: GeneratedNoteRow[] = [];

  for (const mode of wantedModes) {
    const prompt = buildPrompt(mode, contextText, sourceKind);
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

    const noteText = String(completion.choices[0]?.message?.content ?? "").trim();
    if (!noteText) throw new Error("Modellen returnerede tomt svar.");

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
