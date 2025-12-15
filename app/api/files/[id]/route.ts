// app/api/files/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // DEV fallback
  }
  return process.env.DEV_USER_ID ?? null;
}

// Flyt fil til anden mappe (bruges af dropdownen i UI)
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      { error: "Mangler bruger-id (hverken login eller DEV_USER_ID sat)." },
      { status: 401 }
    );
  }

  const { id: fileId } = await ctx.params;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldigt JSON-body." }, { status: 400 });
  }

  const folderId = body?.folder_id as string | undefined;
  if (!folderId) {
    return NextResponse.json({ error: "Mangler folder_id." }, { status: 400 });
  }

  try {
    // Opdater begge tabeller – kun den ene vil matche
    const updates = { folder_id: folderId };

    const { error: errFiles } = await sb
      .from("files")
      .update(updates)
      .eq("owner_id", ownerId)
      .eq("id", fileId);

    const { error: errTraining } = await sb
      .from("training_files")
      .update(updates)
      .eq("owner_id", ownerId)
      .eq("id", fileId);

    if (errFiles && errTraining) {
      console.error("/api/files/[id] PUT fejl", errFiles, errTraining);
      return NextResponse.json(
        { error: "Kunne ikke opdatere filens mappe." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, folder_id: folderId });
  } catch (err) {
    console.error("/api/files/[id] PUT uventet fejl", err);
    return NextResponse.json(
      { error: "Uventet fejl ved opdatering af fil." },
      { status: 500 }
    );
  }
}

// Slet fil (brugt af Slet-knappen)
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      { error: "Mangler bruger-id (hverken login eller DEV_USER_ID sat)." },
      { status: 401 }
    );
  }

  const { id: fileId } = await ctx.params;

  try {
    // 1) Slet relaterede doc_chunks
    const { error: chunksError } = await sb
      .from("doc_chunks")
      .delete()
      .eq("owner_id", ownerId)
      .eq("file_id", fileId);

    if (chunksError) {
      console.error("/api/files/[id] DELETE doc_chunks fejl", chunksError);
      // vi fortsætter alligevel og forsøger at slette fil-records
    }

    // 2) Slet i files
    const { error: filesError } = await sb
      .from("files")
      .delete()
      .eq("owner_id", ownerId)
      .eq("id", fileId);

    // 3) Slet i training_files (gamle uploads)
    const { error: trainingError } = await sb
      .from("training_files")
      .delete()
      .eq("owner_id", ownerId)
      .eq("id", fileId);

    if (filesError && trainingError) {
      console.error("/api/files/[id] DELETE fejl", filesError, trainingError);
      return NextResponse.json(
        { error: "Kunne ikke slette filen." },
        { status: 500 }
      );
    }

    // Behandler 0 rækker som OK (samme semantik som din klient forventer)
    return NextResponse.json({ ok: true, file_id: fileId });
  } catch (err) {
    console.error("/api/files/[id] DELETE uventet fejl", err);
    return NextResponse.json(
      { error: "Uventet fejl ved sletning af fil." },
      { status: 500 }
    );
  }
}
