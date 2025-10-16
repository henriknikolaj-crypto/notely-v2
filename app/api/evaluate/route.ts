/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type EvalBody = { question: string; answer: string; useContext?: boolean };

type Reference = {
  title: string;
  author?: string;
  year?: string;
  venue?: string;
  url?: string;
  peer_reviewed?: boolean;
};

// Straf korte/off-topic svar
function heuristicCap(question: string, answer: string): number {
  const a = (answer ?? "").trim();
  if (a.length < 30) return 20;
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-zæøå0-9\s]/gi, " ").split(/\s+/).filter(Boolean);
  const q = norm(question);
  const aSet = new Set(norm(answer));
  const overlap = q.filter((t) => aSet.has(t)).length / Math.max(1, q.length);
  if (overlap < 0.12) return 30;
  return 100;
}

// Lille kvalitets-boost for troværdige domæner/venues
function credibilityBoost(url?: string, venue?: string, title?: string): number {
  const s = ((url || "") + " " + (venue || "") + " " + (title || "")).toLowerCase();
  const dk = /(ku\.dk|au\.dk|sdu\.dk|ruc\.dk|aau\.dk|itu\.dk|cbs\.dk|\.dk\b|gyldendal|munksgaard)/;
  const nordic = /\.se\b|\.no\b|\.fi\b|\.is\b/;
  const topInt = /(doi\.org|springer|wiley|tandfonline|elsevier|sagepub|oup|cambridge|nature|science|cell|ieee|acm)/;
  let score = 0;
  if (dk.test(s)) score += 3;
  if (/[æøå]/i.test(s)) score += 2; // dansk sprogindikator
  if (nordic.test(s)) score += 1;
  if (topInt.test(s)) score += 1;
  return score;
}

export async function POST(req: Request) {
  try {
    const { question, answer, useContext } = (await req.json()) as EvalBody;
    const referencesEnabled = !!useContext; // toggle styrer KUN referencer

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (c) => {
            try {
              c.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options as CookieOptions)
              );
            } catch {}
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // HENT ALTID PRIVAT KONTEKST (til forståelse) — MÅ IKKE AFSLØRES
    let context = "";
    if (user?.id) {
      const { data } = await supabase
        .from("doc_chunks")
        .select("content")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);
      context = (data ?? []).map((d) => d.content).join("\n---\n").slice(0, 12000);
    }

    const sys = `Du er en erfaren universitetsunderviser.
BRUG KUN den PRIVATE CONTEXT til at forstå problemstillingen. Du MÅ IKKE citere eller nævne den,
medmindre references_enabled=true.
PRIVATE CONTEXT (DO NOT DISCLOSE):
${context || "(tom)"}

Bedøm elevens svar strengt (0–100) mht. korrekthed, klarhed, præcision og relevans i forhold til spørgsmålet.
Returnér KUN JSON i formatet:
{
  "score": 0-100,
  "feedback": "2-4 korte sætninger på dansk",
  "references": [ { "title": "", "author": "", "year": "", "venue": "", "url": "", "peer_reviewed": true|false } ] // udelad hvis references_disabled
}`;

    const userMsg = `Spørgsmål: ${question}
Svar: ${answer}

references_enabled: ${referencesEnabled ? "true" : "false"}
Hvis references_enabled=true: medtag 2–4 referencer. Prioritér peer-reviewed og (ved danske emner) troværdige danske kilder (dk-domæner, danske universiteter/forlag). Undgå fabrikerede kilder.`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
    });

    const content = resp.choices?.[0]?.message?.content ?? "{}";
    const match = content.match(/\{[\s\S]*\}/);
    let parsed: { score?: unknown; feedback?: unknown; references?: unknown } = {};
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as typeof parsed;
      } catch {}
    }

    // Score + cap
    let score = Number.isFinite(parsed?.score) ? Number(parsed!.score) : 0;
    score = Math.max(0, Math.min(100, score));
    const cap = heuristicCap(question, answer);
    score = Math.min(score, cap);

    // Feedback
    const feedback =
      typeof parsed?.feedback === "string" ? parsed.feedback : "Ingen feedback.";

    // Referencer – kun hvis referencesEnabled
    let references: Reference[] = [];
    if (referencesEnabled && Array.isArray(parsed?.references)) {
      references = (parsed.references as unknown[])
        .map((r) => {
          const v = r as Partial<Reference>;
          return {
            title: String(v.title ?? "").trim(),
            author: v.author ? String(v.author) : undefined,
            year: v.year ? String(v.year) : undefined,
            venue: v.venue ? String(v.venue) : undefined,
            url: v.url ? String(v.url) : undefined,
            peer_reviewed:
              typeof v.peer_reviewed === "boolean" ? v.peer_reviewed : undefined,
          } as Reference;
        })
        .filter((r) => r.title.length > 0);
    }

    // Sortér og vægt referencer: peer_reviewed + danske kilder først
    if (references.length) {
      references = references
        .map((r) => ({ r, __s: (r.peer_reviewed ? 4 : 0) + credibilityBoost(r.url, r.venue, r.title) }))
        .sort((a, b) => b.__s - a.__s)
        .slice(0, 4)
        .map(({ r }) => r);

      // Lille bonus hvis der findes stærke kilder
      const strong = references.some(
        (r) => r.peer_reviewed === true || credibilityBoost(r.url, r.venue, r.title) >= 3
      );
      if (strong) score = Math.min(100, Math.round(score * 1.05));
    }

    // Gem i DB
    let saved = false;
    let db_error: string | undefined;
    if (user?.id) {
      const { error } = await supabase.from("exam_sessions").insert({
        owner_id: user.id,
        question,
        answer,
        score,
        feedback,
        model: "gpt-4o-mini",
        doc_chunk_count: context ? context.split("---").length : 0,
      });
      saved = !error;
      db_error = error?.message;
    } else {
      db_error = "Not authenticated";
    }

    return NextResponse.json({ score, feedback, references, saved, db_error });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

