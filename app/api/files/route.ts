// app/api/files/route.ts
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

export async function GET(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      { error: "Mangler bruger-id (hverken login eller DEV_USER_ID sat)." },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const folderId = url.searchParams.get("folder_id");

  // Vi samler først data fra training_files (gamle uploads)
  let trainingItems: any[] = [];
  try {
    let q = sb.from("training_files").select("*").eq("owner_id", ownerId);
    if (folderId) q = q.eq("folder_id", folderId);
    const { data, error } = await q;
    if (error) {
      console.warn("/api/files GET training_files fejl:", error);
    } else {
      trainingItems = data ?? [];
    }
  } catch (err) {
    console.warn("/api/files GET exception på training_files:", err);
  }

  // …og så fra files (nye uploads med upload → doc_chunks)
  let fileItems: any[] = [];
  try {
    let q = sb.from("files").select("*").eq("owner_id", ownerId);
    if (folderId) q = q.eq("folder_id", folderId);
    const { data, error } = await q;
    if (error) {
      console.warn("/api/files GET files fejl:", error);
    } else {
      fileItems = data ?? [];
    }
  } catch (err) {
    console.warn("/api/files GET exception på files:", err);
  }

  // Normalisér til fælles format
  const normalized = [
    // Gamle training_files-rækker
    ...trainingItems.map((t: any) => {
      const created =
        t.created_at ?? t.inserted_at ?? t.uploaded_at ?? null;
      return {
        id: String(t.id),
        name: t.name ?? t.file_name ?? t.original_name ?? "Ukendt fil",
        original_name: t.original_name ?? t.file_name ?? t.name ?? null,
        folder_id: t.folder_id ?? null,
        size_bytes: t.size_bytes ?? t.size ?? null,
        storage_path: t.storage_path ?? null,
        created_at: created,
        uploaded_at: created,
      };
    }),
    // Nye files-rækker
    ...fileItems.map((f: any) => {
      const uploaded =
        f.uploaded_at ?? f.created_at ?? f.inserted_at ?? null;
      return {
        id: String(f.id),
        name: f.name ?? f.original_name ?? "Ukendt fil",
        original_name: f.original_name ?? f.name ?? null,
        folder_id: f.folder_id ?? null,
        size_bytes: f.size_bytes ?? f.size ?? f.size_bytes ?? null,
        storage_path: f.storage_path ?? null,
        created_at: f.created_at ?? uploaded,
        uploaded_at: uploaded,
      };
    }),
  ];

  // Sortér nyeste først
  normalized.sort((a, b) => {
    const da = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
    const db = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
    return db - da;
  });

  return NextResponse.json({ items: normalized });
}
