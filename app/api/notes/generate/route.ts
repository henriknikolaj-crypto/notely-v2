// app/api/notes/generate/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    // falder igennem til DEV
  }
  return process.env.DEV_USER_ID ?? null;
}

function pickMode(raw: any): "resume" | "golden" {
  return raw === "golden" ? "golden" : "resume";
}

/** Robust tekst-udtræk fra OpenAI Responses (undgår .content på tool-calls) */
function extractResponseText(response: any): string {
  const ot = typeof response?.output_text === "string" ? response.output_text : "";
  if (ot.trim()) return ot.trim();

  const outputs: any[] = Array.isArray(response?.output) ? response.output : [];
  for (const item of outputs) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;

    for (const part of item.content) {
      const t =
        (typeof part?.text === "string" && part.text) ||
        (typeof part?.output_text === "string" && part.output_text) ||
        "";
      if (String(t).trim()) return String(t).trim();
    }
  }

  return "";
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      { ok: false, error: "Mangler bruger-id (login eller DEV_USER_ID)." },
      { status: 401 }
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "OPENAI_API_KEY mangler i .env.local." },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ugyldigt JSON-body." }, { status: 400 });
  }

  const fileId = typeof body?.fileId === "string" ? body.fileId.trim() : "";
  const mode = pickMode(body?.mode);

  if (!fileId) {
    return NextResponse.json({ ok: false, error: "Mangler fileId." }, { status: 400 });
  }

  // 1) Hent fil-oplysninger (til titel)
  const { data: fileRow, error: fileError } = await sb
    .from("files")
    .select("id, name, original_name, filename, file_name")
    .eq("owner_id", ownerId)
    .eq("id", fileId)
    .maybeSingle();

  if (fileError) {
    console.error("notes/generate: fileError", fileError);
    return NextResponse.json({ ok: false, error: "Kunne ikke slå filen op." }, { status: 500 });
  }
  if (!fileRow) {
    return NextResponse.json({ ok: false, error: "Filen blev ikke fundet." }, { status: 404 });
  }

  const fileName: string =
    fileRow.name ||
    fileRow.original_name ||
    fileRow.filename ||
    fileRow.file_name ||
    "Ukendt filnavn";

  // 2) Hent doc_chunks for den valgte fil
  const { data: chunks, error: chunkError } = await sb
    .from("doc_chunks")
    .select("content")
    .eq("owner_id", ownerId)
    .eq("file_id", fileId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (chunkError) {
    console.error("notes/generate: chunkError", chunkError);
    return NextResponse.json(
      { ok: false, error: "Kunne ikke hente tekstuddrag (doc_chunks)." },
      { status: 500 }
    );
  }

  if (!chunks || chunks.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Der er endnu ingen tekstuddrag (doc_chunks) for den valgte fil. Tjek at upload/parse er kørt.",
      },
      { status: 400 }
    );
  }

  const contextText = chunks
    .map((c: any) => (c?.content ? String(c.content) : ""))
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 12000);

  const modeLabel = mode === "golden" ? "FOKUS-NOTER" : "RESUMÉ";

  const systemPrompt = [
    "Du hjælper en studerende med at lave noter ud fra pensum-tekster.",
    "",
    `Du får uddrag af en tekst (kaldet "context") og skal lave ${
      mode === "golden"
        ? "fokus-noter i punktform med ekstra eksamensfokus"
        : "et kort, klart resumé i sammenhængende tekst"
    }.`,
    "",
    "Krav:",
    "- Arbejd KUN ud fra context-teksten.",
    "- Brug så vidt muligt faglige begreber, navne og pointer fra teksten.",
    "- Skriv på dansk i et niveau svarende til gymnasie/ungdomsuddannelse.",
    "- Ingen indledning om, hvad du gør; skriv bare selve noterne.",
  ].join("\n");

  const userPrompt = [
    `MODE: ${modeLabel}`,
    "",
    'Brug udelukkende teksten her som grundlag ("context"):',
    "",
    '"""',
    contextText,
    '"""',
  ].join("\n");

  // 3) LLM-kald + gem note
  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      input: `${systemPrompt}\n\n${userPrompt}`,
    });

    const noteText = extractResponseText(response);

    if (!noteText) {
      return NextResponse.json({ ok: false, error: "Modellen returnerede tomt svar." }, { status: 500 });
    }

    const titlePrefix = mode === "golden" ? "Fokus-noter – " : "Resumé – ";
    const title = `${titlePrefix}${fileName}`;

    // note_type matcher dine scopes: resume/focus
    const note_type = mode === "golden" ? "focus" : "resume";

    const { data: inserted, error: insertError } = await sb
      .from("notes")
      .insert({
        owner_id: ownerId,
        title,
        content: noteText,
        source_title: fileName,
        source_url: null,
        note_type,
      })
      .select("id, title, content, created_at, note_type")
      .single();

    if (insertError) {
      console.error("notes/generate: insertError", insertError);
      return NextResponse.json({ ok: false, error: "Kunne ikke gemme noten i databasen." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, note: inserted }, { status: 200 });
  } catch (err: any) {
    console.error("notes/generate: LLM error", err);
    return NextResponse.json(
      { ok: false, error: "Fejl fra modellen under generering. Prøv igen om lidt." },
      { status: 500 }
    );
  }
}
