import { NextRequest } from "next/server";
import { requeueNow } from "@/lib/jobs";

function pickId(req: NextRequest): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("id");
  return q && q.trim() ? q.trim() : null;
}

export async function POST(req: NextRequest) {
  try {
    const hdr = req.headers.get("x-shared-secret") || "";
    if (process.env.IMPORT_SHARED_SECRET && hdr !== process.env.IMPORT_SHARED_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let id = pickId(req);

    if (!id) {
      try {
        const b: any = await req.json();
        if (b?.id) id = String(b.id).trim();
      } catch {}
    }

    if (!id) return new Response("Missing id", { status: 400 });

    await requeueNow(id);
    return Response.json({ ok: true, id });
  } catch (e: any) {
    return new Response(e?.message ?? "error", { status: 500 });
  }
}
