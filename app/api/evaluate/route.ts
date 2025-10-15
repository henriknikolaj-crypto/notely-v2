import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { openai } from "@/app/(lib)/openai";
import { requireUser } from "@/app/(lib)/requireUser";

const Body = z.object({
  answer: z.string().optional(),
  answerText: z.string().optional(),
  question: z.string().optional(),
  question_id: z.string().uuid().optional(),
});

function makeDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Simpel lokal bedømmer som fallback (0/100 vs. 10/100 osv.)
function localEvaluate(q: string, a: string) {
  const qWords = q.toLowerCase().split(/\W+/).filter(Boolean);
  const aWords = a.toLowerCase().split(/\W+/).filter(Boolean);
  const overlap = new Set(qWords.filter(w => aWords.includes(w)));
  const ratio = Math.min(1, (overlap.size + Math.min(20, aWords.length)/50));
  const score = Math.round(ratio * 100);
  const feedback = score >= 60
    ? "Fint overblik – prøv at uddybe definitioner og give et eksempel."
    : "For tyndt svar – forklar nøglebegreberne og giv 1–2 konkrete eksempler.";
  return { score, feedback };
}

async function getLatestQuestion(db: ReturnType<typeof makeDb>, ownerId: string) {
  // prøv ai_questions først
  let q = await db
    .from("ai_questions")
    .select("id, question, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!q.error && q.data?.question) return q.data.question as string;

  // som fallback: læs seneste job-resultat hvis det findes
  const j = await db
    .from("jobs")
    .select("result, queued_at")
    .eq("owner_id", ownerId)
    .eq("kind", "generate-question")
    .order("queued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const jq = (j.data as any)?.result?.question;
  return typeof jq === "string" && jq.length > 0 ? jq : null;
}

export async function POST(req: Request) {
  const db = makeDb();
  try {
    const body = await req.json().catch(() => ({}));
    const { answer, answerText, question, question_id } = Body.parse(body);

    // auth (dev fallback i requireUser)
    let ownerId: string | null;
    try {
      const user = await requireUser();
      ownerId = user?.id ?? process.env.DEV_USER_ID ?? null;
    } catch {
      ownerId = process.env.DEV_USER_ID ?? null;
    }
    if (!ownerId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const a = (answer ?? answerText ?? "").trim();
    if (!a) {
      return NextResponse.json({ error: "missing answer" }, { status: 400 });
    }

    // find spørgsmål hvis det ikke kom med
    let qText = (question ?? "").trim();

    // hvis der er question_id, så slå det op i ai_questions
    if (!qText && question_id) {
      const row = await db
        .from("ai_questions")
        .select("question")
        .eq("id", question_id)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (row.data?.question) qText = row.data.question as string;
    }

    if (!qText) {
      const latest = await getLatestQuestion(db, ownerId);
      if (latest) qText = latest;
    }

    if (!qText) {
      return NextResponse.json({ error: "missing question" }, { status: 400 });
    }

    // Forsøg OpenAI-evaluering (valgfrit), ellers lokal fallback
    let score: number | null = null;
    let feedback: string | null = null;
    const hasKey = !!process.env.OPENAI_API_KEY;

    if (hasKey) {
      try {
        const messages = [
          { role: "system" as const, content: "Du er en streng, men retfærdig eksaminator. Giv kort feedback på dansk og en score 0-100." },
          { role: "user" as const, content: `Spørgsmål: ${qText}\n\nSvar: ${a}\n\nReturnér JSON med felterne { "score": number, "feedback": string }` }
        ];
        const comp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.3,
          max_tokens: 180,
        });
        const raw = comp.choices?.[0]?.message?.content?.trim() ?? "";
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.score === "number" && typeof parsed?.feedback === "string") {
            score = Math.max(0, Math.min(100, Math.round(parsed.score)));
            feedback = parsed.feedback;
          }
        } catch { /* ignore and fall back */ }
      } catch (e) {
        console.warn("[evaluate] OpenAI error – falling back:", e);
      }
    }

    if (score === null || feedback === null) {
      const r = localEvaluate(qText, a);
      score = r.score;
      feedback = r.feedback;
    }

    return NextResponse.json({
      question: qText,
      answer: a,
      score,
      feedback,
      model: hasKey ? "gpt-4o-mini" : "local-fallback"
    }, { status: 200 });

  } catch (err: any) {
    console.error("[evaluate] Fatal:", err?.message || err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
