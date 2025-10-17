export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { supabaseServerRoute } from "@/app/(lib)/supabaseServerRoute";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function normalizeTitle(t?: string) {
  if (!t) return "";
  const tn = t.trim().toLowerCase();
  // Ignorér generiske titler som "note", "note 1", "note2" m.m.
  if (/^note(\s*\d+)?$/.test(tn)) return "";
  return t;
}

function bannedQuestion(q: string) {
  // Fang meta-henvisninger
  return /\b(note|dine noter|dokument(et)?|afsnit(tet)?)\b/i.test(q);
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await supabaseServerRoute();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const studySetId = body?.studySetId ?? null;

    // 1) doc_chunks først
    const { data: chunks, error: chunksErr } = await supabase
      .from("doc_chunks")
      .select("id, content")
      .eq("owner_id", user.id)
      .limit(8);

    if (chunksErr) return Response.json({ error: chunksErr.message }, { status: 500 });

    let context = "";
    let source = "doc_chunks";
    let sourceCount = chunks?.length ?? 0;

    // 2) Fallback til notes, men uden generiske titler
    if (!chunks || chunks.length === 0) {
      const { data: notes, error: notesErr } = await supabase
        .from("notes")
        .select("id, title, content")
        .eq("owner_id", user.id)
        .limit(6);

      if (notesErr) return Response.json({ error: notesErr.message }, { status: 500 });

      if (notes && notes.length > 0) {
        context = notes
          .map(n => [normalizeTitle(n?.title ?? ""), n?.content ?? ""]
            .filter(Boolean)
            .join("\n"))
          .filter(Boolean)
          .join("\n\n---\n\n");
        source = "notes";
        sourceCount = notes.length;
      } else {
        return Response.json(
          { error: "Ingen materiale fundet. Upload noter først.", code: "NO_MATERIAL" },
          { status: 400 }
        );
      }
    } else {
      context = chunks
        .map(c => (c?.content ?? "").trim())
        .filter(Boolean)
        .join("\n\n---\n\n");
    }

    const sys = "Du er en dansk eksaminator. Du skriver KORTE, KONKRETE faglige eksamensspørgsmål baseret på konteksten.";
    const usr = `Kontekst (uddrag fra elevens materiale):

${context}

Opgave: Skriv ÉT specifikt fagligt eksamensspørgsmål på dansk, maks 2 sætninger.

Krav:
- Brug konkrete begreber/personer/årstal fra konteksten.
- Brug aldrig meta-henvisninger som "note", "dine noter", "dokument(et)", "afsnit".
- Stil ikke spørgsmål om layout, kilder eller filnavne.
- Svar KUN med selve spørgsmålet.`;

    async function askOnce(extraInstruction?: string) {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: sys },
        { role: "user", content: usr + (extraInstruction ? `\n\nVIGTIGT: ${extraInstruction}` : "") },
      ];
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.4,
        max_tokens: 120,
      });
      return completion.choices?.[0]?.message?.content?.trim() ?? "";
    }

    let question = await askOnce();

    // Failsafe: hvis den alligevel laver meta-henvisning, så bed om en ny formulation én gang
    if (question && bannedQuestion(question)) {
      question = await askOnce("Din forrige formulering indeholdt meta-henvisninger. Skriv et nyt spørgsmål uden disse.");
    }

    if (!question || bannedQuestion(question)) {
      return Response.json({ error: "Model gav et ugyldigt spørgsmål" }, { status: 502 });
    }

    // Minimal INSERT, kun sikre kolonner
    const insertRow: any = {
      owner_id: user.id,
      question,
    };
    if (studySetId) insertRow.study_set_id = studySetId;

    const { data: ins, error: insErr } = await supabase
      .from("exam_sessions")
      .insert(insertRow)
      .select("id")
      .single();

    if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

    try {
      await supabase.from("jobs").insert({
        type: "generate_question",
        status: "succeeded",
        owner_id: user.id,
        meta: { source, sourceCount, session_id: ins?.id ?? null, question_len: question.length },
      });
    } catch {}

    return Response.json({
      ok: true,
      sessionId: ins?.id ?? null,
      question,
      source,
      sourceCount,
      usedChars: context.length,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Ukendt fejl" }, { status: 500 });
  }
}
