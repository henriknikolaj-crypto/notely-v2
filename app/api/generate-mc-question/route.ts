// app/api/generate-mc-question/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type GenerateMcRequest = {
  scopeFolderIds?: string[];
  difficulty?: Difficulty;
  maxContextChunks?: number;
};

type McOptionPayload = {
  id: string;
  text: string;
  isCorrect: boolean;
};

type McCitationPayload = {
  chunkId: string;
  title: string | null;
  url: string | null;
};

type GenerateMcResponse = {
  questionId: string;
  question: string;
  options: McOptionPayload[];
  explanation: string | null;
  citations: McCitationPayload[];
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) {
        return data.user.id as string;
      }
    }
  } catch {
    // falder tilbage til DEV_USER_ID
  }
  return process.env.DEV_USER_ID ?? null;
}

// Fallback hvis noget går galt
function buildDemoQuestion(): GenerateMcResponse {
  return {
    questionId: crypto.randomUUID(),
    question:
      "Hvad er hovedformålet med Notely, når du bruger det som studieassistent?",
    options: [
      {
        id: "a",
        text: "At være en nordisk studieassistent, der hjælper dig med at forstå dit eget pensum",
        isCorrect: true,
      },
      {
        id: "b",
        text: "At erstatte alle lærebøger, så du aldrig behøver at læse igen",
        isCorrect: false,
      },
      {
        id: "c",
        text: "At være et generelt AI-chatværktøj uden særligt fokus på studier",
        isCorrect: false,
      },
      {
        id: "d",
        text: "Kun at lave flashede marketing-tekster til sociale medier",
        isCorrect: false,
      },
    ],
    explanation:
      "Notely er designet som en studieassistent/eksamenstræner, der bygger på dit eget pensum og supplerer med faglig baggrundslitteratur – ikke som en total erstatning for bøger og undervisning.",
    citations: [],
  };
}

export async function POST(req: Request) {
  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      { error: "Mangler owner_id (hverken login eller DEV_USER_ID sat)." },
      { status: 401 },
    );
  }

  let body: GenerateMcRequest | null = null;

  try {
    body = (await req.json()) as GenerateMcRequest;
  } catch {
    body = null;
  }

  const scopeFolderIds =
    body?.scopeFolderIds?.filter(
      (x) => typeof x === "string" && x.trim().length > 0,
    ) ?? [];

  const difficulty: Difficulty = body?.difficulty ?? "medium";

  const rawMax = body?.maxContextChunks;
  const maxContextChunks =
    typeof rawMax === "number" && Number.isFinite(rawMax)
      ? Math.min(Math.max(Math.round(rawMax), 1), 32)
      : 8;

  console.log("[generate-mc-question] ownerId:", ownerId, {
    scopeFolderIds,
    difficulty,
    maxContextChunks,
  });

  // --- Hent noter i scope (fallback-kontekst) ---

  type NoteRow = {
    id: string;
    title: string | null;
    content: string | null;
    source_title: string | null;
    source_url: string | null;
    folder_id?: string | null;
  };

  let notesQuery = sb
    .from("notes")
    .select("id,title,content,source_title,source_url,folder_id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(maxContextChunks);

  if (scopeFolderIds.length > 0) {
    notesQuery = notesQuery.in("folder_id", scopeFolderIds);
  }

  const { data: notes, error: notesError } = await notesQuery;

  if (notesError) {
    console.error("[generate-mc-question] notes error:", notesError);
  }

  const noteRows: NoteRow[] = (notes ?? []) as NoteRow[];

  // topic = mappe-navn hvis muligt, ellers "dit pensum"
  let topic = "dit pensum";

  if (scopeFolderIds.length > 0) {
    const { data: folder } = await sb
      .from("folders")
      .select("name")
      .eq("owner_id", ownerId)
      .eq("id", scopeFolderIds[0])
      .maybeSingle();

    if (folder?.name) {
      topic = folder.name;
    }
  } else if (noteRows[0]?.title) {
    topic = noteRows[0].title!;
  }

  const MAX_CONTEXT_CHARS = 6000;

  // --- PRIMÆR KONTEKST: doc_chunks fra de valgte mapper ---
  let contextTextFromDocChunks = "";
  let citationsFromDocChunks: McCitationPayload[] = [];

  try {
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

    // 1) Find relevante filer i scope
    let filesQuery = sb
      .from("files")
      .select("id, name, original_name, folder_id")
      .eq("owner_id", ownerId);

    if (scopeFolderIds.length > 0) {
      filesQuery = filesQuery.in("folder_id", scopeFolderIds);
    }

    const { data: fileRows, error: filesError } = await filesQuery;

    if (filesError) {
      console.error(
        "[generate-mc-question] files-in-scope error:",
        filesError,
      );
    }

    const filesInScope: FileRow[] = (fileRows ?? []) as FileRow[];

    const fileTitleById: Record<string, string> = {};
    for (const f of filesInScope) {
      fileTitleById[f.id] =
        f.name || f.original_name || topic || "Ukendt kilde";
    }

    const groups = new Map<string, ChunkRow[]>();

    if (filesInScope.length > 0) {
      // Hvor mange chunks må hver fil cirka bidrage med?
      const perFileLimit = Math.max(
        1,
        Math.ceil(maxContextChunks / filesInScope.length),
      );

      console.log(
        "[generate-mc-question] filesInScope:",
        filesInScope.length,
        "perFileLimit:",
        perFileLimit,
      );

      // 2) Hent seneste chunks pr. fil
      for (const f of filesInScope) {
        const { data: chunks, error: chunkErr } = await sb
          .from("doc_chunks")
          .select("id, content, file_id, folder_id, created_at")
          .eq("owner_id", ownerId)
          .eq("file_id", f.id)
          .order("created_at", { ascending: false })
          .limit(perFileLimit);

        if (chunkErr) {
          console.error(
            "[generate-mc-question] doc_chunks per-file error:",
            chunkErr,
          );
          continue;
        }

        const chunkList: ChunkRow[] = (chunks ?? []) as ChunkRow[];
        if (chunkList.length > 0) {
          groups.set(f.id, chunkList);
        }
      }
    }

    let finalRows: ChunkRow[] = [];

    if (groups.size > 0) {
      // 3) Interleav på tværs af filer: 1. chunk fra hver fil, så 2. chunk osv.
      const keys = Array.from(groups.keys());
      let depth = 0;

      while (finalRows.length < maxContextChunks) {
        let added = false;
        for (const key of keys) {
          const group = groups.get(key)!;
          if (depth < group.length) {
            finalRows.push(group[depth]);
            added = true;
            if (finalRows.length >= maxContextChunks) break;
          }
        }
        if (!added) break;
        depth++;
      }
    } else {
      // 4) Fallback: gammel adfærd (fx hvis der ikke er filer, men kun "løse" doc_chunks)
      let fallbackQuery = sb
        .from("doc_chunks")
        .select("id, content, file_id, folder_id, created_at")
        .eq("owner_id", ownerId);

      if (scopeFolderIds.length > 0) {
        fallbackQuery = fallbackQuery.in("folder_id", scopeFolderIds);
      }

      const { data: chunkRows, error: chunkError } = await fallbackQuery
        .order("created_at", { ascending: false })
        .limit(maxContextChunks);

      if (chunkError) {
        console.error(
          "[generate-mc-question] doc_chunks fallback error:",
          chunkError,
        );
      } else {
        finalRows = (chunkRows ?? []) as ChunkRow[];
      }
    }

    if (finalRows.length > 0) {
      contextTextFromDocChunks = finalRows
        .map((row) => row.content ?? "")
        .filter(Boolean)
        .join("\n\n---\n\n");

      if (contextTextFromDocChunks.length > MAX_CONTEXT_CHARS) {
        contextTextFromDocChunks = contextTextFromDocChunks.slice(
          0,
          MAX_CONTEXT_CHARS,
        );
      }

      citationsFromDocChunks = finalRows.map((row) => ({
        chunkId: row.id,
        title:
          (row.file_id && fileTitleById[row.file_id]) ||
          topic ||
          "Ukendt kilde",
        url: null,
      }));
    }
  } catch (err) {
    console.error(
      "[generate-mc-question] doc_chunks fetch error, falling back to notes:",
      err,
    );
  }

  // --- Fallback: brug noter hvis der ikke er doc_chunks ---

  let contextText = "";
  let citations: McCitationPayload[] = [];

  if (contextTextFromDocChunks) {
    contextText = contextTextFromDocChunks;
    citations = citationsFromDocChunks;
  } else {
    const contextBlocks = noteRows.map((n) => {
      const label = n.title || n.source_title || "Ukendt kilde";
      const body = (n.content ?? "").trim();
      return `KILDE: ${label}\n${body}`;
    });

    contextText = contextBlocks.join("\n\n---\n\n");
    if (contextText.length > MAX_CONTEXT_CHARS) {
      contextText = contextText.slice(0, MAX_CONTEXT_CHARS);
    }

    citations = noteRows.map((n) => ({
      chunkId: n.id,
      title: n.title || n.source_title || null,
      url: n.source_url || null,
    }));
  }

  // --- LLM-kald: generér ét MC-spørgsmål på dansk ud fra konteksten ---

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[generate-mc-question] Missing OPENAI_API_KEY, using demo");
    return NextResponse.json(buildDemoQuestion());
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const systemPrompt = `
Du er en dansk studieassistent. Du laver eksamenslignende multiple choice-spørgsmål til elever/studerende
på baggrund af deres egne pensumtekster ("kontekst").

VIGTIGT:
- Du MÅ KUN bruge den kontekst, du får i prompten, som grundlag for spørgsmål og svar.
- Brug konkrete navne, begreber, eksempler og pointer fra konteksten, når det er muligt.
- Find et centralt fagligt punkt i konteksten og lav et spørgsmål, der KUN kan besvares korrekt,
  hvis man har læst konteksten.
- Skriv ALT på dansk.

KRAV TIL OUTPUT:
- Lav præcise, faglige spørgsmål – ingen overfladisk smalltalk.
- Lav 1 (ét) multiple choice-spørgsmål.
- Lav 4 svarmuligheder, hvor præcis 1 er korrekt.
- De forkerte svar (distraktorer) skal være plausible, ikke åbenlyst forkerte.
- Spørgsmålet skal teste forståelse eller anvendelse, ikke kun ren udenadslære.
- Returnér svaret som gyldig JSON med nøglerne:
  {
    "question": "...",
    "options": [
      { "text": "...", "isCorrect": true/false },
      ...
    ],
    "explanation": "Kort forklaring på, hvorfor det rigtige svar er korrekt"
  }
`.trim();

  const userPromptParts = [
    `Fag/tema: ${topic}`,
    `Sværhedsgrad: ${difficulty}`,
  ];

  if (contextText) {
    userPromptParts.push(
      "",
      "Her er uddrag fra elevens pensum. Brug dem som ENESTE grundlag for spørgsmål og forklaring:",
      "",
      contextText,
      "",
      "Lav et spørgsmål, der tydeligt kan besvares korrekt ud fra uddragene ovenfor.",
    );
  } else {
    userPromptParts.push(
      "",
      "Der er ingen eksplicit kontekst i denne forespørgsel – lav et generelt spørgsmål inden for fag/temaet.",
    );
  }

  const userPrompt = userPromptParts.join("\n");

  try {
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";

    type LlmOption = { text?: string; isCorrect?: boolean };
    type LlmPayload = {
      question?: string;
      options?: LlmOption[];
      explanation?: string;
    };

    let parsed: LlmPayload;
    try {
      parsed = JSON.parse(raw) as LlmPayload;
    } catch (err) {
      console.error("[generate-mc-question] JSON parse error, using demo:", err);
      return NextResponse.json(buildDemoQuestion());
    }

    const questionText = (parsed.question || "").trim();
    const llmOptions = Array.isArray(parsed.options) ? parsed.options : [];

    if (!questionText || llmOptions.length < 2) {
      console.error("[generate-mc-question] LLM output incomplete, using demo");
      return NextResponse.json(buildDemoQuestion());
    }

    // Map til payload med id'er a,b,c,d,...
    const letters = ["a", "b", "c", "d", "e", "f"];
    const options: McOptionPayload[] = llmOptions
      .slice(0, 6)
      .map((opt, idx) => ({
        id: letters[idx] ?? `opt${idx + 1}`,
        text: String(opt.text ?? "").trim() || `Mulighed ${idx + 1}`,
        isCorrect: !!opt.isCorrect,
      }));

    // Sikr præcis 1 korrekt svar
    const firstCorrectIndex = options.findIndex((o) => o.isCorrect);

    if (firstCorrectIndex === -1) {
      options[0].isCorrect = true;
    } else {
      options.forEach((o, idx) => {
        o.isCorrect = idx === firstCorrectIndex;
      });
    }

    // Shuffle rækkefølgen (så korrekt IKKE altid ligger først)
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    const response: GenerateMcResponse = {
      questionId: crypto.randomUUID(),
      question: questionText,
      options,
      explanation: parsed.explanation?.trim() || null,
      citations,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[generate-mc-question] OpenAI error, using demo:", err);
    return NextResponse.json(buildDemoQuestion());
  }
}
