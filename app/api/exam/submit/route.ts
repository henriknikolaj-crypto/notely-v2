// app/api/exam/submit/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth";
import { calcSessionGrade } from "@/lib/grading/sessionGrade";
import { danish7ToScore100, type Danish7Grade } from "@/lib/grading/danish7";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type SubmitBody = {
  mode?: "written" | "oral";
  includeBackground?: boolean;

  durationMin?: number;
  startedAt?: number | null;
  endedAt?: number | null;

  scopeFolderIds?: string[];
  folderId?: string | null;

  questions: Array<{ id: string; prompt: string }>;
  answers: Record<string, string>;
};

type SubmitOk = {
  ok: true;
  requestId: string;
  result: {
    overall: {
      grade: string; // final grade (7-trins)
      summary: string;
      strengths: string[];
      improvements: string[];
    };
    // beholdes til senere (UI kan ignorere)
    items: Array<{
      id: string;
      grade: string;
      feedback: string;
    }>;
  };
};

type SubmitErr = {
  ok: false;
  requestId: string;
  error: string;
  debug?: any;
};

function supabaseAdminOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: false as const, error: "Tom request body." };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

function clampInt(raw: any, min: number, max: number, fallback: number) {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(max, Math.max(min, n));
}

function uniqTrimmed(ids: unknown) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ids) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

const ALLOWED_GRADES = new Set(["-3", "00", "02", "4", "7", "10", "12"]);

function normalizeGrade(raw: any): Danish7Grade {
  const s0 = String(raw ?? "").trim();
  if (ALLOWED_GRADES.has(s0)) return s0 as Danish7Grade;

  // små normaliseringer
  if (s0 === "0") return "00";
  if (s0 === "2") return "02";
  if (s0 === "+2") return "02";
  if (s0 === "04") return "4";

  const n = Number(s0);
  if (Number.isFinite(n)) {
    const asInt = Math.round(n);
    const mapped = String(asInt);
    if (ALLOWED_GRADES.has(mapped)) return mapped as Danish7Grade;
    if (asInt === 0) return "00";
    if (asInt === 2) return "02";
  }
  return "02";
}

function coerceStringArray(x: any, max = 6): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function pickPayload(json: any) {
  // accepter både {overall,items} og {result:{overall,items}}
  if (json?.overall && json?.items) return json;
  if (json?.result?.overall && json?.result?.items) return json.result;
  return json;
}

function isSamplingUnsupportedModel(model: string) {
  const m = (model || "").toLowerCase().trim();
  // o*-modeller (reasoning) understøtter typisk ikke temperature/top_p
  return /^o\d/.test(m) || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  try {
    if (!process.env.OPENAI_API_KEY) {
      const err: SubmitErr = { ok: false, requestId, error: "OPENAI_API_KEY mangler i .env.local." };
      return NextResponse.json(err, { status: 500 });
    }

    const parsed = await readJsonBody<SubmitBody>(req);
    if (!parsed.ok) {
      const err: SubmitErr = { ok: false, requestId, error: parsed.error };
      return NextResponse.json(err, { status: 400 });
    }

    const body = parsed.value ?? ({} as SubmitBody);

    // Auth (dev-bypass hvis requireUser understøtter det)
    let ownerId = "";
    try {
      const u: any = await requireUser(req);
      ownerId = u.id;
    } catch {
      const err: SubmitErr = { ok: false, requestId, error: "Unauthorized" };
      return NextResponse.json(err, { status: 401 });
    }

    // Validate
    const questions = Array.isArray(body.questions) ? body.questions : [];
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};

    if (questions.length === 0) {
      const err: SubmitErr = { ok: false, requestId, error: "Mangler questions." };
      return NextResponse.json(err, { status: 400 });
    }

    const answered = questions
      .map((q) => ({
        id: String(q.id ?? "").trim(),
        prompt: String(q.prompt ?? "").trim(),
        text: String(answers[String(q.id ?? "")] ?? "").trim(),
      }))
      .filter((x) => x.id && x.prompt && x.text.length > 0);

    if (answered.length === 0) {
      const err: SubmitErr = { ok: false, requestId, error: "Ingen svar at evaluere." };
      return NextResponse.json(err, { status: 400 });
    }

    const admin = supabaseAdminOrNull();
    if (!admin) {
      const err: SubmitErr = {
        ok: false,
        requestId,
        error: "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.",
      };
      return NextResponse.json(err, { status: 500 });
    }

    const durationMin = clampInt(body.durationMin, 5, 180, 20);

    // Scope → kontekst (MVP: nyeste chunks fra valgte mapper)
    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const folderId = body.folderId ? String(body.folderId) : null;
    const effectiveFolders = scopeFolderIds.length ? scopeFolderIds : folderId ? [folderId] : [];
    const sessionFolderId = effectiveFolders.length === 1 ? effectiveFolders[0] : null;
    const sessionFolderIdsMeta = effectiveFolders.length > 1 ? effectiveFolders : undefined;

    let filesQ = admin
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(60);

    if (effectiveFolders.length) filesQ = filesQ.in("folder_id", effectiveFolders);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) {
      const err: SubmitErr = { ok: false, requestId, error: "Kunne ikke hente filer til kontekst." };
      return NextResponse.json(err, { status: 500 });
    }

    const fileRows = (files ?? []) as any[];
    if (fileRows.length === 0) {
      const err: SubmitErr = { ok: false, requestId, error: "Ingen filer fundet i scope. Upload materiale først." };
      return NextResponse.json(err, { status: 400 });
    }

    const fileIds = fileRows.map((f) => String(f.id));

    const { data: chunks, error: chunksErr } = await admin
      .from("doc_chunks")
      .select("id,file_id,content,created_at")
      .eq("owner_id", ownerId)
      .in("file_id", fileIds.slice(0, 60))
      .order("created_at", { ascending: false })
      .limit(28);

    if (chunksErr) {
      const err: SubmitErr = { ok: false, requestId, error: "Kunne ikke hente doc_chunks." };
      return NextResponse.json(err, { status: 500 });
    }

    const chunkRows = (chunks ?? []) as Array<{ id: string; file_id: string; content: string | null }>;
    const chunksNonEmpty = chunkRows.filter((c) => (c.content ?? "").trim().length > 0);

    if (chunksNonEmpty.length === 0) {
      const err: SubmitErr = { ok: false, requestId, error: "Ingen kontekst fundet (doc_chunks). Tjek upload/parse." };
      return NextResponse.json(err, { status: 400 });
    }

    const fileById = new Map<string, any>(fileRows.map((f) => [String(f.id), f]));

    const contextText = chunksNonEmpty
      .map((c) => {
        const f = fileById.get(String(c.file_id));
        const title = fileTitle(f);
        return `KILDE: ${title}\n\n${(c.content ?? "").trim()}`;
      })
      .join("\n\n---\n\n")
      .slice(0, 14000);

    // Hidden from UI: default true hvis client ikke sender feltet
    const includeBackground = body.includeBackground ?? true;

    const mode = body.mode === "oral" ? "oral" : "written";

    const system = [
      "Du er en dansk censor.",
      mode === "oral" ? "Du vurderer en mundtlig eksamensbesvarelse." : "Du vurderer elevens skriftlige besvarelser.",
      "Du vurderer PRIMÆRT ud fra materialet (KILDE).",
      includeBackground
        ? "Du må gerne supplere med baggrundsviden, men kun hvis det støtter og ikke modsiger materialet."
        : "Du må kun bruge materialet (KILDE) som grundlag.",
      "Brug den danske 7-trins-skala: -3, 00, 02, 4, 7, 10, 12.",
      "Vær eksamens-agtig: giv både ros OG konkrete forbedringer.",
      "Hvis du giver 4 eller 02, skal du nævne tydelige faglige mangler (begreber, præcision, argumentation, eksempler fra kilder).",
      "Hvis feedback er overvejende positiv og kun små rettelser → giv ikke under 7.",
      "Returnér KUN gyldig JSON. Ingen tekst udenfor JSON.",
      'Format: {"overall":{"quality_grade":"7","summary":"...","strengths":["..."],"improvements":["..."]},"items":[{"id":"q1","grade":"7","feedback":"..."}]}',
      "items[].feedback skal være 4-8 linjer og indeholde mindst 1 konkret forbedring.",
      "overall.summary skal være 6-10 linjer og opsummere niveau, mangler og hvad der skal til for et højere trin.",
    ].join(" ");

    const qaBlock = answered
      .map((x, i) => {
        return [
          `# Spørgsmål ${i + 1} (id=${x.id})`,
          `SPØRGSMÅL: ${x.prompt}`,
          `SVAR: ${x.text}`,
        ].join("\n");
      })
      .join("\n\n");

    const user = [
      "MATERIALE (KILDE):",
      contextText,
      "",
      "BESVARELSER:",
      qaBlock,
      "",
      "VIGTIGT:",
      "- Sæt overall.quality_grade ud fra kvaliteten af de besvarede svar (ignorer hvor mange der er besvaret).",
      "- overall.summary skal være længere og censor-agtig.",
      "- Medtag både strengths og improvements (mindst 3 improvements hvis karakter < 12).",
    ].join("\n");

    const model = process.env.OPENAI_MODEL_EXAM || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    const base: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      response_format: { type: "json_object" },
      messages,
    };

    const completion = await openai.chat.completions.create(
      isSamplingUnsupportedModel(model)
        ? base
        : {
            ...base,
            temperature: 0.2,
            top_p: 0.9,
          },
    );

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let payload: any = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }

    payload = pickPayload(payload);

    const overallIn = payload?.overall ?? {};
    const itemsIn = Array.isArray(payload?.items) ? payload.items : [];

    const qualityGrade = normalizeGrade(overallIn.quality_grade ?? overallIn.qualityGrade ?? overallIn.grade);
    const strengths = coerceStringArray(overallIn.strengths, 6);
    const improvements = coerceStringArray(overallIn.improvements, 6);

    const answeredCount = answered.length;

    // finalGrade = qualityGrade justeret for dækning (kun i tekst + final karakter)
    const sg = calcSessionGrade({
      qualityGrade,
      answeredCount,
      minutes: durationMin,
      paceMinPerQ: 3,
      coverageWeight: 0.25,
      forceDowngradeIfIncomplete: true,
    });

    const finalGrade = (sg.finalGrade ?? qualityGrade) as Danish7Grade;

    let summary = String(overallIn.summary ?? "").trim();

    // Fallback hvis modellen “glemmer” overall.summary
    if (!summary) {
      summary =
        "Samlet vurdering: Besvarelsen viser faglig forståelse, men der mangler en tydeligere kobling til materialet og mere præcise begreber/eksempler for at løfte niveauet.";
    }

    // Tilføj dækning i evalueringen (ikke som UI-tæller)
    if (answeredCount > 0) {
      summary += `\n\nDækning: Du besvarede ${answeredCount} ud af ca. ${sg.plannedQuestions} forventede spørgsmål på ${durationMin} min.`;
    }

    // Map items (UI kan ignorere)
    const byId = new Map<string, any>();
    for (const it of itemsIn) {
      const id = String(it?.id ?? "").trim();
      if (!id) continue;
      byId.set(id, it);
    }

    const items = answered.map((a) => {
      const it = byId.get(a.id) ?? {};
      const grade = normalizeGrade(it.grade ?? qualityGrade);
      let feedback = String(it.feedback ?? "").trim();
      if (!feedback) {
        feedback =
          "Vurdering: Svaret har relevante elementer, men mangler flere konkrete koblinger til kilderne og en tydeligere faglig struktur. Tilføj flere præcise begreber og mindst ét konkret eksempel.";
      }
      return { id: a.id, grade, feedback };
    });

    const out: SubmitOk = {
      ok: true,
      requestId,
      result: {
        overall: {
          grade: String(finalGrade),
          summary,
          strengths,
          improvements,
        },
        items,
      },
    };

    // Best-effort: gem exam_session (stabilt scope)
    try {
      const sourceType = mode === "oral" ? "oral" : "simulator";
      const score = danish7ToScore100(finalGrade);

      const { error: insertError } = await admin.from("exam_sessions").insert({
        owner_id: ownerId,
        score,
        folder_id: sessionFolderId,
        source_type: sourceType,
        meta: {
          mode,
          includeBackground,
          durationMin,
          startedAt: body.startedAt ?? null,
          endedAt: body.endedAt ?? null,
          answeredCount,
          qualityGrade,
          finalGrade,
          scopeFolderIds,
          ...(sessionFolderIdsMeta ? { folder_ids: sessionFolderIdsMeta } : {}),
        },
      });

      if (insertError) {
        console.error("[exam/submit] exam_sessions insert error:", insertError);
      }
    } catch (e) {
      console.error("[exam/submit] exam_sessions insert crash:", e);
    }

    return NextResponse.json(out, { status: 200 });
  } catch (err: any) {
    console.error("[exam/submit] route error:", requestId, err);
    const out: SubmitErr = { ok: false, requestId, error: err?.message ?? "Uventet fejl i exam/submit." };
    return NextResponse.json(out, { status: 500 });
  }
}
