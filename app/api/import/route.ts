// app/api/import/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const IMPORT_SHARED_SECRET = process.env.IMPORT_SHARED_SECRET ?? "";
const DEV_USER_ID = (process.env.DEV_USER_ID ?? "").trim();

type ImportPayload = {
  requestId?: string;
  userEmail?: string;

  file?: {
    md5: string;
    name: string;
    original_name?: string;
    storage_path?: string;
    size_bytes?: number;
    course_id?: string | null;
    kind?: string;
    folder_id?: string | null;
  };

  ocr_texts?: Array<{ text: string; page?: number; engine?: string }>;

  notes?: Array<{ title?: string; content: string }>;

  flashcards?: Array<{ front?: string; back?: string; question?: string; answer?: string }>;

  quiz?:
    | {
        title?: string;
        questions: Array<{
          prompt: string;
          answers?: Array<{ label: string; is_correct?: boolean }>;
        }>;
      }
    | null;
};

type SB = ReturnType<typeof createClient>;

function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function checkAuth(req: NextRequest) {
  const xs = (req.headers.get("x-shared-secret") ?? "").trim();
  const auth = (req.headers.get("authorization") ?? "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return Boolean(IMPORT_SHARED_SECRET) && (xs === IMPORT_SHARED_SECRET || bearer === IMPORT_SHARED_SECRET);
}

function adminClient(): SB {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readJson(
  req: NextRequest,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, error: "Ugyldigt JSON-body." };
  }
}

function getErrMsg(e: unknown) {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (typeof e === "object" && "message" in e) return String((e as { message?: unknown }).message ?? "");
  return String(e);
}

function pickIdRow(data: unknown): { id: string } | null {
  if (!data) return null;

  if (Array.isArray(data)) {
    const first = data[0] as unknown;
    if (first && typeof first === "object" && "id" in first) return { id: String((first as any).id) };
    return null;
  }

  if (typeof data === "object" && "id" in data) {
    return { id: String((data as any).id) };
  }

  return null;
}

async function resolveOwnerId(sb: SB, userEmail?: string): Promise<string | null> {
  const email = (userEmail ?? "").trim();
  if (email) {
    const r1 = await sb.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!r1.error && r1.data && (r1.data as any).id) return String((r1.data as any).id);

    const r2 = await sb.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (!r2.error && r2.data && (r2.data as any).id) return String((r2.data as any).id);
  }

  return DEV_USER_ID || null;
}

async function safeJobUpdate(sb: SB, jobId: string, patch: Record<string, unknown>) {
  const r1 = await sb.from("jobs").update(patch).eq("id", jobId);
  if (!r1.error) return;

  const msg = String((r1.error as any)?.message ?? "");
  const retryPatch: Record<string, unknown> = { ...patch };

  if (msg.includes('column "started_at"') && "started_at" in retryPatch) delete retryPatch.started_at;
  if (msg.includes('column "finished_at"') && "finished_at" in retryPatch) delete retryPatch.finished_at;

  await sb.from("jobs").update(retryPatch).eq("id", jobId);
}

export async function GET() {
  return ok({ ok: true, route: "/api/import" }, 200);
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return fail("Unauthorized", 401);
  if (!IMPORT_SHARED_SECRET) return fail("Server config mangler (IMPORT_SHARED_SECRET).", 500);

  let sb: SB;
  try {
    sb = adminClient();
  } catch (e) {
    return fail("Server config mangler (Supabase env).", 500, { details: getErrMsg(e) });
  }

  const parsed = await readJson(req);
  if (!parsed.ok) return fail(parsed.error, 400);

  const payload = (parsed.value ?? {}) as ImportPayload;
  const requestId = (payload.requestId ?? "").trim() || `imp_${randomUUID()}`;

  const ownerId = await resolveOwnerId(sb, payload.userEmail);
  if (!ownerId) {
    return fail("Kunne ikke resolve owner_id (mangler bruger eller DEV_USER_ID).", 401, { requestId });
  }

  const jobInsert = await sb
    .from("jobs")
    .insert({
      owner_id: ownerId,
      kind: "import",
      status: "queued",
      queued_at: new Date().toISOString(),
      payload, // hele payload som før
      result: null,
      error: null,
    })
    .select("id")
    .single();

  if (jobInsert.error || !(jobInsert.data as any)?.id) {
    return fail("Failed to queue job", 500, {
      requestId,
      detail: String((jobInsert.error as any)?.message ?? "unknown"),
    });
  }

  const jobId = String((jobInsert.data as any).id);

  try {
    await safeJobUpdate(sb, jobId, { status: "started", started_at: new Date().toISOString() });

    const file = payload.file;
    if (!file?.md5 || !String(file.md5).trim()) throw new Error("payload.file.md5 mangler");

    const fileMd5 = String(file.md5).trim();
    const fileName = String(file.name ?? "file").trim() || "file";
    const courseId = file.course_id ?? null;
    const folderId = file.folder_id ?? null;

    const fileUpsert = await sb
      .from("files")
      .upsert(
        {
          owner_id: ownerId,
          md5: fileMd5,
          name: fileName,
          original_name: file.original_name ?? fileName,
          storage_path: file.storage_path ?? "",
          size_bytes: typeof file.size_bytes === "number" ? file.size_bytes : null,
          course_id: courseId,
          folder_id: folderId,
          kind: file.kind ?? "unknown",
        },
        { onConflict: "md5" },
      )
      .select("id")
      .maybeSingle();

    if (fileUpsert.error) throw new Error(`files upsert failed: ${fileUpsert.error.message}`);

    const picked = pickIdRow(fileUpsert.data);
    const fileId = picked?.id ?? null;

    if (payload.ocr_texts?.length) {
      await sb.from("ocr_texts").delete().eq("owner_id", ownerId).eq("file_md5", fileMd5);

      if (fileId) {
        const ocrRows = payload.ocr_texts.map((t, idx) => ({
          owner_id: ownerId,
          file_id: fileId,
          file_md5: fileMd5,
          text: String(t?.text ?? ""),
          engine: String(t?.engine ?? "google_docs_ocr"),
          page: typeof t?.page === "number" ? t.page : idx + 1,
        }));

        const ocrIns = await sb.from("ocr_texts").insert(ocrRows);
        if (ocrIns.error) throw new Error(`ocr_texts insert failed: ${ocrIns.error.message}`);
      }
    }

    if (fileId && payload.notes?.length) {
      await sb.from("notes").delete().eq("owner_id", ownerId).eq("file_id", fileId);

      const noteRows = payload.notes.map((n) => ({
        owner_id: ownerId,
        course_id: courseId,
        file_id: fileId,
        title: typeof n?.title === "string" && n.title.trim() ? n.title.trim() : null,
        content: String(n?.content ?? ""),
      }));

      const noteIns = await sb.from("notes").insert(noteRows);
      if (noteIns.error) throw new Error(`notes insert failed: ${noteIns.error.message}`);
    }

    if (fileId && payload.flashcards?.length) {
      await sb.from("flashcards").delete().eq("owner_id", ownerId).eq("file_id", fileId);

      const fcRows = payload.flashcards.map((f) => ({
        owner_id: ownerId,
        course_id: courseId,
        file_id: fileId,
        front: String(f?.front ?? f?.question ?? ""),
        back: String(f?.back ?? f?.answer ?? ""),
      }));

      const fcIns = await sb.from("flashcards").insert(fcRows);
      if (fcIns.error) throw new Error(`flashcards insert failed: ${fcIns.error.message}`);
    }

    if (payload.quiz?.questions?.length) {
      const title = (payload.quiz.title ?? "").trim() || `Quiz: ${fileName}`;

      let existingQuiz: { id: string } | null = null;

      if (courseId == null) {
        const r = await sb
          .from("quizzes")
          .select("id")
          .eq("owner_id", ownerId)
          .is("course_id", null)
          .eq("title", title)
          .maybeSingle();

        if (!r.error && (r.data as any)?.id) existingQuiz = { id: String((r.data as any).id) };
      } else {
        const r = await sb
          .from("quizzes")
          .select("id")
          .eq("owner_id", ownerId)
          .eq("course_id", courseId)
          .eq("title", title)
          .maybeSingle();

        if (!r.error && (r.data as any)?.id) existingQuiz = { id: String((r.data as any).id) };
      }

      if (existingQuiz?.id) {
        const qid = existingQuiz.id;

        const qq = await sb.from("quiz_questions").select("id").eq("quiz_id", qid);
        if (!qq.error && Array.isArray(qq.data) && qq.data.length) {
          const qIds = qq.data.map((r: any) => String(r.id)).filter(Boolean);
          if (qIds.length) await sb.from("quiz_answers").delete().in("question_id", qIds);
        }

        await sb.from("quiz_questions").delete().eq("quiz_id", qid);
        await sb.from("quizzes").delete().eq("id", qid).eq("owner_id", ownerId);
      }

      const qzIns = await sb
        .from("quizzes")
        .insert({ owner_id: ownerId, course_id: courseId, title })
        .select("id")
        .single();

      if (qzIns.error || !(qzIns.data as any)?.id) throw new Error(`quiz insert failed: ${qzIns.error?.message ?? "unknown"}`);
      const quizId = String((qzIns.data as any).id);

      const qRows = payload.quiz.questions.map((q) => ({ quiz_id: quizId, prompt: String(q.prompt ?? "") }));
      const qIns = await sb.from("quiz_questions").insert(qRows).select("id");

      if (qIns.error) throw new Error(`quiz_questions insert failed: ${qIns.error.message}`);

      const insertedIds = Array.isArray(qIns.data) ? qIns.data.map((r: any) => String(r.id)) : [];

      const aRows: Array<{ question_id: string; label: string; is_correct: boolean; owner_id: string }> = [];
      payload.quiz.questions.forEach((q, idx) => {
        const qId = insertedIds[idx];
        if (!qId) return;
        (q.answers ?? []).forEach((a) => {
          aRows.push({
            question_id: qId,
            label: String(a.label ?? ""),
            is_correct: Boolean(a.is_correct),
            owner_id: ownerId,
          });
        });
      });

      if (aRows.length) {
        const aIns = await sb.from("quiz_answers").insert(aRows);
        if (aIns.error) throw new Error(`quiz_answers insert failed: ${aIns.error.message}`);
      }
    }

    await safeJobUpdate(sb, jobId, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      result: { ok: true, requestId, ownerId, fileMd5 },
      error: null,
    });

    return ok({ ok: true, requestId }, 200);
  } catch (e) {
    const detail = getErrMsg(e) || "Import failed";

    await safeJobUpdate(sb, jobId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      result: null,
      error: { message: detail },
    });

    return fail("Import failed", 500, { requestId, detail });
  }
}
