import { NextResponse } from "next/server";
import { cookies as nextCookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const scoreMin = url.searchParams.get("scoreMin");
    const scoreMax = url.searchParams.get("scoreMax");
    const format = url.searchParams.get("format");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10)));
    const offset = (page - 1) * limit;

    const cookieStore = await nextCookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value; },
          set() {},
          remove() {},
        },
      }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let sel = supabase
      .from("exam_sessions")
      .select("id, created_at, score, question, meta, metadata", { count: "exact" })
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (q) sel = sel.ilike("question", `%${q}%`);
    if (dateFrom) sel = sel.gte("created_at", dateFrom);
    if (dateTo) sel = sel.lte("created_at", dateTo);
    if (scoreMin) sel = sel.gte("score", Number(scoreMin));
    if (scoreMax) sel = sel.lte("score", Number(scoreMax));

    const { data, error, count } = await sel;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items = (data ?? []).map((r: any) => ({
      id: r.id,
      created_at: r.created_at,
      score: r.score ?? null,
      question: r.question ?? "",
      meta: r.meta ?? r.metadata ?? null,
    }));

    if (format === "csv") {
      const rows = [
        ["id", "created_at", "score", "question"],
        ...items.map((r) => [
          r.id,
          r.created_at,
          r.score ?? "",
          (r.question || "").replaceAll('"', '""')
        ])
      ];
      const csv = rows.map(r => r.map(c => `"${String(c)}"`).join(",")).join("\n");
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=exam_history.csv"
        }
      });
    }

    return NextResponse.json({
      page, limit, total: count ?? items.length,
      items
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}

