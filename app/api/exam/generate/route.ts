// app/api/exam/generate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

import { enforceRateLimit } from "@/lib/rateLimit";
import { createChatCompletion } from "@/lib/openai/buildRequest";
import { resolveModelForFeature } from "@/lib/openai/model";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";
type FocusMode = "normal" | "weakest";

type ExamGenerateRequest = {
  count?: number;
  difficulty?: Difficulty;
  maxContextChunks?: number;

  // mappe-scope (fra venstre menu / scope=... i URL)
  scopeFolderIds?: string[];
  folderId?: string | null;
  focusMode?: FocusMode;

  // anti-repeat fra klienten
  avoidQuestions?: string[];
};

type ExamQuestion = {
  id: string; // "q1", "q2", ...
  prompt: string;
};

type TrainerCitationPayload = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type ExamGenerateOk = {
  ok: true;
  questions: ExamQuestion[];
  citations: TrainerCitationPayload[];
  meta: {
    requestId: string;
    model: string;
    difficulty: Difficulty;
    scopeFolderIds: string[];
    usedFileIds: string[];
    usedChunkIds: string[];
    maxContextChunks: number;
    focusMode: FocusMode;
    biasApplied: boolean;
    focusTargets: Array<{ key: string; label: string }>;
    weakSessionCount: number;
  };
};

type ExamGenerateErr = {
  ok: false;
  error: string;
  requestId: string;
  code?: string;
  debug?: any;
};

type FileRow = {
  id: string;
  name: string | null;
  original_name: string | null;
  folder_id: string | null;
  created_at: string | null;
};

type ChunkRow = {
  id: string;
  file_id: string;
  content: string | null;
  created_at: string | null;
  source_url?: string | null;
};

type WeakPointTarget = {
  key: string;
  label: string;
  action?: string;
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function supabaseAdminOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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

function clampInt(raw: any, min: number, max: number, fallback: number) {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(max, Math.max(min, n));
}

function pickDifficulty(raw: any): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function pickFocusMode(raw: any): FocusMode {
  return raw === "weakest" ? "weakest" : "normal";
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

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p || p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

function normalizeQuestion(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
}

function normalizeWeakPointTarget(raw: unknown): WeakPointTarget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const keyRaw = String(obj.key ?? "").trim();
  const labelRaw = String(obj.label ?? "").trim();
  const actionRaw = String(obj.action ?? "").trim();

  const key = keyRaw || labelRaw.toLowerCase().replace(/\s+/g, "_").slice(0, 80);
  const label = labelRaw || keyRaw.replace(/_/g, " ");
  if (!key || !label) return null;

  const out: WeakPointTarget = { key, label };
  if (actionRaw) out.action = actionRaw;
  return out;
}

function deriveFocusTargetsFromWeakSessions(rows: Array<{ metadata: any }>): WeakPointTarget[] {
  const acc = new Map<string, { target: WeakPointTarget; weight: number }>();

  for (let i = 0; i < rows.length; i++) {
    const weight = i < 10 ? 2 : 1;
    const metadata = rows[i]?.metadata as Record<string, unknown> | null;
    const weakRaw = metadata?.weak_points;
    if (!Array.isArray(weakRaw)) continue;

    for (const item of weakRaw) {
      const normalized = normalizeWeakPointTarget(item);
      if (!normalized) continue;
      const existing = acc.get(normalized.key);
      if (existing) {
        existing.weight += weight;
      } else {
        acc.set(normalized.key, { target: normalized, weight });
      }
    }
  }

  return Array.from(acc.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((x) => x.target);
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  try {
    if (!process.env.OPENAI_API_KEY) {
      const err: ExamGenerateErr = { ok: false, error: "OPENAI_API_KEY mangler i .env.local.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    const parsed = await readJsonBody<ExamGenerateRequest>(req);
    if (!parsed.ok) {
      const err: ExamGenerateErr = { ok: false, error: parsed.error, requestId };
      return NextResponse.json(err, { status: 400 });
    }

    const body = parsed.value ?? {};
    const count = clampInt(body.count, 1, 15, 10);
    const difficulty = pickDifficulty(body.difficulty);
    const maxContextChunks = clampInt(body.maxContextChunks, 6, 40, 16);
    const requestedFocusMode = pickFocusMode(body.focusMode);

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const explicitFolderId = String(body.folderId ?? "").trim();
    const avoidQuestions = uniqTrimmed(body.avoidQuestions).slice(0, 60);
    const avoidNorm = new Set(avoidQuestions.map(normalizeQuestion));

    let effectiveFocusMode: FocusMode = requestedFocusMode;
    let focusScopeFolderId: string | null = null;
    if (requestedFocusMode === "weakest") {
      if (explicitFolderId) {
        focusScopeFolderId = explicitFolderId;
      } else if (scopeFolderIds.length === 1) {
        focusScopeFolderId = scopeFolderIds[0];
      } else {
        effectiveFocusMode = "normal";
      }
    }
    let focusTargets: WeakPointTarget[] = [];
    let weakSessionCount = 0;

    // Auth: session-first, read-only route client
    let ownerId = "";
    const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
    try {
      const sbAuth = supabaseServerRouteReadOnly(req);
      const { data: sessionData, error: sessionError } = await sbAuth.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

      if (sessionUserId) {
        ownerId = sessionUserId;
      } else {
        const { data: authData, error: authError } = await sbAuth.auth.getUser();
        if (!authError && authData?.user?.id) {
          ownerId = String(authData.user.id);
        } else {
          const err: ExamGenerateErr = {
            ok: false,
            error: "Unauthorized",
            requestId,
            ...(process.env.VERCEL_ENV === "preview"
              ? {
                  debug: {
                    hasSession: !!sessionData?.session,
                    sessionUserId,
                    sessionError: sessionError?.message ?? null,
                    getUserError: authError?.message ?? null,
                    cookieNames,
                  },
                }
              : {}),
          };
          return NextResponse.json(err, { status: 401 });
        }
      }
    } catch {
      const err: ExamGenerateErr = { ok: false, error: "Unauthorized", requestId };
      return NextResponse.json(err, { status: 401 });
    }

    // Rate-limit (fail-open)
    try {
      const rl = await enforceRateLimit(
        ownerId,
        "exam_generate",
        { limit: 3, windowSeconds: 60, minIntervalMs: 4000 },
        "Start eksamen",
      );
      if (!rl.ok) {
        const err: ExamGenerateErr = { ok: false, error: rl.message, requestId, code: "RATE_LIMIT" };
        return NextResponse.json(err, { status: rl.status });
      }
    } catch {
      // ignore
    }

    const admin = supabaseAdminOrNull();
    if (!admin) {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kræves til exam-route).",
        requestId,
      };
      return NextResponse.json(err, { status: 500 });
    }

    await ensureProfile(admin, ownerId);

    // Why: Eksamen skal håndhæves server-side som Pro-only, så client-bypass ikke virker.
    const { data: profile } = await admin.from("profiles").select("plan").eq("id", ownerId).maybeSingle();
    const plan = normalizePlan((profile as any)?.plan);
    if (plan !== "pro") {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Kræver Pro",
        code: "PRO_REQUIRED",
        requestId,
      };
      return NextResponse.json(err, { status: 403 });
    }

    if (effectiveFocusMode === "weakest" && focusScopeFolderId) {
      const { data: weakRows } = await admin
        .from("exam_sessions")
        .select("created_at,metadata")
        .eq("owner_id", ownerId)
        .eq("folder_id", focusScopeFolderId)
        .in("source_type", ["trainer", "simulator"])
        .not("metadata->weak_points", "is", null)
        .order("created_at", { ascending: false })
        .limit(25);

      const weakRowsArr = (weakRows ?? []) as Array<{ metadata: any }>;
      weakSessionCount = weakRowsArr.length;
      focusTargets = deriveFocusTargetsFromWeakSessions(weakRowsArr);
      if (focusTargets.length === 0) {
        effectiveFocusMode = "normal";
      }
    }

    // Hent filer i scope (eller alle hvis ingen scope)
    let filesQ = admin
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(120);

    if (scopeFolderIds.length > 0) filesQ = filesQ.in("folder_id", scopeFolderIds);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) {
      const err: ExamGenerateErr = { ok: false, error: "Kunne ikke hente filer.", requestId, debug: filesErr };
      return NextResponse.json(err, { status: 500 });
    }

    const fileRows = (files ?? []) as FileRow[];
    if (fileRows.length === 0) {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Ingen filer fundet i scope. Upload materiale først.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
    }

    // Vælg nogle filer for variation (max 6)
    const pickedFiles = shuffle(fileRows).slice(0, Math.min(6, fileRows.length));

    // Load chunks og byg kontekst
    const citations: TrainerCitationPayload[] = [];
    const usedFileIds: string[] = [];
    const usedChunkIds: string[] = [];

    const parts: string[] = [];

    // fordel chunks nogenlunde over filer
    const perFile = Math.max(2, Math.floor(maxContextChunks / Math.max(1, pickedFiles.length)));

    for (let i = 0; i < pickedFiles.length; i++) {
      const f = pickedFiles[i];
      const fileId = String(f.id);
      const title = fileTitle(f);

      const { data: pool } = await admin
        .from("doc_chunks")
        .select("id,file_id,content,created_at,source_url")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(350);

      const poolRows = (pool ?? []) as ChunkRow[];
      const nonEmpty = poolRows.filter((r) => (r.content ?? "").trim().length > 0);
      if (nonEmpty.length === 0) continue;

      const take = shuffle(nonEmpty).slice(0, Math.min(perFile, nonEmpty.length));
      if (take.length === 0) continue;

      usedFileIds.push(fileId);

      parts.push(`DOKUMENT ${i + 1}: ${title}`);
      parts.push("");

      for (const c of take) {
        const text = (c.content ?? "").trim();
        if (!text) continue;

        parts.push(text);
        parts.push("\n---\n");

        usedChunkIds.push(String(c.id));
        citations.push({
          chunkId: String(c.id),
          fileId,
          title,
          url: (c as any)?.source_url ? String((c as any).source_url) : null,
        });
      }
    }

    const contextText = parts.join("\n").slice(0, 16000).trim();
    if (!contextText) {
      const err: ExamGenerateErr = {
        ok: false,
        error: "Ingen kontekst fundet (doc_chunks). Tjek at upload/parse er kørt.",
        requestId,
        debug: { scopeFolderIds },
      };
      return NextResponse.json(err, { status: 400 });
    }

    const model = resolveModelForFeature("simulator");

    const avoidBlock =
      avoidQuestions.length > 0
        ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${avoidQuestions.join("\n- ")}\n`
        : "";
    const focusBiasBlock =
      effectiveFocusMode === "weakest" && focusTargets.length > 0
        ? [
            `Fokusér især på: ${focusTargets.map((t) => t.label).join(", ")}. Spørgsmålene skal træne disse områder.`,
            ...focusTargets
              .map((t) => (t.action ? `Hint - ${t.label}: ${t.action}` : ""))
              .filter(Boolean),
          ].join("\n")
        : "";
    const biasApplied = effectiveFocusMode === "weakest" && focusTargets.length > 0;

    const systemPrompt = `
Du skriver skriftlige eksamensspørgsmål på dansk.

KRAV:
- Spørgsmålene skal være varierede (redegør/analysér/diskutér/vurdér/argumentér).
- Spørgsmålene skal være tydeligt forankret i konteksten (DOKUMENT-afsnit).
- Ingen multiple choice.
- Ingen forklaringer udenfor JSON.
- Output SKAL være JSON og kun JSON.

FORMAT:
{"questions":[{"id":"q1","prompt":"..."},{"id":"q2","prompt":"..."}, ...]}
`.trim();

    const userPrompt = [
      `Antal spørgsmål: ${count}`,
      `Sværhedsgrad: ${difficulty}`,
      focusBiasBlock,
      avoidBlock.trim(),
      "",
      "KONTEKST (brug dette som eneste grundlag):",
      "",
      contextText,
      "",
      "Lav nu spørgsmålene.",
    ]
      .filter(Boolean)
      .join("\n");

    let outQuestions: ExamQuestion[] = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      const { completion } = await createChatCompletion(openai, {
        feature: "simulator",
        purpose: "json",
        modelOverride: model,
        payload: {
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.9,
          top_p: 0.95,
        },
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let payload: any = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = {};
      }

      const arr = Array.isArray(payload?.questions) ? payload.questions : [];
      const cleaned: ExamQuestion[] = [];

      for (const q of arr) {
        const prompt = String(q?.prompt ?? "").trim();
        if (!prompt) continue;

        const norm = normalizeQuestion(prompt);
        if (avoidNorm.has(norm)) continue;

        // undgå duplicates i samme response
        if (cleaned.some((x) => normalizeQuestion(x.prompt) === norm)) continue;

        cleaned.push({ id: "tmp", prompt });
        if (cleaned.length >= count) break;
      }

      if (cleaned.length > 0) {
        outQuestions = cleaned;
        break;
      }
    }

    if (outQuestions.length === 0) {
      const err: ExamGenerateErr = { ok: false, error: "Modellen returnerede tomt/ufuldstændigt output.", requestId };
      return NextResponse.json(err, { status: 500 });
    }

    // giv stabile ids q1..qN
    outQuestions = outQuestions.slice(0, count).map((q, idx) => ({
      id: `q${idx + 1}`,
      prompt: q.prompt,
    }));

    const resp: ExamGenerateOk = {
      ok: true,
      questions: outQuestions,
      citations,
      meta: {
        requestId,
        model,
        difficulty,
        scopeFolderIds,
        usedFileIds,
        usedChunkIds,
        maxContextChunks,
        focusMode: effectiveFocusMode,
        biasApplied,
        focusTargets: focusTargets.map((t) => ({ key: t.key, label: t.label })),
        weakSessionCount,
      },
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[exam/generate] route error:", requestId, err);
    const out: ExamGenerateErr = { ok: false, error: err?.message ?? "Uventet fejl i exam/generate.", requestId };
    return NextResponse.json(out, { status: 500 });
  }
}
