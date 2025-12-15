// app/api/recent-evals/route.ts
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // falder tilbage til DEV_USER_ID i lokal dev
  }
  return process.env.DEV_USER_ID ?? null;
}

type SessionRow = {
  id: string;
  created_at: string;
  score: number | null;
  folder_id: string | null;
  source_type: string | null;
};

type FolderRow = {
  id: string;
  name: string | null;
};

export async function GET() {
  try {
    const sb = await supabaseServerRoute();
    const ownerId = await getOwnerId(sb);

    if (!ownerId) {
      return NextResponse.json(
        { error: "Mangler owner_id (hverken login eller DEV_USER_ID sat)." },
        { status: 401 }
      );
    }

    // 1) Hent de seneste træner-evalueringer (ikke-MC)
    const { data: sessions, error } = await sb
      .from("exam_sessions")
      .select("id, created_at, score, folder_id, source_type")
      .eq("owner_id", ownerId)
      // trainer = source_type IS NULL eller 'trainer'
      .or("source_type.is.null,source_type.eq.trainer")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error("recent-evals query error:", error);
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    const rows = (sessions ?? []) as SessionRow[];

    // 2) Saml unikke folder_id'er
    const folderIds = Array.from(
      new Set(
        rows
          .map((r) => r.folder_id)
          .filter((id): id is string => typeof id === "string" && !!id)
      )
    );

    // 3) Hent folder-navne fra training_folders (eller mapper senere hvis vi skifter tabel)
    const folderMap = new Map<string, string | null>();

    if (folderIds.length > 0) {
      const { data: folders, error: foldersError } = await sb
        .from("training_folders")
        .select("id, name")
        .in("id", folderIds);

      if (foldersError) {
        console.error("recent-evals folders error:", foldersError);
      } else {
        for (const f of (folders ?? []) as FolderRow[]) {
          folderMap.set(f.id, f.name ?? null);
        }
      }
    }

    // 4) Byg payload til UI
    const items = rows.map((r) => ({
      id: r.id,
      when: r.created_at,
      score: r.score ?? null,
      folder_name: r.folder_id ? folderMap.get(r.folder_id) ?? null : null,
    }));

    return NextResponse.json({ items }, { status: 200 });
  } catch (e: any) {
    console.error("recent-evals route error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Ukendt fejl" },
      { status: 500 }
    );
  }
}
