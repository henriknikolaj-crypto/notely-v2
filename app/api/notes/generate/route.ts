// app/api/notes/generate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function pickMode(raw: any): "resume" | "golden" {
  return raw === "golden" ? "golden" : "resume";
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

export async function POST(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);

  if (!owner) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized (login kræves)." },
      { status: 401 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "OPENAI_API_KEY mangler i .env.local." },
      { status: 500 },
    );
  }

  const parsed = await readJsonBody<{ fileId?: string; mode?: string }>(req);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });

  const body = parsed.value ?? {};
  const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";
  const mode = pickMode(body.mode);

  if (!fileId) {
    return NextResponse.json({ ok: false, error: "Mangler fileId." }, { status: 400 });
  }

  const ownerId = owner.ownerId;

  // 1) Fil
  const { data: fileRow, error: fileError } = await sb
    .from("files")
    .select("id,name,original_name")
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

  const fileName: string = fileRow.name || fileRow.original_name || "Ukendt filnavn";

  // 2) doc_chunks
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
      { status: 500 },
    );
  }

  if (!chunks || chunks.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Der er endnu ingen tekstuddrag (doc_chunks) for filen. Tjek at upload/parse er kørt.",
      },
      { status: 400 },
    );
  }

  const contextText = chunks
    .map((c: any) => (c?.content ? String(c.content) : ""))
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 12000);

  const systemPrompt = [
    "Du hjælper en studerende med at lave noter ud fra pensum-tekster.",
    "",
    "Krav:",
    "- Arbejd KUN ud fra context-teksten.",
    "- Brug så vidt muligt begreber, navne og pointer fra teksten.",
    "- Skriv på dansk (gymnasie/ungdomsuddannelse).",
    "- Ingen indledning om, hvad du gør; skriv kun selve noterne.",
  ].join("\n");

  const userPrompt =
    mode === "golden"
      ? `Lav fokus-noter i punktform med ekstra eksamensfokus.\n\nCONTEXT:\n"""${contextText}"""`
      : `Lav et kort, klart resumé i sammenhængende tekst.\n\nCONTEXT:\n"""${contextText}"""`;

  const model =
    process.env.OPENAI_MODEL_NOTES ||
    process.env.OPENAI_MODEL ||
    "gpt-4o-mini";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const noteText = (completion.choices[0]?.message?.content ?? "").trim();
  if (!noteText) {
    return NextResponse.json(
      { ok: false, error: "Modellen returnerede tomt svar." },
      { status: 500 },
    );
  }

  const titlePrefix = mode === "golden" ? "Fokus-noter – " : "Resumé – ";
  const title = `${titlePrefix}${fileName}`;
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
    .select("id,title,content,created_at,note_type")
    .single();

  if (insertError) {
    console.error("notes/generate: insertError", insertError);
    return NextResponse.json({ ok: false, error: "Kunne ikke gemme noten." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, note: inserted }, { status: 200 });
}
