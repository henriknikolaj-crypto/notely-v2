// app/api/notes/folders/[id]/move/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function resolveOwnerId(req: NextRequest, sb: any): Promise<string | null> {
  const owner = await getOwnerCtx(req, sb);
  return owner?.ownerId ?? null; // getOwnerCtx håndterer dev-only (og aldrig i prod)
}

/**
 * Flyt en note-folder (notes_folders) under en anden folder (parent_id)
 * Body: { "parent_id": "<uuid|null>" }
 *
 * Regler:
 * - Max 1 nesting-level (ingen "børnebørn")
 * - parent må ikke selv have parent_id
 * - kan ikke flytte ind under sig selv / eget barn
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const sb = await supabaseServerRoute();
  const ownerId = await resolveOwnerId(req, sb);

  if (!ownerId) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "Login kræves." },
      { status: 401 },
    );
  }

  if (!id) {
    return NextResponse.json(
      { ok: false, code: "MISSING_ID", error: "Mangler folder-id." },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as any;
  if (!body) {
    return NextResponse.json(
      { ok: false, code: "INVALID_JSON", error: "Ugyldigt JSON-body." },
      { status: 400 },
    );
  }

  const parent_id = body.parent_id === null ? null : normStr(body.parent_id);

  if (parent_id === id) {
    return NextResponse.json(
      { ok: false, code: "INVALID_PARENT", error: "Folder kan ikke være sin egen parent." },
      { status: 400 },
    );
  }

  // 1) Hent folderen der flyttes (ejertjek)
  const { data: folder, error: fErr } = await sb
    .from("notes_folders")
    .select("id, owner_id, parent_id")
    .eq("id", id)
    .maybeSingle();

  if (fErr) {
    console.error("[notes_folders move] folder lookup error", fErr);
    return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
  }
  if (!folder) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Folderen findes ikke." }, { status: 404 });
  }
  if (folder.owner_id !== ownerId) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", error: "Ingen adgang." }, { status: 403 });
  }

  // No-op: hvis parent_id er uændret
  if ((folder.parent_id ?? null) === (parent_id ?? null)) {
    return NextResponse.json({ ok: true, folder: { id: folder.id, parent_id: folder.parent_id } }, { status: 200 });
  }

  // 2) Hvis vi flytter folderen IND under en parent, må folderen ikke have børn
  if (parent_id) {
    const { data: childAny, error: chErr } = await sb
      .from("notes_folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("parent_id", id)
      .limit(1)
      .maybeSingle();

    if (chErr) {
      console.error("[notes_folders move] child check error", chErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
    }
    if (childAny) {
      return NextResponse.json(
        {
          ok: false,
          code: "NESTING_LIMIT",
          error: "Kun ét niveau af undermapper er tilladt (folderen har allerede børn).",
        },
        { status: 409 },
      );
    }
  }

  // 3) Parent-validering (max 1 nesting level)
  if (parent_id) {
    const { data: parent, error: pErr } = await sb
      .from("notes_folders")
      .select("id, owner_id, parent_id")
      .eq("id", parent_id)
      .maybeSingle();

    if (pErr) {
      console.error("[notes_folders move] parent lookup error", pErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
    }
    if (!parent) {
      return NextResponse.json({ ok: false, code: "INVALID_PARENT", error: "Ugyldig parent_id." }, { status: 400 });
    }
    if (parent.owner_id !== ownerId) {
      return NextResponse.json({ ok: false, code: "FORBIDDEN", error: "Ingen adgang." }, { status: 403 });
    }

    if (parent.parent_id) {
      return NextResponse.json(
        { ok: false, code: "NESTING_LIMIT", error: "Kun ét niveau af undermapper er tilladt." },
        { status: 409 },
      );
    }

    // kan ikke flytte under eget barn (direkte)
    const { data: child, error: cErr } = await sb
      .from("notes_folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("parent_id", id)
      .eq("id", parent_id)
      .maybeSingle();

    if (cErr) {
      console.error("[notes_folders move] cycle check error", cErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
    }
    if (child) {
      return NextResponse.json(
        { ok: false, code: "CYCLE", error: "Du kan ikke flytte en folder ind under sit eget barn." },
        { status: 409 },
      );
    }
  }

  // 4) Udfør flyt
  const { data: updated, error: uErr } = await sb
    .from("notes_folders")
    .update({ parent_id })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id, parent_id")
    .maybeSingle();

  if (uErr) {
    console.error("[notes_folders move] update error", uErr);
    return NextResponse.json({ ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke flytte folderen." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Folderen findes ikke længere." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, folder: updated }, { status: 200 });
}
