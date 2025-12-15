// app/api/mc-submit/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  questionId: string;
  question: string;
  selectedOptionId: string;
  selectedOptionText: string;
  isCorrect: boolean;
  scopeFolderIds?: string[] | null;
  explanation?: string | null;
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // ignore – falder tilbage til DEV_USER_ID
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

    const body = (await req.json()) as Body;

    if (!body?.question || !body?.selectedOptionId || !body.selectedOptionText) {
      return NextResponse.json(
        { error: "Manglende felter i mc-submit body." },
        { status: 400 }
      );
    }

    const score = body.isCorrect ? 100 : 0;
    const folderId =
      Array.isArray(body.scopeFolderIds) && body.scopeFolderIds.length > 0
        ? body.scopeFolderIds[0]
        : null;

    const { error } = await sb.from("exam_sessions").insert({
      owner_id: ownerId,
      question: body.question,
      answer: body.selectedOptionText,
      feedback: body.explanation ?? null,
      score,
      // disse to felter kræver at vi har tilføjet kolonnerne i SQL'en nedenfor
      source_type: "mc",
      folder_id: folderId,
    });

    if (error) {
      console.error("mc-submit insert error:", error);
      return NextResponse.json(
        { error: "Kunne ikke gemme MC-resultat i exam_sessions." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("mc-submit route error:", err);
    return NextResponse.json(
      { error: "Uventet serverfejl i mc-submit." },
      { status: 500 }
    );
  }
}
