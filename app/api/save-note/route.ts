// app/api/save-note/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NoteType = "resume" | "focus" | "manual" | "other";

type SaveNoteRequest = {
  // new (preferred)
  title?: string | null;
  content?: string | null;

  sourceTitle?: string | null;
  sourceUrl?: string | null;

  folderId?: string | null;
  noteType?: NoteType | string | null;

  // backwards compat
  text?: string | null;
  source?: string | null;
};

function cleanStr(x: any): string | null {
  const s = typeof x === "string" ? x.trim() : "";
  return s.length ? s : null;
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

function normalizeNoteType(x: any): NoteType | null {
  const s = cleanStr(x)?.toLowerCase();
  if (!s) return null;
  if (s === "resume") return "resume";
  if (s === "focus") return "focus";
  if (s === "manual") return "manual";
  return "other";
}

function defaultTitleFor(noteType: NoteType | null, sourceTitle: string | null) {
  if (noteType === "focus") return sourceTitle ? `Fokus-noter – ${sourceTitle}` : "Fokus-noter";
  if (noteType === "resume") return sourceTitle ? `Resumé – ${sourceTitle}` : "Resumé";
  return sourceTitle ? `Note – ${sourceTitle}` : "Note";
}

export async function POST(req: NextRequest) {
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
    if (!isAuth) console.error("[save-note] requireUser crash:", e);
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await readJsonBody<SaveNoteRequest>(req);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const body = parsed.value ?? {};

  const content = cleanStr(body.content) ?? cleanStr(body.text);
  if (!content) {
    return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
  }

  const folderId = cleanStr(body.folderId);
  const sourceTitle = cleanStr(body.sourceTitle) ?? cleanStr(body.source);
  const sourceUrl = cleanStr(body.sourceUrl);

  const noteType = normalizeNoteType(body.noteType);
  const title = cleanStr(body.title) ?? defaultTitleFor(noteType, sourceTitle);

  try {
    const { data, error } = await sb
      .from("notes")
      .insert({
        owner_id: ownerId,
        title,
        content,
        folder_id: folderId,
        note_type: noteType,
        source_title: sourceTitle,
        source_url: sourceUrl,
      })
      .select("id,title,content,created_at,folder_id,note_type,source_title,source_url")
      .single();

    if (error || !data) {
      console.error("[save-note] insert error:", error);
      return NextResponse.json({ ok: false, error: "INSERT_FAILED" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, saved: true, note: data }, { status: 200 });
  } catch (e: any) {
    console.error("[save-note] handler crash:", e);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
