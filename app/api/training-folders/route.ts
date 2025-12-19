// app/api/training-folders/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
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

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function asNonEmpty(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseDateOnly(v: unknown):
  | { ok: true; value: string | null }
  | { ok: false; error: "INVALID_DATE" } {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "INVALID_DATE" };

  const s = v.trim();
  if (!s) return { ok: true, value: null };

  // Accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: true, value: s };

  // Accept ISO-ish -> convert to YYYY-MM-DD if parseable
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return { ok: false, error: "INVALID_DATE" };
  return { ok: true, value: new Date(t).toISOString().slice(0, 10) };
}

/**
 * Regler:
 * - Kræv login i prod, dev-bypass via requireUser (samme mønster som resten).
 * - Én nesting-level:
 *   - parent må ikke selv have parent_id
 *   - en child må ikke have children
 * - Mapper er owner-scopede.
 */

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
};

// GET: list mapper (til Upload-siden m.m.)
export async function GET(req: NextRequest) {
  try {
    const { sb, id: ownerId } = await requireUser(req);

    const { data, error } = await sb
      .from("training_folders")
      .select("id, name, parent_id, start_date, end_date, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[training-folders GET] error:", error);
      return json({ ok: false, error: "FOLDER_LOOKUP_FAILED" }, 500);
    }

    return json({ ok: true, folders: (data ?? []) as FolderRow[] });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");
    if (!isAuth) console.error("[training-folders GET] fatal:", err);
    return json({ ok: false, error: isAuth ? "UNAUTHORIZED" : "UNEXPECTED_ERROR" }, isAuth ? 401 : 500);
  }
}

type CreateFolderBody = {
  name?: string;
  parentId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

// POST: opret ny mappe (bruges af "+ Ny mappe")
export async function POST(req: NextRequest) {
  try {
    const { sb, id: ownerId } = await requireUser(req);

    const parsed = await readJsonBody<CreateFolderBody>(req);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);

    const body = parsed.value ?? {};
    const name = (body.name ?? "").toString().trim();

    const parentIdRaw = asNonEmpty(body.parentId);

    const sd = parseDateOnly(body.startDate);
    if (!sd.ok) return json({ ok: false, error: sd.error }, 400);
    const ed = parseDateOnly(body.endDate);
    if (!ed.ok) return json({ ok: false, error: ed.error }, 400);

    const startDate = sd.value;
    const endDate = ed.value;

    if (!name) return json({ ok: false, error: "MISSING_NAME" }, 400);

    if (startDate && endDate && startDate > endDate) {
      return json({ ok: false, error: "INVALID_DATE_RANGE" }, 400);
    }

    // parent validation (max 1 level nesting)
    let parent_id: string | null = null;

    if (parentIdRaw) {
      if (!isUuidLike(parentIdRaw)) {
        return json({ ok: false, error: "INVALID_PARENT_ID" }, 400);
      }

      const { data: parent, error: parentErr } = await sb
        .from("training_folders")
        .select("id, parent_id")
        .eq("owner_id", ownerId)
        .eq("id", parentIdRaw)
        .maybeSingle();

      if (parentErr) {
        console.error("[training-folders POST] parent lookup error:", parentErr);
        return json({ ok: false, error: "PARENT_LOOKUP_FAILED" }, 500);
      }

      if (!parent?.id) return json({ ok: false, error: "PARENT_NOT_FOUND" }, 400);
      if (parent.parent_id) return json({ ok: false, error: "PARENT_TOO_DEEP" }, 400);

      parent_id = parentIdRaw;
    }

    const { data, error } = await sb
      .from("training_folders")
      .insert({
        owner_id: ownerId,
        name,
        parent_id,
        start_date: startDate,
        end_date: endDate,
      })
      .select("id, name, parent_id, start_date, end_date, created_at")
      .single();

    if (error) {
      console.error("[training-folders POST] insert error:", error);
      return json({ ok: false, error: "FOLDER_INSERT_FAILED" }, 500);
    }

    return json({ ok: true, folder: data as FolderRow });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");
    if (!isAuth) console.error("[training-folders POST] fatal:", err);
    return json({ ok: false, error: isAuth ? "UNAUTHORIZED" : "UNEXPECTED_ERROR" }, isAuth ? 401 : 500);
  }
}

type PatchFolderBody = {
  id?: string; // eller folderId
  folderId?: string;

  name?: string | null;
  parentId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

// PATCH: redigér eksisterende mappe (navn, datoer, parent)
export async function PATCH(req: NextRequest) {
  try {
    const { sb, id: ownerId } = await requireUser(req);

    const parsed = await readJsonBody<PatchFolderBody>(req);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);

    const body = parsed.value ?? {};
    const folderId = asNonEmpty(body.id ?? body.folderId);
    if (!folderId || !isUuidLike(folderId)) {
      return json({ ok: false, error: "MISSING_OR_INVALID_ID" }, 400);
    }

    // load current
    const { data: current, error: curErr } = await sb
      .from("training_folders")
      .select("id, name, parent_id")
      .eq("owner_id", ownerId)
      .eq("id", folderId)
      .maybeSingle();

    if (curErr) {
      console.error("[training-folders PATCH] current lookup error:", curErr);
      return json({ ok: false, error: "FOLDER_LOOKUP_FAILED" }, 500);
    }
    if (!current?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);

    const name =
      body.name === undefined ? undefined : (body.name == null ? "" : String(body.name)).trim();

    const parentIdRaw =
      body.parentId === undefined ? undefined : (body.parentId == null ? null : asNonEmpty(body.parentId));

    const sd = body.startDate === undefined ? { ok: true as const, value: undefined as any } : parseDateOnly(body.startDate);
    if (!sd.ok) return json({ ok: false, error: sd.error }, 400);
    const ed = body.endDate === undefined ? { ok: true as const, value: undefined as any } : parseDateOnly(body.endDate);
    if (!ed.ok) return json({ ok: false, error: ed.error }, 400);

    const startDate: string | null | undefined = (sd as any).value;
    const endDate: string | null | undefined = (ed as any).value;

    if (name !== undefined && !name) return json({ ok: false, error: "MISSING_NAME" }, 400);

    // date range check only if both provided in request (eller en af dem + hent anden? hold simpelt)
    if (startDate !== undefined && endDate !== undefined && startDate && endDate && startDate > endDate) {
      return json({ ok: false, error: "INVALID_DATE_RANGE" }, 400);
    }

    const patch: Record<string, any> = {};

    if (name !== undefined) patch.name = name;
    if (startDate !== undefined) patch.start_date = startDate;
    if (endDate !== undefined) patch.end_date = endDate;

    // parent rules
    if (parentIdRaw !== undefined) {
      // null = gør den til top-level
      if (parentIdRaw === null) {
        patch.parent_id = null;
      } else {
        // validate uuid
        if (!isUuidLike(parentIdRaw)) return json({ ok: false, error: "INVALID_PARENT_ID" }, 400);
        if (parentIdRaw === folderId) return json({ ok: false, error: "PARENT_CANNOT_BE_SELF" }, 400);

        // if this folder has children, it cannot become a child (ellers 2 levels)
        const { count: childCount, error: childErr } = await sb
          .from("training_folders")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", ownerId)
          .eq("parent_id", folderId);

        if (childErr) {
          console.error("[training-folders PATCH] child check error:", childErr);
          return json({ ok: false, error: "CHILD_LOOKUP_FAILED" }, 500);
        }
        if ((childCount ?? 0) > 0) {
          return json({ ok: false, error: "CANNOT_NEST_PARENT_WITH_CHILDREN" }, 400);
        }

        // validate parent exists and is top-level
        const { data: parent, error: parentErr } = await sb
          .from("training_folders")
          .select("id, parent_id")
          .eq("owner_id", ownerId)
          .eq("id", parentIdRaw)
          .maybeSingle();

        if (parentErr) {
          console.error("[training-folders PATCH] parent lookup error:", parentErr);
          return json({ ok: false, error: "PARENT_LOOKUP_FAILED" }, 500);
        }
        if (!parent?.id) return json({ ok: false, error: "PARENT_NOT_FOUND" }, 400);
        if (parent.parent_id) return json({ ok: false, error: "PARENT_TOO_DEEP" }, 400);

        patch.parent_id = parentIdRaw;
      }
    }

    if (Object.keys(patch).length === 0) {
      return json({ ok: true, folder: null, noop: true });
    }

    const { data, error } = await sb
      .from("training_folders")
      .update(patch)
      .eq("owner_id", ownerId)
      .eq("id", folderId)
      .select("id, name, parent_id, start_date, end_date, created_at")
      .single();

    if (error) {
      console.error("[training-folders PATCH] update error:", error);
      return json({ ok: false, error: "FOLDER_UPDATE_FAILED" }, 500);
    }

    return json({ ok: true, folder: data as FolderRow });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");
    if (!isAuth) console.error("[training-folders PATCH] fatal:", err);
    return json({ ok: false, error: isAuth ? "UNAUTHORIZED" : "UNEXPECTED_ERROR" }, isAuth ? 401 : 500);
  }
}

// DELETE /api/training-folders?id=...
export async function DELETE(req: NextRequest) {
  try {
    const { sb, id: ownerId } = await requireUser(req);

    const sp = req.nextUrl.searchParams;
    const folderId = asNonEmpty(sp.get("id") ?? sp.get("folder_id") ?? sp.get("folderId"));
    if (!folderId || !isUuidLike(folderId)) {
      return json({ ok: false, error: "MISSING_OR_INVALID_ID" }, 400);
    }

    // block delete if has children
    const { count: childCount, error: childErr } = await sb
      .from("training_folders")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("parent_id", folderId);

    if (childErr) {
      console.error("[training-folders DELETE] child check error:", childErr);
      return json({ ok: false, error: "CHILD_LOOKUP_FAILED" }, 500);
    }
    if ((childCount ?? 0) > 0) {
      return json({ ok: false, error: "FOLDER_NOT_EMPTY" }, 400);
    }

    const { error } = await sb
      .from("training_folders")
      .delete()
      .eq("owner_id", ownerId)
      .eq("id", folderId);

    if (error) {
      const m = String((error as any)?.message ?? "");
      const isFk = m.toLowerCase().includes("foreign key") || m.toLowerCase().includes("violates");
      console.error("[training-folders DELETE] delete error:", error);
      return json({ ok: false, error: isFk ? "FOLDER_IN_USE" : "FOLDER_DELETE_FAILED" }, isFk ? 409 : 500);
    }

    return json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");
    if (!isAuth) console.error("[training-folders DELETE] fatal:", err);
    return json({ ok: false, error: isAuth ? "UNAUTHORIZED" : "UNEXPECTED_ERROR" }, isAuth ? 401 : 500);
  }
}
