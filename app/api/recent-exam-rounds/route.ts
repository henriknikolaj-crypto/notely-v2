import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "skrift" | "mundtlig";

function normMode(raw: unknown): Mode {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "mundtlig" ? "mundtlig" : "skrift";
}

function clampInt(v: string | null, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
    .filter(Boolean);
}

function readMetaFolderIds(meta: any): string[] {
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as any).folder_ids ?? (meta as any).folderIds ?? (meta as any).scopeFolderIds;
  return normalizeStringArray(raw);
}

function compactFolderLabel(folderIds: string[], folderMap: Map<string, string>): string | null {
  const ids = Array.isArray(folderIds) ? folderIds.filter(Boolean) : [];
  if (ids.length === 0) return null;

  const names = ids.map((id) => folderMap.get(id)).filter((x): x is string => !!x);
  if (names.length > 0) {
    const first = names[0];
    const extra = ids.length - 1;
    return extra > 0 ? `${first} +${extra}` : first;
  }

  if (ids.length > 1) return `${ids.length} mapper`;
  return "Ukendt mappe";
}

function sourceTypesForMode(mode: Mode) {
  return mode === "mundtlig"
    ? ["mundtlig", "oral", "simulator_oral", "exam_oral", "mundtlig_simulator"]
    : ["simulator", "skrift", "written", "exam_simulator", "skrift_simulator"];
}

function withRootPath(options?: Record<string, unknown>) {
  return { ...(options ?? {}), path: "/" };
}

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !anon) {
    return NextResponse.json({ ok: false, error: "Missing Supabase env vars." }, { status: 500 });
  }

  const u = new URL(req.url);
  const mode = normMode(u.searchParams.get("mode"));
  const limit = clampInt(u.searchParams.get("limit"), 1, 50, 5);
  const wantedTypes = sourceTypesForMode(mode);

  const cookieStore = await cookies();
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const c of cookiesToSet) cookieStore.set(c.name, c.value, withRootPath(c.options));
        } catch {}
      },
    },
  });

  const { data: userData } = await sb.auth.getUser();
  const ownerId = userData?.user?.id;

  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  type Row = {
    id: string;
    created_at: string | null;
    score: number | null;
    folder_id: string | null;
    meta?: any;
  };

  // Primær: filter på source_type. Fallback: ufiltreret hvis legacy data.
  const baseRows = sb
    .from("exam_sessions")
    .select("id, created_at, score, folder_id, meta")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const baseCount = sb
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);

  const r1 = await baseRows.in("source_type", wantedTypes);
  const c1 = await baseCount.in("source_type", wantedTypes);

  let rows: Row[] = [];
  let total = 0;

  if (!r1.error) rows = (Array.isArray(r1.data) ? r1.data : []) as Row[];
  if (!c1.error && typeof c1.count === "number") total = c1.count;

  if (rows.length === 0) {
    const r2 = await baseRows;
    const c2 = await baseCount;

    if (r2.error) {
      return NextResponse.json({ ok: false, error: r2.error.message }, { status: 500 });
    }

    rows = (Array.isArray(r2.data) ? r2.data : []) as Row[];
    total = !c2.error && typeof c2.count === "number" ? c2.count : rows.length;
  }

  // Folder names uden join (undgår schema-cache relation fejl)
  const folderIds = new Set<string>();

  for (const r of rows) {
    if (r.folder_id) folderIds.add(r.folder_id);
    const metaIds = readMetaFolderIds(r.meta);
    for (const id of metaIds) folderIds.add(id);
  }

  const folderMap = new Map<string, string>();

  if (folderIds.size) {
    const fr = await sb
      .from("folders")
      .select("id, name")
      .eq("owner_id", ownerId)
      .in("id", Array.from(folderIds));

    if (!fr.error && Array.isArray(fr.data)) {
      for (const f of fr.data as any[]) {
        if (f?.id && f?.name) folderMap.set(String(f.id), String(f.name));
      }
    }
  }

  const items = rows.map((r) => ({
    ...r,
    folder_name: r.folder_id
      ? folderMap.get(r.folder_id) ?? "Ukendt mappe"
      : compactFolderLabel(readMetaFolderIds(r.meta), folderMap),
  }));

  return NextResponse.json({ ok: true, mode, items, total: Math.min(total, 50) });
}
