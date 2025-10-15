import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { generateQuestionPrompt } from "@/app/(lib)/prompts/generateQuestionPrompt";
import { openai } from "@/app/(lib)/openai";
import { requireUser } from "@/app/(lib)/requireUser";

const Body = z.object({
  topicHint: z.string().optional(),
  includeBackground: z.boolean().default(false),
  count: z.number().min(1).max(5).default(1),
});

function makeDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function localFallbackQuestion(ctx: string, topicHint?: string) {
  const hint = (topicHint ?? "").trim();
  if (hint) return `Redegør kort for de vigtigste begreber i ${hint}, og forklar deres indbyrdes sammenhæng.`;
  return `Identificér og forklar hovedpointerne i teksten, og diskuter deres betydning i en faglig kontekst.`;
}

// Robust hentning af kontekst-chunks uanset kolonnenavne
async function fetchChunks(db: ReturnType<typeof makeDb>, ownerId: string) {
  // 1) prøv created_at
  let q = await db
    .from("doc_chunks")
    .select("id, content, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (!q.error) return q.data ?? [];

  // 2) prøv id (ofte korrelerer med indsættelsesrækkefølge)
  q = await db
    .from("doc_chunks")
    .select("id, content")
    .eq("owner_id", ownerId)
    .order("id", { ascending: false })
    .limit(8);

  if (!q.error) return q.data ?? [];

  // 3) sidste fallback: ingen order
  q = await db
    .from("doc_chunks")
    .select("id, content")
    .eq("owner_id", ownerId)
    .limit(8);

  if (!q.error) return q.data ?? [];

  // hvis alt fejler, returnér tom liste (og lad fallback-spørgsmålet tage over)
  console.warn("[generate-question] fetchChunks fejl:", q.error?.message);
  return [];
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const db = makeDb();
  let jobId: string | null = null;

  try {
    const json = await req.json().catch(() => ({}));
    const { topicHint, includeBackground, count } = Body.parse(json);

    // auth (dev fallback)
    let ownerId: string | null;
    try {
      const user = await requireUser();
      ownerId = user?.id ?? process.env.DEV_USER_ID ?? null;
    } catch {
      ownerId = process.env.DEV_USER_ID ?? null;
    }
    if (!ownerId) {
      return NextResponse.json({ error: "Not authenticated (set DEV_USER_ID or login)" }, { status: 401 });
    }

    // job → queued (matcher din jobs-tabel)
    const { data: job, error: jobErr } = await db
      .from("jobs")
      .insert({
        kind: "generate-question",
        owner_id: ownerId,
        status: "queued",
        payload: { topicHint, includeBackground, count },
        queued_at: new Date().toISOString()
      })
      .select("*")
      .single();
    if (jobErr) throw jobErr;
    jobId = job?.id ?? null;

    // hent kontekst (robust)
    const chunks = await fetchChunks(db, ownerId);
    const mergedContext = (chunks ?? [])
      .map(c => (c.content ?? "").slice(0, 800))
      .join("\n---\n");

    // job → started
    if (jobId) {
      await db.from("jobs").update({
        status: "started",
        started_at: new Date().toISOString()
      }).eq("id", jobId);
    }

    // OpenAI → fallback
    let question = "";
    let tokensUsed: number | null = null;
    const hasKey = !!process.env.OPENAI_API_KEY;

    if (hasKey) {
      try {
        const messages = generateQuestionPrompt({ topicHint, mergedContext });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.5,
          max_tokens: 180,
        });
        question = completion.choices?.[0]?.message?.content?.trim() || "";
        const ti = completion?.usage?.prompt_tokens ?? 0;
        const to = completion?.usage?.completion_tokens ?? 0;
        tokensUsed = ti + to;
      } catch (e: any) {
        console.error("[generate-question] OpenAI error:", e?.message || e);
      }
    }
    if (!question) question = localFallbackQuestion(mergedContext, topicHint);

    // best-effort: gem i ai_questions
    try {
      await db.from("ai_questions").insert({
        owner_id: ownerId,
        question,
        model: hasKey ? "gpt-4o-mini" : "local-fallback",
        context_chunk_count: chunks?.length ?? 0,
      });
    } catch (e) {
      console.warn("[generate-question] ai_questions insert warning:", e);
    }

    // job → succeeded
    const ms = Date.now() - startedAt;
    if (jobId) {
      await db.from("jobs").update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        latency_ms: ms,
        tokens_used: tokensUsed,
        result: { question }
      }).eq("id", jobId);
    }

    return NextResponse.json({
      question,
      sources: (chunks ?? []).map(c => c.id),
      model: hasKey ? "gpt-4o-mini" : "local-fallback",
      job_id: jobId,
      latency_ms: ms
    }, { status: 200 });

  } catch (error: any) {
    console.error("[generate-question] Fatal:", error?.message || error);
    if (jobId) {
      await db.from("jobs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: String(error?.message ?? error)
      }).eq("id", jobId);
    }
    return NextResponse.json({ error: String(error?.message ?? error) }, { status: 500 });
  }
}


