// app/api/recent-mc/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExamSessionRow = {
  id: string;
  created_at: string | null;
  score: number | null;
  folder_id: string | null;
};

type FolderRow = {
  id: string;
  name: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const { sb, id: ownerId } = await requireUser(req);

    // 1) Seneste MC sessions
    const { data: sessions, error: sessionsError } = await sb
      .from("exam_sessions")
      .select("id, created_at, score, folder_id")
      .eq("owner_id", ownerId)
      .eq("source_type", "mc")
      .order("created_at", { ascending: false })
      .limit(10);

    if (sessionsError) {
      console.error("[recent-mc] exam_sessions error:", sessionsError);
      return NextResponse.json(
        { ok: false, error: "Kunne ikke hente MC-historik." },
        { status: 500 },
      );
    }

    const rows = (sessions ?? []) as ExamSessionRow[];

    // 2) Folder-navne
    const folderIds = Array.from(
      new Set(
        rows
          .map((r) => r.folder_id)
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      ),
    );

    let folderLookup: Record<string, string> = {};

    if (folderIds.length > 0) {
      const { data: folders, error: foldersError } = await sb
        .from("folders")
        .select("id, name")
        .in("id", folderIds);

      if (foldersError) {
        console.error("[recent-mc] folders lookup error:", foldersError);
      } else {
        folderLookup = ((folders ?? []) as FolderRow[]).reduce<Record<string, string>>((acc, f) => {
          if (f?.id) acc[f.id] = (f.name ?? "").trim();
          return acc;
        }, {});
      }
    }

    // 3) Format til SidebarRecentMC
    const items = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      score: r.score,
      folder_name: r.folder_id ? (folderLookup[r.folder_id] || null) : null,
    }));

    // Bevidst bagudkompatibel: gamle klienter forventer ofte bare { items }
    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");

    if (isAuth) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    console.error("[recent-mc] handler crash:", err);
    return NextResponse.json({ ok: false, error: "Ukendt fejl i recent-mc." }, { status: 500 });
  }
}
