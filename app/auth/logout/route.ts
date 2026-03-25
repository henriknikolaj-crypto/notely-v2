// app/auth/logout/route.ts
import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

function resolveNext(rawNext: string | null) {
  const candidate = String(rawNext ?? "").trim();
  if (!candidate) return null;
  if (!candidate.startsWith("/")) return null;
  if (candidate.startsWith("//")) return null;
  return candidate;
}

export async function GET(request: NextRequest) {
  const supabase = await supabaseServerRSC();

  try {
    const { error } = await supabase.auth.signOut();

    // Ignorér "ingen session"/refresh token fejl i dev,
    // log kun uventede fejl.
    if (
      error &&
      error.code !== "refresh_token_not_found" &&
      error.code !== "session_not_found"
    ) {
      console.error("Logout error:", error);
    }
  } catch (e) {
    console.error("Logout exception:", e);
  }

  const requestedNext = resolveNext(new URL(request.url).searchParams.get("next"));
  const location = requestedNext
    ? `/auth/login?next=${encodeURIComponent(requestedNext)}`
    : "/auth/login";
  console.info("[auth-debug] logout redirect", {
    requestedNext,
    redirectTo: location,
  });
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
    },
  });
}
