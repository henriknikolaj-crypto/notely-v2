// app/api/notes/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Max antal noter vi gemmer pr. bruger (ældste ryger først)
const MAX_NOTES_PER_USER = 50;

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // dev-fallback
  }
  return process.env.DEV_USER_ID ?? null;
}

type NoteBody = {
  title?: string | null;
  content?: string | null;
  note_type?: string | null;
  source_title?: string | null;
  source_url?: string | null;
  // fileId/file_id er tilladt men ignoreres lige nu (notes har ingen file_id-kolonne)
  fileId?: string | null;
  file_id?: string | null;
};

// LIST notes (til fx “Seneste noter”)
export async function GET(req: NextRequest) {
  try {
    const sb = await supabaseServerRoute();
    const ownerId = await getOwnerId(sb);

    if (!ownerId) {
      return NextResponse.json(
        { error: "Unauthorized (mangler bruger-id / DEV_USER_ID)." },
        { status: 401 },
      );
    }

    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = Number.isFinite(Number(limitRaw))
      ? Math.max(1, Math.min(100, Number(limitRaw)))
      : 20;

    const { data, error } = await sb
      .from("notes")
      .select(
        "id, title, content, note_type, source_title, source_url, created_at",
      )
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("NOTES GET error:", error);
      return NextResponse.json(
        { error: "Fejl ved hentning af noter." },
        { status: 500 },
      );
    }

    return NextResponse.json({ notes: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error("NOTES GET unhandled error:", err);
    return NextResponse.json(
      { error: "Ukendt serverfejl ved hentning af noter." },
      { status: 500 },
    );
  }
}

// CREATE note (bruges bl.a. af “Gem som note” under Feedback)
export async function POST(req: NextRequest) {
  try {
    const sb = await supabaseServerRoute();
    const ownerId = await getOwnerId(sb);

    if (!ownerId) {
      return NextResponse.json(
        { error: "Unauthorized (mangler bruger-id / DEV_USER_ID)." },
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as NoteBody;

    const title =
      typeof body.title === "string" && body.title.trim().length > 0
        ? body.title.trim().slice(0, 200)
        : "Note";

    const content =
      typeof body.content === "string" ? body.content : null;

    const note_type =
      typeof body.note_type === "string" ? body.note_type : null;

    const source_title =
      typeof body.source_title === "string" ? body.source_title : null;

    const source_url =
      typeof body.source_url === "string" ? body.source_url : null;

    // fileId/file_id er OK at sende, men vi bruger den ikke endnu
    // const fileIdRaw = body.file_id ?? body.fileId ?? null;

    const insertPayload: any = {
      owner_id: ownerId,
      title,
      content,
      note_type,
      source_title,
      source_url,
    };

    const { data, error } = await sb
      .from("notes")
      .insert(insertPayload)
      .select(
        "id, title, content, note_type, source_title, source_url, created_at",
      )
      .single();

    if (error || !data) {
      console.error("NOTES POST insert error:", error);
      return NextResponse.json(
        { error: "Kunne ikke gemme noten." },
        { status: 500 },
      );
    }

    // --- Automatisk oprydning: behold kun de nyeste MAX_NOTES_PER_USER noter ---
    try {
      const { data: overflowNotes, error: overflowErr } = await sb
        .from("notes")
        .select("id")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        // række 0-49 = de 50 nyeste → vi henter alt derefter
        .range(MAX_NOTES_PER_USER, MAX_NOTES_PER_USER + 200);

      if (overflowErr) {
        console.error("NOTES POST cleanup select error:", overflowErr);
      } else if (overflowNotes && overflowNotes.length > 0) {
        const idsToDelete = overflowNotes.map((n: any) => n.id as string);

        const { error: deleteErr } = await sb
          .from("notes")
          .delete()
          .in("id", idsToDelete);

        if (deleteErr) {
          console.error("NOTES POST cleanup delete error:", deleteErr);
        }
      }
    } catch (cleanupErr) {
      console.error("NOTES POST cleanup unexpected error:", cleanupErr);
    }
    // -------------------------------------------------------------------------

    return NextResponse.json(
      {
        id: data.id,
        title: data.title,
        content: data.content,
        note_type: data.note_type,
        source_title: data.source_title,
        source_url: data.source_url,
        created_at: data.created_at,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("NOTES POST unhandled error:", err);
    return NextResponse.json(
      { error: "Ukendt serverfejl ved oprettelse af note." },
      { status: 500 },
    );
  }
}
