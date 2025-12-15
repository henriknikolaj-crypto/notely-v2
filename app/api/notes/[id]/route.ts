// app/api/notes/[id]/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DEV: vi bruger DEV_USER_ID som owner
async function getOwnerId(): Promise<string | null> {
  return process.env.DEV_USER_ID ?? null;
}

async function deleteNote(noteId: string, ownerId: string) {
  const sb = await supabaseServerRoute();

  const { error } = await sb
    .from("notes")
    .delete()
    .eq("id", noteId)
    .eq("owner_id", ownerId);

  if (error) {
    console.error("Failed to delete note", { noteId, error });
    throw new Error("DB delete failed");
  }
}

// DELETE /api/notes/:id
// Bruges til direkte API-kald (fx fetch med method: DELETE)
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: noteId } = await ctx.params;

  if (!noteId) {
    return NextResponse.json(
      { error: "Missing note id" },
      { status: 400 }
    );
  }

  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    await deleteNote(noteId, ownerId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "DB delete failed" },
      { status: 500 }
    );
  }
}

// POST /api/notes/:id med _method=DELETE
// Bruges af HTML-formen på /traener/noter/historik
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: noteId } = await ctx.params;

  if (!noteId) {
    return NextResponse.json(
      { error: "Missing note id" },
      { status: 400 }
    );
  }

  let methodOverride = "";
  try {
    const form = await req.formData();
    methodOverride = String(form.get("_method") || "").toUpperCase();
  } catch {
    methodOverride = "";
  }

  if (methodOverride !== "DELETE") {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    await deleteNote(noteId, ownerId);

    // Tilbage til historik efter form-submit
    return NextResponse.redirect(
      new URL("/traener/noter/historik", req.url),
      303
    );
  } catch (e: any) {
    console.error("Failed to delete note via POST _method=DELETE", e);
    return NextResponse.json(
      { error: e?.message ?? "DB delete failed" },
      { status: 500 }
    );
  }
}


