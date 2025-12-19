import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normDate(v: any): string | null {
  const s = normStr(v);
  if (!s) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export async function GET(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
  }

  const { data, error } = await sb
    .from("folders")
    .select("id,name,parent_id,start_date,end_date,archived_at,created_at")
    .eq("owner_id", owner.ownerId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[folders GET] db error", error);
    return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, folders: data ?? [] }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as any;
  if (!body) {
    return NextResponse.json({ ok: false, code: "INVALID_JSON", error: "Ugyldigt JSON-body." }, { status: 400 });
  }

  const name = normStr(body.name);
  const parent_id = body.parent_id === null ? null : normStr(body.parent_id);
  const start_date = body.start_date === null ? null : normDate(body.start_date);
  const end_date = body.end_date === null ? null : normDate(body.end_date);

  if (!name) {
    return NextResponse.json({ ok: false, code: "INVALID_NAME", error: "Navn må ikke være tomt." }, { status: 400 });
  }

  // Max 1 nesting-level: hvis parent_id er sat, må parent ikke selv have parent_id
  if (parent_id) {
    const { data: parent, error: pErr } = await sb
      .from("folders")
      .select("id, owner_id, parent_id, archived_at")
      .eq("id", parent_id)
      .maybeSingle();

    if (pErr) {
      console.error("[folders POST] parent lookup error", pErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
    }
    if (!parent || parent.archived_at) {
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
    .from("folders")
    .insert({
      owner_id: owner.ownerId,
      name,
      parent_id,
      start_date,
      end_date,
    })
    .select("id,name,parent_id,start_date,end_date,archived_at,created_at")
    .single();

  if (error) {
    console.error("[folders POST] db error", error);
    return NextResponse.json({ ok: false, code: "DB_INSERT_FAILED", error: "Kunne ikke oprette mappen." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, folder: data }, { status: 200 });
}
