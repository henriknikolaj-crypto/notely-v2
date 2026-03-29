 
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { trackProductEvent } from "@/lib/server/trackProductEvent";

function withRootPath(options?: Record<string, unknown>) {
  return { ...(options ?? {}), path: "/" };
}

function resolvePostAuthPath(rawNext: string | null, rawReturnTo: string | null) {
  const candidate = String(rawNext ?? rawReturnTo ?? "").trim();
  if (!candidate) return "/traener";
  if (!candidate.startsWith("/")) return "/traener";
  if (candidate.startsWith("//")) return "/traener";
  return candidate;
}

function resolveCallbackRedirectPath(flow: string | null, authType: string | null, next: string) {
  if (flow === "signup" || authType === "signup") {
    return `/auth/login?next=${encodeURIComponent(next)}`;
  }
  if (authType === "recovery") {
    return "/auth/reset";
  }
  return next;
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const flow = searchParams.get("flow");
  const authType = searchParams.get("type");
  const rawNext = searchParams.get("next");
  const rawReturnTo = searchParams.get("returnTo");
  const next = resolvePostAuthPath(rawNext, rawReturnTo);
  const redirectPath = resolveCallbackRedirectPath(flow, authType, next);
  const previewDebug = process.env.VERCEL_ENV === "preview";
  const cookiesAttemptedToSet: string[] = [];

  const redirectResponse = NextResponse.redirect(new URL(redirectPath, request.url), { status: 303 });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            cookiesAttemptedToSet.push(cookie.name);
            request.cookies.set(cookie.name, cookie.value);
            redirectResponse.cookies.set(cookie.name, cookie.value, withRootPath(cookie.options));
          }
        },
      },
    },
  );

  let exchangeOk = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const url = new URL("/auth/login", request.url);
      if (authType === "recovery") {
        url.pathname = "/auth/reset";
      }
      url.searchParams.set("error", error.message);
      if (authType !== "recovery") {
        url.searchParams.set("next", next);
      }
      if (previewDebug) {
        console.info("[auth-callback-preview-debug]", {
          requestId,
          hasCode: !!code,
          exchangeOk: false,
          flow,
          authType,
          cookiesAttemptedToSet: Array.from(new Set(cookiesAttemptedToSet)),
          redirectTarget: `${url.pathname}${url.search}`,
        });
      }
      return NextResponse.redirect(url, { status: 303 });
    }
    exchangeOk = true;
  }

  try {
    const { data } = await supabase.auth.getUser();
    const ownerId = String(data?.user?.id ?? "").trim();
    if (ownerId) {
      await trackProductEvent({
        ownerId,
        eventName: "login_completed",
        metadata: { feature: "auth_callback", method: "email_link" },
      });
    }
  } catch {
    // best effort
  }

  if (previewDebug) {
    console.info("[auth-callback-preview-debug]", {
      requestId,
      hasCode: !!code,
      exchangeOk,
      flow,
      authType,
      cookiesAttemptedToSet: Array.from(new Set(cookiesAttemptedToSet)),
      redirectTarget: redirectPath,
    });
  }
  return redirectResponse;
}
