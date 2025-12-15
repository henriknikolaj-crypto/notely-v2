// app/api/generate-question/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // DEV fallback
  }
  return process.env.DEV_USER_ID ?? null;
}

async function callLLMQuestionGenerator(opts: {
  topic: string;
  contextText: string;
}) {
  const { topic, contextText } = opts;

  const systemPrompt = `
Du er opgavekonstruktør og eksamenssæt-forfatter på et dansk gymnasium.
Du formulerer korte, skarpe eksamensspørgsmål til skriftlig og mundtlig eksamen.
`.trim();

  const userPrompt = `
Emne/fag: ${topic || "ukendt emne"}

Baggrund (uddrag fra elevens pensum – én tekst ad gangen):
"""${contextText || "Ingen baggrundstekst tilgængelig."}"""

Opgave:
- Formulér 1 kort eksamensspørgsmål.
- Spørgsmålet skal teste forståelse og anvendelse, ikke kun udenadslære.
- Det skal være konkret og fagspecifikt, og gerne pege på centrale begreber/teorier.
- Maks 2 sætninger.
- Ingen forklaring, ingen punktopstilling – kun selve spørgsmålet som én sammenhængende tekst.

Returnér KUN selve spørgsmålet som ren tekst.
`.trim();

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.8,
  });

  const question =
    completion.choices[0]?.message?.content?.trim() ??
    `Formulér et kort eksamensspørgsmål inden for "${topic}", som tester forståelse og ikke kun udenadslære.`;

  return question;
}

/**
 * Bygger kontekst ud fra ÉN tilfældig fil i den valgte mappe.
 * Så bliver hvert spørgsmål knyttet til én konkret tekst,
 * men over tid bliver alle filer brugt.
 */
async function buildContextFromSingleFile(opts: {
  sb: any;
  ownerId: string;
  folderId: string | null;
  maxChunks?: number;
  maxChars?: number;
}): Promise<string> {
  const { sb, ownerId, folderId, maxChunks = 80, maxChars = 8000 } = opts;

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
  };

  // 1) Find filer for brugeren (evt. kun i én mappe)
  let filesQuery = sb
    .from("files")
    .select("id, name, original_name, folder_id")
    .eq("owner_id", ownerId);

  if (folderId) {
    filesQuery = filesQuery.eq("folder_id", folderId);
  }

  const { data: fileRows, error: filesError } = await filesQuery;

  if (filesError) {
    console.error("[generate-question] files error:", filesError);
  }

  const filesInScope: FileRow[] = (fileRows ?? []) as FileRow[];

  let finalRows: ChunkRow[] = [];

  if (filesInScope.length > 0) {
    // 2) Vælg ÉN tilfældig fil i scope
    const idx = Math.floor(Math.random() * filesInScope.length);
    const chosenFile = filesInScope[idx];

    console.log("[generate-question] chosen file for context:", {
      chosenFileId: chosenFile.id,
      fileCountInScope: filesInScope.length,
    });

    // 3) Hent chunks fra den valgte fil
    const { data: chunks, error: chunkErr } = await sb
      .from("doc_chunks")
      .select("id, content, file_id, folder_id, created_at")
      .eq("owner_id", ownerId)
      .eq("file_id", chosenFile.id)
      .order("created_at", { ascending: false })
      .limit(maxChunks);

    if (chunkErr) {
      console.error(
        "[generate-question] doc_chunks error (single-file):",
        chunkErr,
      );
    } else {
      finalRows = (chunks ?? []) as ChunkRow[];
    }
  }

  // 4) Fallback: brug alle doc_chunks i mappen / globalt hvis ingen filer
  if (finalRows.length === 0) {
    let fallbackQuery = sb
      .from("doc_chunks")
      .select("id, content, file_id, folder_id, created_at")
      .eq("owner_id", ownerId);

    if (folderId) {
      fallbackQuery = fallbackQuery.eq("folder_id", folderId);
    }

    const { data: chunkRows, error: chunkError } = await fallbackQuery
      .order("created_at", { ascending: false })
      .limit(maxChunks);

    if (chunkError) {
      console.error(
        "[generate-question] doc_chunks fallback error:",
        chunkError,
      );
      return "";
    }

    finalRows = (chunkRows ?? []) as ChunkRow[];
  }

  if (finalRows.length === 0) return "";

  let text = finalRows
    .map((row) => row.content ?? "")
    .filter(Boolean)
    .join("\n\n---\n\n");

  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }

  return text;
}

export async function POST(req: NextRequest) {
  try {
    const sb = await supabaseServerRoute();
    const ownerId = await getOwnerId(sb);

    if (!ownerId) {
      return NextResponse.json(
        { error: "Unauthorized (mangler DEV_USER_ID eller login)" },
        { status: 401 },
      );
    }

    const body: any = await req.json().catch(() => ({}));

    // Tillad både folder_id/folderId og note_id/noteId
    const folder_id_raw = body.folder_id ?? body.folderId ?? null;
    const note_id_raw = body.note_id ?? body.noteId ?? null;

    const folderId =
      typeof folder_id_raw === "string" ? folder_id_raw : null;
    const noteId = typeof note_id_raw === "string" ? note_id_raw : null;

    //
    // Find et simpelt "topic" til spørgsmålet:
    // 1) Hvis noteId → hent titel fra noten.
    // 2) Ellers hvis folderId → hent mappenavn.
    // 3) Ellers fallback.
    //
    let topic = "pensum";

    if (noteId) {
      const { data: note } = await sb
        .from("notes")
        .select("title")
        .eq("id", noteId)
        .eq("owner_id", ownerId)
        .maybeSingle();

      if (note?.title) topic = note.title;
    } else if (folderId) {
      const { data: folder } = await sb
        .from("folders")
        .select("name")
        .eq("id", folderId)
        .eq("owner_id", ownerId)
        .maybeSingle();

      if (folder?.name) topic = folder.name;
    }

    // Hent kontekst: én tilfældig fil i valgt mappe
    let contextText = "";
    try {
      contextText = await buildContextFromSingleFile({
        sb,
        ownerId,
        folderId,
        maxChunks: 80,
        maxChars: 8000,
      });
    } catch (err) {
      console.error(
        "GENERATE-QUESTION: fejl ved hentning af doc_chunks:",
        err,
      );
    }

    let question: string;

    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "GENERATE-QUESTION: mangler OPENAI_API_KEY, bruger fallback-spørgsmål",
      );
      question = `Formulér et kort eksamensspørgsmål inden for "${topic}", som tester forståelse og ikke kun udenadslære.`;
    } else {
      try {
        question = await callLLMQuestionGenerator({ topic, contextText });
      } catch (err) {
        console.error(
          "GENERATE-QUESTION: LLM-fejl, bruger fallback-spørgsmål:",
          err,
        );
        question = `Formulér et kort eksamensspørgsmål inden for "${topic}", som tester forståelse og ikke kun udenadslære.`;
      }
    }

    return NextResponse.json(
      {
        question,
        topic,
        folder_id: folderId,
        note_id: noteId,
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("GENERATE-QUESTION route error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
