import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { withAutoRanking } from "@/lib/retrieval/withAutoRanking";

/**
 * Hent bruger-id på en robust måde.
 * 1) Prøv Supabase auth (cookie-session / rigtig login).
 * 2) Ellers fallback til DEV_USER_ID i .env.local (lokal dev).
 */
async function getOwnerId(sb: any) {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    /* ignore auth errors */
  }
  return process.env.DEV_USER_ID ?? null;
}

/**
 * gradeAnswer:
 * - Sender spørgsmål+svar til modellen.
 * - Forventer JSON med { score, feedback }.
 * - Hvis noget fejler (eller ingen OPENAI_API_KEY), bruger vi fallback.
 */
async function gradeAnswer({
  question,
  answer,
}: {
  question: string;
  answer: string;
}): Promise<{ score: number; feedback: string; usedFallback: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  if (apiKey) {
    try {
      const chatResp = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "Du er en dansk eksaminator. Du bedømmer elevens skriftlige svar. " +
                  "Du giver både en tal-score (0-100) og kort, konkret, pædagogisk feedback.",
              },
              {
                role: "user",
                content:
                  "Spørgsmål:\n" +
                  question +
                  "\n\nElevens svar:\n" +
                  answer +
                  "\n\nLav JSON med præcis denne struktur:\n" +
                  '{ "score": <tal 0-100>, "feedback": "2-4 korte sætninger med forbedringsforslag på dansk" }',
              },
            ],
            temperature: 0.2,
          }),
        }
      );

      if (!chatResp.ok) {
        const t = await chatResp.text();
        throw new Error(
          `chat.completions fejlede (${chatResp.status}): ${t ?? "(ingen body)"}`
        );
      }

      const chatJson = (await chatResp.json()) as any;
      const rawText =
        chatJson?.choices?.[0]?.message?.content ??
        JSON.stringify(chatJson, null, 2);

      let parsed: any = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // fallback: prøv at fiske første {...} objekt ud af teksten
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        }
      }

      const scoreNum = Number(parsed.score);
      const fbText =
        typeof parsed.feedback === "string"
          ? parsed.feedback
          : "Kunne ikke udtrække feedback.";

      if (!Number.isNaN(scoreNum) && fbText) {
        return {
          score: Math.max(0, Math.min(100, Math.round(scoreNum))),
          feedback: fbText,
          usedFallback: false,
        };
      }

      throw new Error(
        "Kunne ikke parse chat.completions-output til JSON med {score, feedback}."
      );
    } catch (err) {
      console.error("OpenAI chat.completions-fejl:", err);
      // falder igennem til fallback nedenfor
    }
  }

  // Lokal fallback (hvis vi ikke kunne kalde modellen eller parse svaret)
  const defaultScore = 62;
  const defaultFb =
    "Foreløbig vurdering: Du er på et stabilt udgangspunkt. " +
    "Prøv at være mere præcis i dine forklaringer og brug konkrete begreber. " +
    "Fokuser især på at binde dine pointer tydeligt til spørgsmålet.";

  return {
    score: defaultScore,
    feedback: defaultFb,
    usedFallback: true,
  };
}

/**
 * Små helpers til citations
 */
function badgeForSourceType(source_type: string | null | undefined) {
  if (!source_type) return "";
  if (source_type === "user_note") return "Egne noter";
  if (source_type === "official") return "Officiel kilde";
  if (source_type === "peer_reviewed") return "Peer-reviewed";
  return "";
}

function buildRelationText({
  question,
  sourceTitle,
}: {
  question: string;
  sourceTitle: string;
}) {
  return (
    "Understøtter dit svar på spørgsmålet '" +
    question +
    "' ved at uddybe eller dokumentere '" +
    sourceTitle +
    "'. Du kan bruge den som reference i en mundtlig eksamen for at vise, at din forklaring bygger på faglig/autoritetbaseret viden – ikke kun din egen formulering."
  );
}

/**
 * POST /api/evaluate
 *
 * Body forventes:
 * {
 *   folder_id?: string,
 *   question: string,
 *   answer: string,
 *   includeBackground: boolean,        // eleven vil have kilder
 *   preferAcademicSources: boolean,    // vi gemmer bare signalet
 *   selected_note_ids?: string[]       // (fremtid)
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   sessionId: string | null,
 *   score: number,
 *   feedback: string,
 *   citations: Array<{ title: string, url: string, badge: string, relation: string }>
 * }
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Mangler ownerId (hverken login eller DEV_USER_ID sat).",
      },
      { status: 401 }
    );
  }

  // === Læs body ===
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* tom/ugyldig body */
  }

  const question = typeof body.question === "string" ? body.question : "";
  const answer = typeof body.answer === "string" ? body.answer : "";
  const folder_id =
    typeof body.folder_id === "string" ? body.folder_id : undefined;

  // checkbox i UI
  const includeBackground = !!body.includeBackground;
  // vores interne signal om at vi foretrækker seriøse kilder
  const preferAcademicSources = !!body.preferAcademicSources;

  // fremtid: valgte noter
  const selected_note_ids = Array.isArray(body.selected_note_ids)
    ? body.selected_note_ids.filter((x: any) => typeof x === "string")
    : [];

  if (!question || !answer) {
    return NextResponse.json(
      {
        ok: false,
        error: "question/answer mangler",
      },
      { status: 400 }
    );
  }

  // === 1) Scor elevens svar
  const graded = await gradeAnswer({ question, answer });

  // === 2) Retrieval fra elevens eget materiale / verified sources
  // Normaliser returnværdi fra withAutoRanking til en array
  let rankedRaw: any = null;
  if (includeBackground) {
    try {
      const TOP_K = 6;
      rankedRaw = await withAutoRanking(
        sb,
        {
          ownerId,
          folderId: folder_id || null,
          question,
          preferAcademicSources,
        },
        TOP_K
      );
    } catch (retrievalErr) {
      console.error("withAutoRanking fejl:", retrievalErr);
      rankedRaw = null;
    }
  }

  let rankedArray: any[] = [];
  if (Array.isArray(rankedRaw)) {
    rankedArray = rankedRaw;
  } else if (rankedRaw && Array.isArray(rankedRaw.items)) {
    rankedArray = rankedRaw.items;
  } else if (rankedRaw && Array.isArray(rankedRaw.chunks)) {
    rankedArray = rankedRaw.chunks;
  }

  const topChunks = rankedArray.slice(0, 3);

  // citations fra brugerens eget materiale / verified sources
  let citations: Array<{
    title: string;
    url: string;
    badge: string;
    relation: string;
  }> = includeBackground
    ? topChunks.map((chunk: any) => {
        const sourceTitle =
          chunk.source_title ||
          chunk.title ||
          "Kilde (uden titel)";

        const sourceUrl = chunk.source_url || chunk.url || "";

        const badge = badgeForSourceType(chunk.source_type);

        const relation = buildRelationText({
          question,
          sourceTitle,
        });

        return {
          title: sourceTitle,
          url: sourceUrl,
          badge,
          relation,
        };
      })
    : [];

  // === 2b) Ekstern autoritativ baggrund (AI)
  //
  // Dette er din “jeg vil gerne lyde som 12-tals-elev til eksamen”-funktion:
  // Vi spørger modellen om 1-2 seriøse baggrundskilder (bog eller officiel org),
  // med forfatter/org og evt. domæne, og en kort relationstekst.
  //
  if (includeBackground) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

    if (apiKey) {
      try {
        const fallbackResp = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "system",
                  content:
                    "Du hjælper en dansk elev til mundtlig eksamen. " +
                    "Din opgave er at foreslå 1-2 autoritative baggrundskilder, " +
                    "der kan bruges til at underbygge elevens svar fagligt. " +
                    "Kilderne MÅ KUN være enten:\n" +
                    "  - en anerkendt fagbog / lærebog (giv titel og evt. forfatter(e)), ELLER\n" +
                    "  - en officiel/seriøs institutionel kilde (fx Sundhedsstyrelsen, WHO) med et kendt domæne.\n" +
                    "Du må IKKE opfinde DOI'er, sidetal eller tilfældige artikler. " +
                    "Hvis du ikke er sikker på et specifikt navn, brug en generisk lærebogsreference som 'standardlærebøger i human fysiologi (fx Guyton & Hall)'. " +
                    "Brug kun domæner du med høj sikkerhed kender, fx who.int eller sundhedsstyrelsen.dk.",
                },
                {
                  role: "user",
                  content:
                    "Spørgsmålet eleven svarer på er:\n" +
                    question +
                    "\n\nElevens svar var:\n" +
                    answer +
                    "\n\nLav et JSON-array med 1-2 elementer. Hvert element SKAL have:\n" +
                    '{ "title": "...", "author_or_org": "...", "url": "...", "relation": "..." }\n' +
                    "title = bogtitel ELLER emnet/navnet på den officielle kilde.\n" +
                    "author_or_org = hvis bog: forfatter(e). Hvis officiel kilde: navnet på organisationen (fx WHO / Sundhedsstyrelsen).\n" +
                    'url = enten tom streng "" (hvis bog), ELLER et kort domæne-link hvis det er officiel kilde (fx \"who.int\" eller \"sundhedsstyrelsen.dk\").\n' +
                    "relation = én kort sætning der forklarer, hvordan denne kilde underbygger elevens svar fagligt til eksamen.\n" +
                    "Ingen ekstra tekst uden for JSON.",
                },
              ],
              temperature: 0.2,
            }),
          }
        );

        if (fallbackResp.ok) {
          const fallbackJson = await fallbackResp.json();
          const raw = fallbackJson?.choices?.[0]?.message?.content ?? "[]";

          let parsedList: any[] = [];
          try {
            parsedList = JSON.parse(raw);
          } catch {
            const match = raw.match(/\[[\s\S]*\]/);
            if (match) {
              parsedList = JSON.parse(match[0]);
            }
          }

          // læg eksterne (AI) kilder ind i citations-listen
          for (const ext of parsedList.slice(0, 2)) {
            const t = (ext.title || "").trim();
            const a = (ext.author_or_org || "").trim();
            const u = (ext.url || "").trim();
            const r = (ext.relation || "").trim();

            // vis f.eks. "Textbook of Medical Physiology (Guyton & Hall)"
            let displayTitle = t;
            if (a) {
              displayTitle = `${t} (${a})`;
            }

            const displayUrl = u; // kan være "" for bøger

            // undgå at duplikere samme titel to gange
            const already = citations.find(
              (c) =>
                c.title.toLowerCase().trim() ===
                displayTitle.toLowerCase().trim()
            );
            if (already) continue;

            citations.push({
              title: displayTitle || "Ekstern kilde",
              url: displayUrl,
              badge: "Ekstern baggrund (AI)",
              relation:
                r ||
                "Understøtter dine pointer med anerkendt baggrundsviden.",
            });
          }
        }
      } catch (err) {
        console.error("AI fallback citations (ekstern baggrund) fejlede:", err);
      }
    }
  }

  // === 3) meta til DB
  const metaPayload = {
    folder_id: folder_id ?? null,
    selected_note_ids,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    usedFallback: graded.usedFallback,
    latency_ms: Date.now() - startedAt,

    includeBackground,
    preferAcademicSources,

    // lille snapshot af citations (uden relation-tekst) så vi kan inspicere senere
    citationsShort: citations.map((c) => ({
      title: c.title,
      badge: c.badge,
      url: c.url,
    })),
  };

  // === 4) Gem i exam_sessions
  let insertedId: string | null = null;

  const { data: insertData, error: insertErr } = await sb
    .from("exam_sessions")
    .insert([
      {
        owner_id: ownerId,
        question,
        answer,
        feedback: graded.feedback,
        score: graded.score,
        meta: metaPayload,
      },
    ])
    .select("id")
    .single();

  if (insertErr) {
    console.error("Kunne ikke indsætte i exam_sessions:", insertErr);
  } else {
    insertedId = insertData?.id ?? null;
  }

  // === 5) Svar til klient
  return NextResponse.json(
    {
      ok: true,
      sessionId: insertedId,
      score: graded.score,
      feedback: graded.feedback,
      citations, // bruges i UI under "Baggrundskilder brugt i vurderingen"
    },
    { status: 200 }
  );
}
