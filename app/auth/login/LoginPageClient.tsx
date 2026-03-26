"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

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

export default function LoginPageClient() {
  const [supabase] = useState(() => createBrowserClient());
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [defaultTarget, setDefaultTarget] = useState("/traener");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobileViewport = window.matchMedia("(max-width: 767px)").matches;
    setDefaultTarget(isMobileViewport ? "/m" : "/traener");
    console.info("[auth-debug] login default target", {
      isMobileViewport,
      defaultTarget: isMobileViewport ? "/m" : "/traener",
      rawNext: searchParams.get("next"),
      rawReturnTo: searchParams.get("returnTo"),
    });
  }, [searchParams]);

  async function trackLoginCompleted(ownerId?: string | null, metadata?: Record<string, unknown>) {
    const resolvedOwnerId = String(ownerId ?? "").trim();
    if (!resolvedOwnerId) return;
    try {
      await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          eventName: "login_completed",
          ownerId: resolvedOwnerId,
          metadata: metadata ?? { feature: "auth_login", method: "password" },
        }),
      });
    } catch {
      // best effort
    }
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    if (loading) {
      console.info("[auth-debug] login submit ignored because loading=true");
      return;
    }
    const target = resolvePostAuthPath(searchParams.get("next"), searchParams.get("returnTo"), defaultTarget);
    const rawNext = searchParams.get("next");
    const rawReturnTo = searchParams.get("returnTo");
    console.info("[auth-debug] login submit:start", {
      tab: "password",
      email: email.trim().toLowerCase(),
      rawNext,
      rawReturnTo,
      target,
      hasPassword: password.length > 0,
      location: typeof window !== "undefined" ? window.location.href : null,
    });
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);
      console.info("[auth-debug] login server-auth response", {
        ok: res.ok,
        status: res.status,
        error: data?.error ?? null,
      });
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error ?? "Login-fejl"));
      }
      await trackLoginCompleted(data?.userId ?? null, { feature: "auth_login", method: "password" });
      console.info("[auth-debug] login redirect target", { target });
      window.location.assign(target);
    } catch (e: any) {
      console.error("[auth-debug] login submit:error", {
        message: e?.message ?? "Login-fejl",
        name: e?.name ?? null,
      });
      setMsg(e.message ?? "Login-fejl");
    } finally {
      console.info("[auth-debug] login submit:finally", { loadingWillBeFalse: true });
      setLoading(false);
    }
  }

  async function onMagic(e: React.FormEvent) {
    e.preventDefault();
    if (loading) {
      console.info("[auth-debug] magic submit ignored because loading=true");
      return;
    }
    setMsg(null);
    setLoading(true);
    try {
      const target = resolvePostAuthPath(searchParams.get("next"), searchParams.get("returnTo"), defaultTarget);
      const rawNext = searchParams.get("next");
      const rawReturnTo = searchParams.get("returnTo");
      console.info("[auth-debug] magic submit:start", {
        email: email.trim().toLowerCase(),
        rawNext,
        rawReturnTo,
        target,
        location: typeof window !== "undefined" ? window.location.href : null,
      });
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(target)}` }
      });
      console.info("[auth-debug] magic signInWithOtp:response", {
        error: error?.message ?? null,
        target,
      });
      if (error) throw error;
      setMsg("Tjek din mail for login-link.");
    } catch (e: any) {
      console.error("[auth-debug] magic submit:error", {
        message: e?.message ?? "Fejl",
        name: e?.name ?? null,
      });
      setMsg(e.message ?? "Fejl");
    } finally {
      console.info("[auth-debug] magic submit:finally", { loadingWillBeFalse: true });
      setLoading(false);
    }
  }

  async function onReset(e: React.MouseEvent) {
    e.preventDefault(); setMsg(null); setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/auth/reset`
      });
      if (error) throw error;
      setMsg("Hvis e-mail findes, er der sendt en reset-mail.");
    } catch (e: any) { setMsg(e.message ?? "Fejl"); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Log ind</h1>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("password")} className={`px-3 py-1 border rounded ${tab === "password" ? "bg-gray-100" : ""}`}>Password</button>
        <button onClick={() => setTab("magic")} className={`px-3 py-1 border rounded ${tab === "magic" ? "bg-gray-100" : ""}`}>Magic link</button>
      </div>

      {tab === "password" ? (
        <form onSubmit={onPassword} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm mb-1">Kodeord</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div className="flex items-center justify-between">
            <button type="submit" disabled={loading} className="px-4 py-2 border rounded">{loading ? "Logger ind" : "Log ind"}</button>
            <a href="#" onClick={onReset} className="text-sm underline">Glemt kode?</a>
          </div>
        </form>
      ) : (
        <form onSubmit={onMagic} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <button type="submit" disabled={loading} className="px-4 py-2 border rounded">{loading ? "Sender" : "Send magic link"}</button>
        </form>
      )}

      {msg && <p className="mt-3 text-sm">{msg}</p>}
      <p className="mt-4 text-sm">Ingen konto? <a href={buildAuthSiblingHref("/auth/signup", searchParams.get("next"), searchParams.get("returnTo"), defaultTarget)} className="underline">Opret en</a></p>
    </div>
  );
}
