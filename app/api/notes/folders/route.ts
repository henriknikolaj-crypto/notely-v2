// app/api/notes/folders/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prøv først den tabel som faktisk findes hos dig (jf. PGRST205 hint),
// men behold fallback for miljøer hvor den gamle hedder notes_folders.
const FOLDER_TABLES = ["note_folders", "notes_folders"] as const;

function normStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true as const, value: {} as T };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "INVALID_JSON" as const };
  }
}

async function resolveFoldersTable(sb: any): Promise<(typeof FOLDER_TABLES)[number]> {
  let lastErr: any = null;

  for (const t of FOLDER_TABLES) {
    // "ping" tabellen (limit 1) – tomt resultat er OK, bare ikke fejl.
    const r = await sb.from(t).select("id").limit(1);

    if (!r.error) return t;

    // PGRST205 = tabellen findes ikke i schema cache
    if (String(r.error?.code ?? "") === "PGRST205") {
      lastErr = r.error;
      continue;
    }

    lastErr = r.error;
    break;
  }

  const e = new Error("FOLDERS_TABLE_MISSING");
  (e as any).cause = lastErr;
  throw e;
}

export async function GET(req: NextRequest) {
  try {
    const sb = await supabaseServerRoute();
    const owner = await getOwnerCtx(req, sb);

    if (!owner?.ownerId) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
    }

    const table = await resolveFoldersTable(sb);

    const { data, error } = await sb
      .from(table)
      .select("id,name,parent_id,created_at")
      .eq("owner_id", owner.ownerId)
      .order("name", { ascending: true });

    if (error) {
      console.error("[notes_folders GET] db error", { table, error });
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, folders: data ?? [] }, { status: 200 });
  } catch (e: any) {
    console.error("[notes_folders GET] fatal", e);
    const code = String(e?.message ?? "") === "FOLDERS_TABLE_MISSING" ? "FOLDERS_TABLE_MISSING" : "UNEXPECTED_ERROR";
    const msg =
      code === "FOLDERS_TABLE_MISSING"
        ? "Kunne ikke finde note_folders/notes_folders i databasen."
        : "Uventet serverfejl.";

    return NextResponse.json({ ok: false, code, error: msg }, { status: 500 });
  }
}

type CreateFolderBody = {
  name?: string;
  parent_id?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const sb = await supabaseServerRoute();
    const owner = await getOwnerCtx(req, sb);

    if (!owner?.ownerId) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
    }

    const parsed = await readJsonBody<CreateFolderBody>(req);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, code: "INVALID_JSON", error: "Ugyldigt JSON-body." }, { status: 400 });
    }

    const body = parsed.value ?? {};
    const name = normStr(body.name);
    const parent_id = body.parent_id === null ? null : normStr(body.parent_id);

    if (!name || name.length < 2) {
      return NextResponse.json({ ok: false, code: "INVALID_NAME", error: "Ugyldigt mappenavn." }, { status: 400 });
    }

    const table = await resolveFoldersTable(sb);

    // Max 1 nesting level: hvis parent_id er sat, må parent ikke selv have parent_id
    if (parent_id) {
      const { data: parent, error: pErr } = await sb
        .from(table)
        .select("id, owner_id, parent_id")
        .eq("id", parent_id)
        .maybeSingle();

      if (pErr) {
        console.error("[notes_folders POST] parent lookup error", { table, pErr });
        return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
      }

      if (!parent) {
        return NextResponse.json({ ok: false, code: "INVALID_PARENT", error: "Ugyldig parent_id." }, { status: 400 });
      }

      if (parent.owner_id !== owner.ownerId) {
        return NextResponse.json({ ok: false, code: "FORBIDDEN", error: "Ingen adgang." }, { status: 403 });
      }

      if (parent.parent_id) {
        return NextResponse.json(
          { ok: false, code: "NESTING_LIMIT", error: "Kun ét niveau af undermapper er tilladt." },
          { status: 409 },
        );
      }
    }

    const { data, error } = await sb
      .from(table)
      .insert({ name, parent_id, owner_id: owner.ownerId })
      .select("id,name,parent_id,created_at")
      .single();

    if (error) {
      console.error("[notes_folders POST] insert error", { table, error });
      return NextResponse.json({ ok: false, code: "DB_INSERT_FAILED", error: "Kunne ikke oprette mappen." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, folder: data }, { status: 200 });
  } catch (e: any) {
    console.error("[notes_folders POST] fatal", e);
    const code = String(e?.message ?? "") === "FOLDERS_TABLE_MISSING" ? "FOLDERS_TABLE_MISSING" : "UNEXPECTED_ERROR";
    const msg =
      code === "FOLDERS_TABLE_MISSING"
        ? "Kunne ikke finde note_folders/notes_folders i databasen."
        : "Uventet serverfejl.";

    return NextResponse.json({ ok: false, code, error: msg }, { status: 500 });
  }
}
