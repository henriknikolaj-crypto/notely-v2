import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

function localizeLoginError(message: unknown) {
  const raw = String(message ?? "").trim();
  const normalized = raw.toLowerCase();
  if (!normalized) return "Noget gik galt. Prøv igen.";
  if (normalized.includes("invalid login credentials")) return "Forkert e-mail eller kodeord.";
  if (normalized.includes("email not confirmed")) return "Bekræft din e-mail, før du logger ind.";
  if (
    normalized.includes("security purposes") ||
    normalized.includes("too many requests") ||
    normalized.includes("rate limit")
  ) {
    return "Du har prøvet for mange gange. Vent lidt og prøv igen.";
  }
  return "Noget gik galt. Prøv igen.";
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const vercelEnv = process.env.VERCEL_ENV ?? null;
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
  const response = NextResponse.json({ ok: true, requestId, vercelEnv }, { status: 200 });

  try {
    const { email, password } = (await req.json()) as {
      email?: string;
      password?: string;
    };

    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    const normalizedPassword = String(password ?? "");

    if (!normalizedEmail || !normalizedPassword) {
      return NextResponse.json({ ok: false, error: "Email og kodeord er påkrævet." }, { status: 400 });
    }

    const supabase = await supabaseServerRoute(req, response);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: normalizedPassword,
    });

    if (error || !data.user?.id) {
      if (vercelEnv === "preview") {
        console.info("[auth-login-preview-debug]", {
          requestId,
          cookieNames,
          success: false,
          cookiesSet: response.cookies.getAll().map((cookie) => cookie.name),
          error: error?.message ?? "Missing user after signInWithPassword",
        });
      }
      return NextResponse.json(
        { ok: false, error: localizeLoginError(error?.message) },
        { status: 401 },
      );
    }

    if (vercelEnv === "preview") {
      console.info("[auth-login-preview-debug]", {
        requestId,
        cookieNames,
        success: true,
        cookiesSet: response.cookies.getAll().map((cookie) => cookie.name),
      });
    }

    response.headers.set("content-type", "application/json");
    return new NextResponse(
      JSON.stringify({
        ok: true,
        requestId,
        vercelEnv,
        userId: String(data.user.id),
        email: data.user.email ?? null,
      }),
      {
        status: 200,
        headers: response.headers,
      },
    );
  } catch (error: any) {
    if (vercelEnv === "preview") {
      console.info("[auth-login-preview-debug]", {
        requestId,
        cookieNames,
        success: false,
        cookiesSet: response.cookies.getAll().map((cookie) => cookie.name),
        error: error?.message ?? "Unknown login error",
      });
    }
    return NextResponse.json(
      { ok: false, error: localizeLoginError(error?.message) },
      { status: 500 },
    );
  }
}
