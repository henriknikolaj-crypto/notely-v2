// app/api/folders/route.ts
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // ignore
  }
  return process.env.DEV_USER_ID ?? null;
}

export async function POST(req: Request) {
  try {
    const sb = await supabaseServerRoute();
    const ownerId = await getOwnerId(sb);
    if (!ownerId) {
      return NextResponse.json(
        { error: "Mangler bruger-id (hverken login eller DEV_USER_ID sat)." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = (body.name as string | undefined)?.trim();
    const start_date = body.start_date as string | null | undefined;
    const end_date = body.end_date as string | null | undefined;
    const parent_id = (body.parent_id as string | null | undefined) ?? null;

    if (!name) {
      return NextResponse.json(
        { error: "Navn på mappe er påkrævet." },
        { status: 400 }
      );
    }

    const { data, error } = await sb
      .from("folders")
      .insert({
        owner_id: ownerId,
        name,
        parent_id,
        start_date: start_date || null,
        end_date: end_date || null,
      })
      .select("id,name,start_date,end_date,parent_id,archived_at")
      .single();

    if (error) {
      console.error("folders POST error:", error);
      return NextResponse.json(
        { error: "Kunne ikke oprette mappe." },
        { status: 500 }
      );
    }

    return NextResponse.json({ folder: data }, { status: 200 });
  } catch (err: any) {
    console.error("folders POST uncaught error:", err);
    return NextResponse.json(
      { error: "Uventet fejl i oprettelse af mappe." },
      { status: 500 }
    );
  }
}
