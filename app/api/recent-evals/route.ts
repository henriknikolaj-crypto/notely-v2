// app/api/recent-evals/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  created_at: string | null;
  score: number | null;
  folder_id: string | null;
  source_type: string | null;
};

type FolderRow = {
  id: string;
  name: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const { sb, id: ownerId } = await requireUser(req);

    // 1) Hent de seneste træner-evalueringer (ikke-MC)
    // trainer = source_type IS NULL eller 'trainer'
    const { data: sessions, error } = await sb
      .from("exam_sessions")
      .select("id, created_at, score, folder_id, source_type")
      .eq("owner_id", ownerId)
      .or("source_type.is.null,source_type.eq.trainer")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error("[recent-evals] query error:", error);
      // Bevidst “blød” fejl (UI kan bare vise tom liste)
      return NextResponse.json({ ok: true, items: [] }, { status: 200 });
    }

    const rows = (sessions ?? []) as SessionRow[];

    // 2) Saml unikke folder_id'er
    const folderIds = Array.from(
      new Set(
        rows
          .map((r) => r.folder_id)
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      ),
    );

    // 3) Hent folder-navne fra training_folders
    const folderMap = new Map<string, string | null>();

    if (folderIds.length > 0) {
      const { data: folders, error: foldersError } = await sb
        .from("training_folders")
        .select("id, name")
        .in("id", folderIds);

      if (foldersError) {
        console.error("[recent-evals] training_folders lookup error:", foldersError);
      } else {
        for (const f of (folders ?? []) as FolderRow[]) {
          if (f?.id) folderMap.set(f.id, f.name ?? null);
        }
      }
    }

    // 4) Payload til UI
    const items = rows.map((r) => ({
      id: r.id,
      when: r.created_at,
      score: r.score ?? null,
      folder_name: r.folder_id ? folderMap.get(r.folder_id) ?? null : null,
    }));

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");

    if (isAuth) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    console.error("[recent-evals] route error:", err);
    return NextResponse.json({ ok: false, error: "Ukendt fejl" }, { status: 500 });
  }
}
