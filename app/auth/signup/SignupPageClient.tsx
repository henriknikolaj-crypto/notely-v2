"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { localizeAuthErrorMessage } from "../_lib/localizeAuthError";

function resolvePostAuthPath(rawNext: string | null, rawReturnTo: string | null, defaultTarget: string) {
  const candidate = String(rawNext ?? rawReturnTo ?? "").trim();
  if (!candidate) return defaultTarget;
  if (!candidate.startsWith("/")) return defaultTarget;
  if (candidate.startsWith("//")) return defaultTarget;
  return candidate;
}

function buildAuthSiblingHref(basePath: string, rawNext: string | null, rawReturnTo: string | null, defaultTarget: string) {
  const target = resolvePostAuthPath(rawNext, rawReturnTo, defaultTarget);
  return `${basePath}?next=${encodeURIComponent(target)}`;
}

function resolveAuthRedirectBase() {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://localhost:3000";
}

export default function SignupPageClient() {
  const [supabase] = useState(() => createBrowserClient());
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [awaitingEmailConfirm, setAwaitingEmailConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [defaultTarget, setDefaultTarget] = useState("/traener");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobileViewport = window.matchMedia("(max-width: 767px)").matches;
    setDefaultTarget(isMobileViewport ? "/m" : "/traener");
    console.info("[auth-debug] signup default target", {
      isMobileViewport,
      defaultTarget: isMobileViewport ? "/m" : "/traener",
      rawNext: searchParams.get("next"),
      rawReturnTo: searchParams.get("returnTo"),
    });
  }, [searchParams]);

  async function trackSignupCompleted(ownerId?: string | null) {
    const resolvedOwnerId = String(ownerId ?? "").trim();
    if (!resolvedOwnerId) return;
    try {
      await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          eventName: "signup_completed",
          ownerId: resolvedOwnerId,
          metadata: { feature: "auth_signup" },
        }),
      });
    } catch {
      // best effort
    }
  }

  async function waitForSessionReady() {
    for (let attempt = 0; attempt < 12; attempt++) {
      const sessionRes = await supabase.auth.getSession().catch(() => null);
      if (sessionRes?.data?.session?.access_token) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    return false;
  }

  async function redirectAfterAuth(path: string) {
    await waitForSessionReady();
    window.location.assign(path);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setAwaitingEmailConfirm(false);
    if (password !== password2) { setMsg("Adgangskoderne matcher ikke"); return; }
    setLoading(true);
    try {
      const target = resolvePostAuthPath(searchParams.get("next"), searchParams.get("returnTo"), defaultTarget);
      const authRedirectBase = resolveAuthRedirectBase();
      const rawNext = searchParams.get("next");
      const rawReturnTo = searchParams.get("returnTo");
      console.info("[auth-debug] signup submit:start", {
        email: email.trim().toLowerCase(),
        rawNext,
        rawReturnTo,
        target,
        authRedirectBase,
        location: typeof window !== "undefined" ? window.location.href : null,
      });
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${authRedirectBase}/auth/callback?next=${encodeURIComponent(target)}` }
      });
      console.info("[auth-debug] signup signUp:response", {
        hasUser: !!data?.user,
        hasSession: !!data?.session,
        error: error?.message ?? null,
      });
      if (error) throw error;
      await trackSignupCompleted(data.user?.id ?? null);

      if (!data.session) {
        setAwaitingEmailConfirm(true);
        setMsg(null);
      } else {
        await redirectAfterAuth(target);
      }
    } catch (e: any) {
      console.error("[auth-debug] signup submit:error", {
        message: e?.message ?? "Kunne ikke oprette konto",
        name: e?.name ?? null,
      });
      setMsg(localizeAuthErrorMessage(e?.message, "signup"));
    } finally {
      console.info("[auth-debug] signup submit:finally", { loadingWillBeFalse: true });
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Opret konto</h1>
      {awaitingEmailConfirm ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900">Tjek din email</h2>
          <p className="mt-2">Vi har sendt et bekræftelseslink til din emailadresse.</p>
          <p className="mt-1">Åbn mailen og klik på linket for at aktivere din konto.</p>
          <p className="mt-1">Hvis du ikke kan se mailen, så tjek spam eller uønsket mail.</p>
          <a href={buildAuthSiblingHref("/auth/login", searchParams.get("next"), searchParams.get("returnTo"), defaultTarget)} className="mt-3 inline-block underline">
            Gå til login
          </a>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="block text-sm mb-1">Email</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm mb-1">Kodeord</label>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm mb-1">Gentag kodeord</label>
          <input type="password" required value={password2} onChange={e => setPassword2(e.target.value)} className="w-full border rounded px-3 py-2" />
        </div>
        <button disabled={loading} className="px-4 py-2 border rounded">{loading ? "Opretter" : "Opret konto"}</button>
      </form>
      <p className="mt-4 text-sm">Har du allerede en konto? <a href={buildAuthSiblingHref("/auth/login", searchParams.get("next"), searchParams.get("returnTo"), defaultTarget)} className="underline">Log ind</a></p>
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  );
}
