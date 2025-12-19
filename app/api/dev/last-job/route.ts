// app/api/dev/last-job/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const dynamic = "force-dynamic";

function isAuthorizedDev(req: NextRequest): boolean {
  const shared = process.env.IMPORT_SHARED_SECRET;
  const header = req.headers.get("x-shared-secret");

  // 1) Hvis header matcher hemmeligheden → altid OK
  if (shared && header && header === shared) return true;

  // 2) I udvikling (next dev) tillader vi adgang uden header,
  //    så Upload-siden kan kalde endpointet direkte.
  if (process.env.NODE_ENV !== "production") return true;

  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedDev(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized: forkert eller manglende x-shared-secret.",
      },
      { status: 401 }
    );
  }

  const search = req.nextUrl.searchParams;
  const type = search.get("type") ?? undefined;
  const limitParam = search.get("limit");
  const limit = Math.min(
    50,
    Math.max(1, limitParam ? parseInt(limitParam, 10) || 10 : 10)
  );

  const supabase = await supabaseServerRoute();

  let query = supabase
    .from("jobs")
    .select(
      "id, owner_id, file_id, kind, status, payload, result, error, error_message, queued_at, started_at, finished_at, created_at, updated_at, attempts, max_attempts, next_retry_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (type) {
    query = query.eq("kind", type);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("/api/dev/last-job error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Supabase-forespørgsel fejlede.",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    total: count ?? data?.length ?? 0,
    jobs: data ?? [],
  });
}
