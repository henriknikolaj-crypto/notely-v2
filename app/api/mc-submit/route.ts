// app/api/mc-submit/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  questionId?: string;
  question?: string;
  selectedOptionId?: string;
  selectedOptionText?: string;
  isCorrect?: boolean;
  scopeFolderIds?: string[] | null;
  explanation?: string | null;
};

function uniqTrimmed(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ids) {
    const s = typeof x === "string" ? x.trim() : "";
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function readJsonBody<T>(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true as const, value: {} as T };
  try {
    return { ok: true as const, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
}

export async function POST(req: NextRequest) {
  try {
    // Auth/dev-bypass (samme mønster som andre routes)
    let sb: any;
    let ownerId = "";
    let mode: "auth" | "dev" = "auth";

    try {
      const u = await requireUser(req);
      sb = u.sb;
      ownerId = u.id;
      mode = u.mode;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const isAuth = msg.toLowerCase().includes("unauthorized");
      if (!isAuth) console.error("[mc-submit] requireUser crash:", e);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await readJsonBody<Body>(req);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const body = parsed.value ?? {};

    const questionId = String(body.questionId ?? "").trim();
    const question = String(body.question ?? "").trim();
    const selectedOptionId = String(body.selectedOptionId ?? "").trim();
    const selectedOptionText = String(body.selectedOptionText ?? "").trim();
    const isCorrect = !!body.isCorrect;

    if (!questionId || !question || !selectedOptionId || !selectedOptionText) {
      return NextResponse.json(
        { ok: false, error: "Manglende felter i mc-submit body." },
        { status: 400 },
      );
    }

    const scopeFolderIds = uniqTrimmed(body.scopeFolderIds);
    const folderId = scopeFolderIds.length ? scopeFolderIds[0] : null;

    const score = isCorrect ? 100 : 0;

    const explanation = String(body.explanation ?? "").trim();
    const feedback =
      explanation ||
      (isCorrect ? "Korrekt." : "Ikke korrekt. Gennemgå forklaringen og prøv igen.");

    const answerText = `${selectedOptionId}: ${selectedOptionText}`;

    const { error } = await sb.from("exam_sessions").insert({
      owner_id: ownerId,
      question,
      answer: answerText,
      feedback,
      score,
      source_type: "mc",
      folder_id: folderId,
      meta: {
        mode,
        questionId,
        selectedOptionId,
        selectedOptionText,
        isCorrect,
        scopeFolderIds,
      },
    });

    if (error) {
      console.error("[mc-submit] exam_sessions insert error:", error);
      return NextResponse.json(
        { ok: false, error: "Kunne ikke gemme MC-resultat i exam_sessions." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, score }, { status: 200 });
  } catch (err: any) {
    console.error("[mc-submit] route error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Uventet serverfejl i mc-submit." },
      { status: 500 },
    );
  }
}
