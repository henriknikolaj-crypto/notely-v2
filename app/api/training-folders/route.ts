// app/api/training-folders/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

// GET: brugt af Upload-siden (og kan bruges andre steder) til at liste mapper
export async function GET(_req: Request) {
  try {
    const sb = await supabaseServerRoute();

    const { data, error } = await sb
      .from("training_folders")
      .select("id, name, parent_id, start_date, end_date, owner_id")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("training-folders GET error", error);
      return json(
        { ok: false, error: "FOLDER_LOOKUP_FAILED" },
        500,
      );
    }

    console.log(
      "[training-folders GET] rows:",
      (data ?? []).length,
    );

    return json({
      ok: true,
      folders: data ?? [],
    });
  } catch (err) {
    console.error("training-folders GET fatal", err);
    return json(
      { ok: false, error: "UNEXPECTED_ERROR" },
      500,
    );
  }
}

// POST: opret ny mappe (bruges af "+ Ny mappe" i venstre kolonne)
export async function POST(req: Request) {
  try {
    const sb = await supabaseServerRoute();

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return json(
        { ok: false, error: "INVALID_JSON" },
        400,
      );
    }

    const name = (body?.name ?? "").trim();
    const parentId = body?.parentId ?? null;
    const startDate = body?.startDate ?? null;
    const endDate = body?.endDate ?? null;
    const ownerId =
      (body?.ownerId as string | undefined) ??
      process.env.DEV_USER_ID ??
      null;

    if (!name) {
      return json(
        { ok: false, error: "MISSING_NAME" },
        400,
      );
    }

    if (!ownerId) {
      console.error(
        "training-folders POST: no ownerId (dev fallback mangler)",
      );
      return json(
        { ok: false, error: "NO_OWNER_ID" },
        500,
      );
    }

    const { data, error } = await sb
      .from("training_folders")
      .insert({
        owner_id: ownerId,
        name,
        parent_id: parentId,
        start_date: startDate,
        end_date: endDate,
      })
      .select("id, name, parent_id, start_date, end_date, owner_id")
      .single();

    if (error) {
      console.error("training-folders POST error", error);
      return json(
        { ok: false, error: "FOLDER_INSERT_FAILED" },
        500,
      );
    }

    return json({
      ok: true,
      folder: data,
    });
  } catch (err) {
    console.error("training-folders POST fatal", err);
    return json(
      { ok: false, error: "UNEXPECTED_ERROR" },
      500,
    );
  }
}
