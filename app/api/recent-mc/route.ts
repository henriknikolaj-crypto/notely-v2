// app/api/recent-mc/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const dynamic = "force-dynamic";

type ExamSessionRow = {
  id: string;
  created_at: string | null;
  score: number | null;
  folder_id: string | null;
  source_type: string | null;
};

type FolderRow = {
  id: string;
  name: string;
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // ignore – falder tilbage til DEV_USER_ID
  }
  return process.env.DEV_USER_ID ?? null;
}

export async function GET() {
  try {
    const sb = await supabaseServerRoute();
    const ownerId = await getOwnerId(sb);

    if (!ownerId) {
      return NextResponse.json(
        { error: "Mangler bruger-id (hverken login eller DEV_USER_ID sat)." },
        { status: 401 }
      );
    }

    // 1) Hent seneste MC-sessions (source_type = 'mc')
    const { data: sessions, error: sessionsError } = await sb
      .from("exam_sessions")
      .select("id, created_at, score, folder_id, source_type")
      .eq("owner_id", ownerId)
      .eq("source_type", "mc")
      .order("created_at", { ascending: false })
      .limit(10);

    if (sessionsError) {
      console.error("recent-mc exam_sessions error:", sessionsError);
      return NextResponse.json(
        { error: "Kunne ikke hente MC-historik." },
        { status: 500 }
      );
    }

    const rows = (sessions ?? []) as ExamSessionRow[];

    // 2) Slå mappenavne op via separat query
    const folderIds = Array.from(
      new Set(
        rows
          .map((r) => r.folder_id)
          .filter((id): id is string => !!id && id.trim().length > 0)
      )
    );

    let folderLookup: Record<string, string> = {};

    if (folderIds.length > 0) {
      const { data: folders, error: foldersError } = await sb
        .from("folders")
        .select("id, name")
        .in("id", folderIds);

      if (foldersError) {
        console.error("recent-mc folders error:", foldersError);
      } else {
        folderLookup = (folders as FolderRow[]).reduce(
          (acc, f) => {
            acc[f.id] = f.name;
            return acc;
          },
          {} as Record<string, string>
        );
      }
    }

    // 3) Map til det format SidebarRecentMC forventer
    const items = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      score: r.score,
      folder_name: r.folder_id ? folderLookup[r.folder_id] ?? null : null,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error("recent-mc handler crash:", err);
    return NextResponse.json(
      { error: "Ukendt fejl i recent-mc." },
      { status: 500 }
    );
  }
}
