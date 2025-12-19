// app/api/folders/[id]/move/route.ts
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

async function readJson(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true as const, value: {} as any };
  try {
    return { ok: true as const, value: JSON.parse(raw) as any };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

/**
 * Flyt en trænings-folder (folders) under en anden folder (parent_id)
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
  const owner = await getOwnerCtx(req, sb);
  if (!owner) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "Login kræves." },
      { status: 401 },
    );
  }
  const ownerId = owner.ownerId;

  if (!id) {
    return NextResponse.json(
      { ok: false, code: "MISSING_ID", error: "Mangler folder-id." },
      { status: 400 },
    );
  }

  const parsed = await readJson(req);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, code: "INVALID_JSON", error: parsed.error },
      { status: 400 },
    );
  }

  const body = parsed.value ?? {};
  const parent_id = body.parent_id === null ? null : normStr(body.parent_id);

  if (parent_id === id) {
    return NextResponse.json(
      { ok: false, code: "INVALID_PARENT", error: "Folder kan ikke være sin egen parent." },
      { status: 400 },
    );
  }

  // 1) Hent folderen der flyttes + ejertjek
  const { data: folder, error: fErr } = await sb
    .from("folders")
    .select("id, owner_id, parent_id, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (fErr) {
    console.error("[folders move] folder lookup error", fErr);
    return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
  }
  if (!folder || folder.archived_at) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Folderen findes ikke." }, { status: 404 });
  }
  if (folder.owner_id !== ownerId) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", error: "Ingen adgang." }, { status: 403 });
  }

  // No-op
  if ((folder.parent_id ?? null) === (parent_id ?? null)) {
    return NextResponse.json({ ok: true, folder: { id: folder.id, parent_id: folder.parent_id } }, { status: 200 });
  }

  // 2) Hvis vi flytter IND under en parent, må folderen ikke have børn
  if (parent_id) {
    const { data: childAny, error: chErr } = await sb
      .from("folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("parent_id", id)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    if (chErr) {
      console.error("[folders move] child check error", chErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
    }
    if (childAny) {
      return NextResponse.json(
        { ok: false, code: "NESTING_LIMIT", error: "Kun ét niveau af undermapper er tilladt (folderen har allerede børn)." },
        { status: 409 },
      );
    }
  }

  // 3) Parent-validering (max 1 nesting level)
  if (parent_id) {
    const { data: parent, error: pErr } = await sb
      .from("folders")
      .select("id, owner_id, parent_id, archived_at")
      .eq("id", parent_id)
      .maybeSingle();

    if (pErr) {
      console.error("[folders move] parent lookup error", pErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
    }
    if (!parent || parent.archived_at) {
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

    // kan ikke flytte ind under eget barn (direkte)
    const { data: child, error: cErr } = await sb
      .from("folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("parent_id", id)
      .eq("id", parent_id)
      .is("archived_at", null)
      .maybeSingle();

    if (cErr) {
      console.error("[folders move] cycle check error", cErr);
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
    .from("folders")
    .update({ parent_id })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .select("id, parent_id")
    .maybeSingle();

  if (uErr) {
    console.error("[folders move] update error", uErr);
    return NextResponse.json(
      { ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke flytte folderen." },
      { status: 500 },
    );
  }
  if (!updated) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Folderen findes ikke længere." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, folder: updated }, { status: 200 });
}
