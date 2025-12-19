// app/api/files/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NormalizedFileItem = {
  id: string;
  name: string;
  original_name: string | null;
  folder_id: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  created_at: string | null;
  uploaded_at: string | null;
  source_table: "files" | "training_files";
};

function asStr(x: any): string | null {
  const s = typeof x === "string" ? x.trim() : "";
  return s ? s : null;
}

function asNum(x: any): number | null {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function pickTs(...vals: any[]): string | null {
  for (const v of vals) {
    const s = asStr(v);
    if (s) return s;
  }
  return null;
}

function clampInt(raw: string | null, def: number, min: number, max: number) {
  const n = raw ? Number(raw) : def;
  if (!Number.isFinite(n)) return def;
  const i = Math.floor(n);
  return Math.max(min, Math.min(max, i));
}

function asNonEmpty(v: string | null): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function parseIso(v: string | null): string | null {
  const s = asNonEmpty(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function isMissingTableError(e: any) {
  const msg = String(e?.message ?? "");
  // Postgres: relation does not exist (42P01) / Supabase: could be in message text
  return (
    e?.code === "42P01" ||
    msg.toLowerCase().includes("does not exist") ||
    msg.toLowerCase().includes("relation") && msg.toLowerCase().includes("does not exist")
  );
}

async function safeFetchTable(opts: {
  sb: any;
  table: "files" | "training_files";
  ownerId: string;
  folderId: string | null;
}) {
  const { sb, table, ownerId, folderId } = opts;

  try {
    let q = sb.from(table).select("*").eq("owner_id", ownerId);
    if (folderId) q = q.eq("folder_id", folderId);

    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) return { ok: true as const, data: [] as any[] };
      console.warn(`[files] ${table} query error:`, error);
      return { ok: true as const, data: [] as any[] };
    }

    return { ok: true as const, data: (data ?? []) as any[] };
  } catch (err: any) {
    if (isMissingTableError(err)) return { ok: true as const, data: [] as any[] };
    console.warn(`[files] ${table} exception:`, err);
    return { ok: true as const, data: [] as any[] };
  }
}

export async function GET(req: NextRequest) {
  // auth/dev-bypass via requireUser (samme mønster som resten)
  let sb: any;
  let ownerId = "";
  try {
    const u = await requireUser(req);
    sb = u.sb;
    ownerId = u.id;
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");
    if (!isAuth) console.error("[files] requireUser crash:", e);
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;

  const folderIdRaw = asNonEmpty(sp.get("folder_id") ?? sp.get("folderId"));
  if (folderIdRaw && !isUuidLike(folderIdRaw)) {
    return NextResponse.json({ ok: false, error: "INVALID_FOLDER_ID" }, { status: 400 });
  }

  const limit = clampInt(sp.get("limit"), 200, 1, 500);
  const beforeIso = parseIso(sp.get("before")); // optional cursor: return only items older than this

  const includeLegacy = (sp.get("include_legacy") ?? "1").trim() !== "0";

  const [trainingRes, filesRes] = await Promise.all([
    includeLegacy
      ? safeFetchTable({ sb, table: "training_files", ownerId, folderId: folderIdRaw })
      : Promise.resolve({ ok: true as const, data: [] as any[] }),
    safeFetchTable({ sb, table: "files", ownerId, folderId: folderIdRaw }),
  ]);

  // normalize
  const normalized: NormalizedFileItem[] = [
    ...trainingRes.data.map((t: any) => {
      const created = pickTs(t.created_at, t.inserted_at, t.uploaded_at);
      const uploaded = pickTs(t.uploaded_at, t.created_at, t.inserted_at);

      const name =
        asStr(t.name) ?? asStr(t.file_name) ?? asStr(t.original_name) ?? "Ukendt fil";

      return {
        id: String(t.id),
        name,
        original_name: asStr(t.original_name) ?? asStr(t.file_name) ?? asStr(t.name),
        folder_id: asStr(t.folder_id),
        size_bytes: asNum(t.size_bytes ?? t.size),
        storage_path: asStr(t.storage_path),
        created_at: created,
        uploaded_at: uploaded ?? created,
        source_table: "training_files",
      };
    }),

    ...filesRes.data.map((f: any) => {
      const created = pickTs(f.created_at, f.inserted_at, f.uploaded_at);
      const uploaded = pickTs(f.uploaded_at, f.created_at, f.inserted_at);

      const name = asStr(f.name) ?? asStr(f.original_name) ?? "Ukendt fil";

      return {
        id: String(f.id),
        name,
        original_name: asStr(f.original_name) ?? asStr(f.name),
        folder_id: asStr(f.folder_id),
        size_bytes: asNum(f.size_bytes ?? f.size),
        storage_path: asStr(f.storage_path),
        created_at: created,
        uploaded_at: uploaded ?? created,
        source_table: "files",
      };
    }),
  ];

  // optional cursor filter
  const filtered = beforeIso
    ? normalized.filter((it) => {
        const ts = Date.parse(it.uploaded_at ?? it.created_at ?? "");
        if (!Number.isFinite(ts)) return true;
        return ts < Date.parse(beforeIso);
      })
    : normalized;

  // newest first (uploaded_at -> created_at fallback)
  filtered.sort((a, b) => {
    const ta = Date.parse(a.uploaded_at ?? a.created_at ?? "") || 0;
    const tb = Date.parse(b.uploaded_at ?? b.created_at ?? "") || 0;
    return tb - ta;
  });

  return NextResponse.json(
    {
      ok: true,
      items: filtered.slice(0, limit),
    },
    { status: 200 },
  );
}
