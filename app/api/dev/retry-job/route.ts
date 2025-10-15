import { NextRequest } from "next/server";
import { requeueNow } from "@/lib/jobs";

export async function POST(req: NextRequest) {
  try {
    const hdr = req.headers.get("x-shared-secret") || "";
    if (process.env.IMPORT_SHARED_SECRET && hdr !== process.env.IMPORT_SHARED_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { id } = await req.json();
    if (!id) return new Response("Missing id", { status: 400 });

    await requeueNow(id);
    return Response.json({ ok: true });
  } catch (e:any) {
    return new Response(e?.message ?? "error", { status: 500 });
  }
}
