// app/api/exam-sessions/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DEV: brug DEV_USER_ID som owner_id.
// (Senere skifter vi til rigtig auth.)
async function getOwnerId(): Promise<string | null> {
  return process.env.DEV_USER_ID ?? null;
}

// GET /api/exam-sessions?limit=5&folder_id=...
export async function GET(req: NextRequest) {
  try {
    const sb = await supabaseServerRoute();
    const ownerId = await getOwnerId();

    if (!ownerId) {
      return NextResponse.json(
        { error: "Unauthorized (mangler DEV_USER_ID)" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);

    const limRaw = searchParams.get("limit");
    const lim = limRaw ? Number(limRaw) : 10;
    const limit =
      Number.isFinite(lim) && lim > 0 ? Math.min(lim, 50) : 10;

    // accepter både folder_id og folderId
    const folderFilter =
      searchParams.get("folder_id") ??
      searchParams.get("folderId") ??
      null;

    let query = sb
      .from("exam_sessions")
      .select("id,score,created_at,folder_id")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (folderFilter) {
      query = query.eq("folder_id", folderFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error("EXAM-SESSIONS select error:", error);
      return NextResponse.json(
        { error: "DB error" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, sessions: data ?? [] },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("EXAM-SESSIONS route error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}


