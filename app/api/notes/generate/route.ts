// app/api/notes/generate/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { captureException } from "@/lib/monitoring/error";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";
import {
  assertCanGenerateNoteType,
  FREEMIUM_FOCUS_MONTHLY_LIMIT_MESSAGE,
  FREEMIUM_SUMMARY_MONTHLY_LIMIT_MESSAGE,
} from "@/lib/notes/entitlements";
import { generateNotesForFile } from "@/lib/notes/generateFromFile";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { supabaseAdminOrNull } from "@/lib/quota/rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function pickMode(raw: any): "resume" | "golden" {
  return raw === "golden" ? "golden" : "resume";
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

export async function POST(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);

  if (!owner) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized (login kræves)." },
      { status: 401 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "OPENAI_API_KEY mangler i .env.local." },
      { status: 500 },
    );
  }

  const parsed = await readJsonBody<{ fileId?: string; mode?: string }>(req);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });

  const body = parsed.value ?? {};
  const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";
  const mode = pickMode(body.mode);
  const noteType = mode === "golden" ? "focus" : "resume";

  if (!fileId) {
    return NextResponse.json({ ok: false, error: "Mangler fileId." }, { status: 400 });
  }

  const ownerId = owner.ownerId;

  try {
    const profileAdmin = supabaseAdminOrNull();
    if (profileAdmin) {
      await ensureProfile(profileAdmin, ownerId);
    }
    await assertCanGenerateNoteType(sb, ownerId, noteType);
  } catch (error: any) {
    const code = String(error?.code ?? "");
    if (code === "NOTES_SUMMARY_MONTHLY_LIMIT_REACHED") {
      return NextResponse.json({ ok: false, code, error: FREEMIUM_SUMMARY_MONTHLY_LIMIT_MESSAGE }, { status: 403 });
    }
    if (code === "NOTES_FOCUS_MONTHLY_LIMIT_REACHED") {
      return NextResponse.json({ ok: false, code, error: FREEMIUM_FOCUS_MONTHLY_LIMIT_MESSAGE }, { status: 403 });
    }
    console.error("notes/generate: prepare error", error);
    captureException(error, {
      flow: "notes_generate_prepare",
      route: "/api/notes/generate",
      ownerId,
      fileId,
      status: 500,
      code: "NOTES_PREPARE_FAILED",
    });
    return NextResponse.json({ ok: false, error: "Kunne ikke klargøre note-generering." }, { status: 500 });
  }

  try {
    const [inserted] = await generateNotesForFile({
      sb,
      ownerId,
      fileId,
      modes: [mode],
    });

    return NextResponse.json({ ok: true, note: inserted }, { status: 200 });
  } catch (error: any) {
    console.error("notes/generate error", error);
    const msg = String(error?.message ?? "Uventet fejl ved note-generering.");
    const status =
      msg.includes("blev ikke fundet") ? 404 : msg.includes("doc_chunks") ? 400 : 500;
    if (status >= 500) {
      captureException(error, {
        flow: "notes_generate",
        route: "/api/notes/generate",
        ownerId,
        fileId,
        status,
        code: "NOTES_GENERATE_FAILED",
      });
    }
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
