import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export async function POST(req: Request) {
  const requestId = randomUUID();
  const vercelEnv = process.env.VERCEL_ENV ?? null;
  const rawCookieHeader = req.headers.get("cookie") ?? "";
  const cookieNames = rawCookieHeader
    .split(";")
    .map((part) => part.split("=")[0]?.trim())
    .filter(Boolean);

  try {
    const { access_token, refresh_token } = (await req.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!access_token || !refresh_token) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing tokens",
          ...(vercelEnv === "preview"
            ? {
                debug: {
                  requestId,
                  vercelEnv,
                  cookieNames,
                  message: "Missing tokens",
                },
              }
            : {}),
        },
        { status: 400 },
      );
    }

    const supabase = await supabaseServerRoute();
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          ...(vercelEnv === "preview"
            ? {
                debug: {
                  requestId,
                  vercelEnv,
                  cookieNames,
                  message: error.message,
                },
              }
            : {}),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, requestId, vercelEnv }, { status: 200 });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        ...(vercelEnv === "preview"
          ? {
              debug: {
                requestId,
                vercelEnv,
                cookieNames,
                message,
              },
            }
          : {}),
      },
      { status: 500 },
    );
  }
}
