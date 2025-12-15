// app/api/traener/generate-notes/route.ts
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // ignore, falder tilbage til DEV_USER_ID
  }
  return process.env.DEV_USER_ID ?? null;
}

export async function POST(req: Request) {
  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      { ok: false, error: "NO_OWNER" },
      { status: 401 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD_JSON" },
      { status: 400 }
    );
  }

  const modeRaw = body?.mode;
  const folderId: string | null =
    typeof body?.folderId === "string" ? body.folderId : null;
  const fileName: string | null =
    typeof body?.fileName === "string" ? body.fileName : null;

  const mode: "resume" | "golden" =
    modeRaw === "golden" ? "golden" : "resume";

  const titleBase = mode === "golden" ? "Fokus-noter" : "Resumé";
  const title = fileName ? `${titleBase} – ${fileName}` : titleBase;

  const content =
    mode === "golden"
      ? `• Dette er fokus-noter genereret som stub ud fra ${
          fileName ?? "dit materiale"
        }.\n• Når modellen kobles rigtigt på, vil punkterne blive baseret på selve indholdet.\n`
      : `Dette er et kort resumé genereret som stub ud fra ${
          fileName ?? "dit materiale"
        }.\nNår modellen kobles rigtigt på, vil teksten blive baseret på selve indholdet.\n`;

  // Gem i notes-tabellen
  const { data, error } = await sb
    .from("notes")
    .insert({
      owner_id: ownerId,
      title,
      content,
      source_title: "Noter-generator",
      source_url: "/traener/noter",
      folder_id: folderId,
      note_type: mode === "golden" ? "focus" : "resume",
    })
    .select("id,title,content,created_at")
    .single();

  if (error || !data) {
    console.error("generate-notes insert error", error);
    return NextResponse.json(
      { ok: false, error: "INSERT_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    fromLLM: false, // vigtigt: så får du stub-beskeden i UI
    note: data,
  });
}
