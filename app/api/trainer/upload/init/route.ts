import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { ensureProfile } from "@/lib/server/ensureProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "trainer_uploads";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function stripPathy(name: string) {
  const n = String(name ?? "").trim();
  const base = n.split(/[\\/]/g).pop() || n || "upload.pdf";
  return base.replace(/[\u0000-\u001F]/g, "").slice(0, 180) || "upload.pdf";
}

function getFileExtension(name: string) {
  const safeName = stripPathy(name);
  const idx = safeName.lastIndexOf(".");
  if (idx < 0) return "";
  return safeName.slice(idx).toLowerCase();
}

function isPdfMetadata(fileName: string, mimeType: string) {
  const mime = String(mimeType ?? "").trim().toLowerCase();
  if (mime === "application/pdf") return true;
  return getFileExtension(fileName) === ".pdf";
}

function errInfo(e: any) {
  if (!e) return { message: "Unknown error" };
  if (typeof e === "string") return { message: e };
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  return {
    message: e.message ?? e.error_description ?? e.error ?? e.msg ?? "Unknown error",
    code: e.code,
    details: e.details,
    hint: e.hint,
    status: e.status,
  };
}

function resolveUploadAuthClient(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll() {},
    },
  });
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(req: NextRequest) {
  const fallbackRequestId = randomUUID();
  let requestId: string = fallbackRequestId;
  let ownerId = "";

  try {
    const body = await req.json().catch(() => null);
    requestId = String(body?.request_id ?? body?.requestId ?? fallbackRequestId).trim() || fallbackRequestId;

    const sb = resolveUploadAuthClient(req);
    const { data: sessionData } = await sb.auth.getSession();
    ownerId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : "";
    if (!ownerId) {
      const { data: authData } = await sb.auth.getUser();
      ownerId = authData?.user?.id ? String(authData.user.id) : "";
    }

    if (!ownerId) {
      return NextResponse.json({ ok: false, error: "Unauthorized", requestId }, { status: 401 });
    }

    const admin = supabaseAdmin();
    await ensureProfile(admin, ownerId);

    const folderId = String(body?.folder_id ?? body?.folderId ?? "").trim() || null;
    const fileName = stripPathy(String(body?.file_name ?? body?.fileName ?? "upload.pdf"));
    const mimeType = String(body?.mime_type ?? body?.mimeType ?? "application/pdf").trim() || "application/pdf";
    const sizeBytes =
      typeof body?.size_bytes === "number"
        ? Number(body.size_bytes)
        : typeof body?.sizeBytes === "number"
          ? Number(body.sizeBytes)
          : null;

    if (!folderId) return NextResponse.json({ ok: false, error: "Manglende folder_id.", requestId }, { status: 400 });
    if (!isPdfMetadata(fileName, mimeType)) {
      return NextResponse.json({ ok: false, error: "Direct upload understøtter kun PDF lige nu.", requestId }, { status: 400 });
    }
    if (sizeBytes != null && sizeBytes > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          code: "FILE_TOO_LARGE",
          error: "Filen er større end 25 MB. Prøv at komprimere PDF’en eller del den i to filer.",
          requestId,
        },
        { status: 413 },
      );
    }

    const { data: folderRow, error: folderErr } = await admin
      .from("folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("id", folderId)
      .is("archived_at", null)
      .maybeSingle();

    if (folderErr) {
      console.error("[trainer/upload/init] folder lookup error:", errInfo(folderErr));
    }
    if (!folderRow) {
      return NextResponse.json({ ok: false, error: "Ugyldig mappe (folder_id).", requestId }, { status: 400 });
    }

    const fileId = randomUUID();
    const fileExt = getFileExtension(fileName) || ".pdf";
    const storagePath = `${ownerId}/${folderId}/${fileId}${fileExt}`;
    const signed = await admin.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(storagePath);
    if (signed.error || !signed.data?.token) {
      console.error("[trainer/upload/init] signed upload url error:", errInfo(signed.error));
      return NextResponse.json({ ok: false, error: "Kunne ikke starte uploaden.", requestId }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        fileId,
        folderId,
        uploadKind: "pdf",
        storage: {
          bucket: UPLOAD_BUCKET,
          path: storagePath,
          token: signed.data.token,
          signedUrl: signed.data.signedUrl,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[trainer/upload/init] error:", errInfo(error));
    return NextResponse.json({ ok: false, error: "Kunne ikke starte uploaden.", requestId }, { status: 500 });
  }
}
