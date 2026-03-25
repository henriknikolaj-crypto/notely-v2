 
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { trackProductEvent } from "@/lib/server/trackProductEvent";

function resolvePostAuthPath(rawNext: string | null, rawReturnTo: string | null) {
  const candidate = String(rawNext ?? rawReturnTo ?? "").trim();
  if (!candidate) return "/traener";
  if (!candidate.startsWith("/")) return "/traener";
  if (candidate.startsWith("//")) return "/traener";
  return candidate;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const rawReturnTo = searchParams.get("returnTo");
  const next = resolvePostAuthPath(rawNext, rawReturnTo);
  console.info("[auth-debug] callback received", {
    rawNext,
    rawReturnTo,
    normalizedNext: next,
    hasCode: !!code,
  });

  const redirectResponse = NextResponse.redirect(new URL(next, request.url), { status: 303 });
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
            request.cookies.set(cookie.name, cookie.value);
            redirectResponse.cookies.set(cookie.name, cookie.value, cookie.options);
          }
        },
      },
    },
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const url = new URL("/auth/login", request.url);
      url.searchParams.set("error", error.message);
      url.searchParams.set("next", next);
      console.info("[auth-debug] callback exchange failed", {
        resolvedNext: next,
        loginRedirect: `${url.pathname}${url.search}`,
        error: error.message,
      });
      return NextResponse.redirect(url, { status: 303 });
    }
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

  console.info("[auth-debug] callback redirecting", {
    normalizedNext: next,
    finalRedirectTarget: next,
  });
  return redirectResponse;
}
