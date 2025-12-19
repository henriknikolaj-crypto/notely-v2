// app/api/generate-question/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

type GenerateQuestionRequest = {
  folderId?: string | null;
  scopeFolderIds?: string[];
  difficulty?: Difficulty;
  maxContextChunks?: number; // total chunks in context (across files)
};

type GenerateQuestionResponse = {
  ok: true;
  question: string;
  topic: string;
  folder_id: string | null;
  note_id: string | null;
  usedFileId: string | null; // “primary” file (for rotation/debug/backwards compat)
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true as const, value: {} as T };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

function pickDifficulty(raw: any): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function uniqTrimmed(ids: string[]) {
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

function scopeKeyFromFolderIds(folderIds: string[]) {
  const ids = uniqTrimmed(folderIds).sort();
  return ids.length ? `folders:${ids.join(",")}` : "all";
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadLastUsedFileId(sb: any, ownerId: string, scopeKey: string): Promise<string | null> {
  try {
    const { data } = await sb
      .from("generation_state")
      .select("last_used_file_id")
      .eq("owner_id", ownerId)
      .eq("kind", "question")
      .eq("scope_key", scopeKey)
      .maybeSingle();

    const v = (data as any)?.last_used_file_id;
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function saveLastUsedFileId(sb: any, ownerId: string, scopeKey: string, fileId: string) {
  try {
    await sb.from("generation_state").upsert(
      {
        owner_id: ownerId,
        kind: "question",
        scope_key: scopeKey,
        last_used_file_id: fileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,kind,scope_key" },
    );
  } catch {
    // ignore
  }
}

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
};

function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

function interleavePicked(
  fileOrder: string[],
  pickedByFile: Record<string, ChunkRow[]>,
  targetTotal: number,
) {
  const idx = new Map<string, number>();
  const out: ChunkRow[] = [];
  for (const f of fileOrder) idx.set(f, 0);

  while (out.length < targetTotal) {
    let added = false;
    for (const f of fileOrder) {
      const list = pickedByFile[f] ?? [];
      const i = idx.get(f) ?? 0;
      if (i < list.length) {
        out.push(list[i]);
        idx.set(f, i + 1);
        added = true;
        if (out.length >= targetTotal) break;
      }
    }
    if (!added) break;
  }

  return out;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY mangler i .env.local." }, { status: 500 });
    }

    const parsed = await readJsonBody<GenerateQuestionRequest>(req);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

    const body = parsed.value ?? {};
    const difficulty = pickDifficulty(body.difficulty);

    const rawMax = body.maxContextChunks;
    const maxContextChunks =
      typeof rawMax === "number" && Number.isFinite(rawMax)
        ? Math.min(Math.max(Math.round(rawMax), 4), 32)
        : 12;

    const folderId =
      typeof body.folderId === "string" && body.folderId.trim() ? body.folderId.trim() : null;

    const scopeFolderIds = Array.isArray(body.scopeFolderIds)
      ? uniqTrimmed(body.scopeFolderIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0))
      : [];

    const effectiveFolderIds = scopeFolderIds.length > 0 ? scopeFolderIds : folderId ? [folderId] : [];
    const scopeKey = scopeKeyFromFolderIds(effectiveFolderIds);

    // Auth/dev-bypass via requireUser(req)
    let sb: any;
    let ownerId = "";
    try {
      const u = await requireUser(req);
      sb = u.sb;
      ownerId = u.id;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const isAuth = msg.toLowerCase().includes("unauthorized");
      if (!isAuth) console.error("[generate-question] requireUser crash:", e);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const lastUsed = await loadLastUsedFileId(sb, ownerId, scopeKey);

    // Topic (mappe-navn hvis muligt)
    let topic = "pensum";
    if (effectiveFolderIds.length > 0) {
      const { data: f } = await sb
        .from("folders")
        .select("name")
        .eq("owner_id", ownerId)
        .eq("id", effectiveFolderIds[0])
        .maybeSingle();
      if (f?.name) topic = String(f.name);
    }

    // Filer i scope (flere for variation)
    let filesQ = sb
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(60);

    if (effectiveFolderIds.length > 0) filesQ = filesQ.in("folder_id", effectiveFolderIds);

    const { data: files, error: filesErr } = await filesQ;
    if (filesErr) console.error("[generate-question] files error:", filesErr);

    const fileRows = (files ?? []) as FileRow[];

    // Hvis ingen filer: fallback til generelt spørgsmål
    if (fileRows.length === 0) {
      const model = process.env.OPENAI_MODEL_QUESTION || process.env.OPENAI_MODEL || "gpt-4o-mini";

      const systemPrompt = `
Du er en dansk studieassistent, der skriver eksamenslignende spørgsmål.

Skriv ALT på dansk.
Returnér som gyldig JSON: { "question": "..." }
      `.trim();

      const completion = await openai.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({ topic, difficulty }) },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let question = "";
      try {
        question = (JSON.parse(raw) as any)?.question?.trim?.() ?? "";
      } catch {
        question = "";
      }
      if (!question) {
        question = `Forklar et centralt begreb fra ${topic}, og vis hvordan det kan bruges analytisk på et konkret eksempel.`;
      }

      const resp: GenerateQuestionResponse = {
        ok: true,
        question,
        topic,
        folder_id: folderId,
        note_id: null,
        usedFileId: null,
      };
      return NextResponse.json(resp, { status: 200 });
    }

    // Rotation: start efter lastUsed (så vi ikke “låser” på én fil)
    let start = 0;
    if (lastUsed) {
      const idx = fileRows.findIndex((f) => String(f.id) === String(lastUsed));
      if (idx >= 0) start = (idx + 1) % fileRows.length;
    }
    const rotated = [...fileRows.slice(start), ...fileRows.slice(0, start)];

    // Hvor mange filer vil vi blande?
    const desiredFiles = Math.min(6, Math.max(2, Math.ceil(maxContextChunks / 3)), rotated.length);
    const scanMax = Math.min(24, rotated.length);

    const pickedByFile: Record<string, ChunkRow[]> = {};
    const usedFiles: FileRow[] = [];

    const perFileTake = Math.max(2, Math.ceil(maxContextChunks / desiredFiles));
    const perFilePool = Math.min(100, Math.max(24, perFileTake * 10));

    // Scan filer indtil vi har nok “ikke-tomme”
    for (const f of rotated.slice(0, scanMax)) {
      if (usedFiles.length >= desiredFiles) break;

      const fileId = String(f.id);

      const { data: pool, error: poolErr } = await sb
        .from("doc_chunks")
        .select("id,file_id,content,created_at")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .order("created_at", { ascending: false })
        .limit(perFilePool);

      if (poolErr) {
        console.error("[generate-question] doc_chunks pool error:", poolErr);
        continue;
      }

      const poolRows = (pool ?? []) as ChunkRow[];
      const nonEmpty = poolRows.filter((r) => (r.content ?? "").trim().length > 0);
      if (nonEmpty.length === 0) continue;

      const picked = shuffle(nonEmpty)
        .slice(0, Math.min(perFileTake, nonEmpty.length))
        .sort((a, b) => {
          const ta = a.created_at ? Date.parse(a.created_at) : 0;
          const tb = b.created_at ? Date.parse(b.created_at) : 0;
          return ta - tb;
        });

      pickedByFile[fileId] = picked;
      usedFiles.push(f);
    }

    if (usedFiles.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ingen kontekst fundet (doc_chunks) for filerne i scope. Tjek at upload/parse er kørt.",
          debug: { effectiveFolderIds, fileCount: fileRows.length },
        },
        { status: 400 },
      );
    }

    const fileMap = new Map<string, FileRow>(usedFiles.map((f) => [String(f.id), f]));
    const fileOrder = shuffle(usedFiles.map((f) => String(f.id)));

    const interleaved = interleavePicked(fileOrder, pickedByFile, maxContextChunks);

    const contextText = interleaved
      .map((c) => {
        const f = fileMap.get(String(c.file_id));
        const title = f ? fileTitle(f) : "Ukendt kilde";
        const txt = (c.content ?? "").trim();
        return `KILDE: ${title}\n\n${txt}`;
      })
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, 9000);

    // “primary” file (rotation state)
    const usedFileId = String(usedFiles[0]?.id ?? "");

    const model = process.env.OPENAI_MODEL_QUESTION || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const systemPrompt = `
Du er en dansk studieassistent, der skriver eksamenslignende spørgsmål.

VIGTIGT:
- Hvis der er "context", så lav et spørgsmål der kan besvares ud fra teksten.
- Konteksten kan indeholde flere KILDE-afsnit (flere filer).
- Skriv ALT på dansk.

Returnér som gyldig JSON:
{ "question": "..." }
    `.trim();

    const userPayload = { topic, difficulty, context: contextText };

    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let question = "";
    try {
      const j = JSON.parse(raw) as { question?: string };
      question = (j.question ?? "").trim();
    } catch {
      question = "";
    }

    if (!question) {
      question = `Forklar et centralt begreb fra ${topic}, og vis hvordan det kan bruges analytisk på et konkret eksempel.`;
    }

    if (usedFileId) await saveLastUsedFileId(sb, ownerId, scopeKey, usedFileId);

    const resp: GenerateQuestionResponse = {
      ok: true,
      question,
      topic,
      folder_id: folderId,
      note_id: null,
      usedFileId: usedFileId || null,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[generate-question] route error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Uventet fejl i generate-question." },
      { status: 500 },
    );
  }
}
