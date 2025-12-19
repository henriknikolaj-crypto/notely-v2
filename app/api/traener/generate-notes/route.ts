// app/api/traener/generate-notes/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "resume" | "golden";
type NoteType = "resume" | "focus";

function asNonEmpty(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function safeTitle(base: string, suffix?: string | null) {
  const s = (suffix ?? "").trim();
  return s ? `${base} – ${s}` : base;
}

function makeStubContent(mode: Mode, fileName?: string | null) {
  const label = fileName ? `**${fileName}**` : "dit materiale";
  if (mode === "golden") {
    return (
      `• Dette er fokus-noter (stub) baseret på ${label}.\n` +
      `• Når vi kobler modellen rigtigt på, genereres punkterne ud fra selve indholdet.\n`
    );
  }
  return (
    `Dette er et kort resumé (stub) baseret på ${label}.\n` +
    `Når vi kobler modellen rigtigt på, genereres teksten ud fra selve indholdet.\n`
  );
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
    if (!isAuth) console.error("[generate-notes] requireUser crash:", e);
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Parse JSON (robust)
  let body: any = null;
  try {
    const raw = (await req.text()).trim();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const modeRaw = asNonEmpty(body?.mode);
  const mode: Mode = modeRaw === "golden" ? "golden" : "resume";
  const note_type: NoteType = mode === "golden" ? "focus" : "resume";

  const folderId = asNonEmpty(body?.folderId ?? body?.folder_id);
  if (folderId && !isUuidLike(folderId)) {
    return NextResponse.json({ ok: false, error: "INVALID_FOLDER_ID" }, { status: 400 });
  }

  const fileName = asNonEmpty(body?.fileName ?? body?.file_name ?? body?.filename ?? body?.name);

  const titleBase = mode === "golden" ? "Fokus-noter" : "Resumé";
  const title = safeTitle(titleBase, fileName);

  const content = makeStubContent(mode, fileName);

  // (valgfrit men godt) verificér at folder tilhører owner hvis folderId er sat
  if (folderId) {
    const { data: folder, error: folderErr } = await sb
      .from("training_folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("id", folderId)
      .maybeSingle();

    if (folderErr) {
      console.error("[generate-notes] folder lookup error:", folderErr);
      return NextResponse.json({ ok: false, error: "FOLDER_LOOKUP_FAILED" }, { status: 500 });
    }
    if (!folder?.id) {
      return NextResponse.json({ ok: false, error: "FOLDER_NOT_FOUND" }, { status: 400 });
    }
  }

  // Gem i notes-tabellen
  const { data, error } = await sb
    .from("notes")
    .insert({
      owner_id: ownerId,
      title,
      content,
      source_title: "Noter-generator",
      source_url: "/traener/noter",
      folder_id: folderId,
      note_type,
    })
    .select("id,title,content,created_at,folder_id,note_type")
    .single();

  if (error || !data) {
    console.error("[generate-notes] insert error:", error);
    return NextResponse.json({ ok: false, error: "INSERT_FAILED" }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      fromLLM: false, // stub-mode (UI kan vise "ikke fra LLM" besked)
      note: data,
    },
    { status: 200 },
  );
}
