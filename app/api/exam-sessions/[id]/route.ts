// app/api/exam-sessions/[id]/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function getOwnerId(sb: any): Promise<string | null> {
  // Prøv rigtig auth først (hvis du er logget ind)
  try {
    const { data } = await sb.auth.getUser?.();
    if (data?.user?.id) return data.user.id as string;
  } catch {
    // ignore
  }
  // DEV fallback
  return process.env.DEV_USER_ID ?? null;
}

async function deleteExamSession(id?: string) {
  if (!id) return { ok: false as const, status: 400 as const, error: "Missing id" };

  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  // 1) Find rækken først
  const { data: row, error: fetchError } = await sb
    .from("exam_sessions")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error("[exam-sessions] fetch error", { id, fetchError });
    return { ok: false as const, status: 500 as const, error: "DB error" };
  }

  if (!row) {
    console.warn("[exam-sessions] delete: not found (lookup)", { id });
    return { ok: false as const, status: 404 as const, error: "Not found" };
  }

  // 2) Ejer-tjek (DEV/eller auth)
  if (ownerId && row.owner_id && row.owner_id !== ownerId) {
    console.warn("[exam-sessions] delete: owner mismatch", {
      id,
      rowOwner: row.owner_id,
      reqOwner: ownerId,
    });
    return { ok: false as const, status: 403 as const, error: "Forbidden" };
  }

  // 3) Slet (med owner-filter hvis vi har en)
  let q = sb.from("exam_sessions").delete().eq("id", id);
  if (ownerId) q = q.eq("owner_id", ownerId);

  const { error: deleteError } = await q;

  if (deleteError) {
    console.error("[exam-sessions] delete error", { id, deleteError });
    return { ok: false as const, status: 500 as const, error: "DB delete failed" };
  }

  console.log("[exam-sessions] deleted", { id });
  return { ok: true as const, status: 200 as const };
}

// Direkte DELETE (fx via fetch)
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const result = await deleteExamSession(id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

// POST med _method=DELETE fra formularen på /traener/evalueringer
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const formData = await req.formData().catch(() => null);
  const methodOverride = (formData?.get("_method") || "").toString().toUpperCase();

  if (methodOverride === "DELETE") {
    const result = await deleteExamSession(id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const redirectUrl = new URL("/traener/evalueringer", req.url);
    return NextResponse.redirect(redirectUrl, 303);
  }

  return NextResponse.json({ error: "Unsupported method" }, { status: 405 });
}
