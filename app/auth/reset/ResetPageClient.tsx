"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export default function ResetPageClient() {
  const [supabase] = useState(() => createBrowserClient());
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const resetLinkError =
    "Linket til nulstilling er ugyldigt eller udløbet. Bed om en ny email for at ændre din adgangskode.";

  useEffect(() => {
    let alive = true;

    function markSessionReady() {
      if (!alive) return;
      setSessionReady(true);
      setCheckingSession(false);
      setStatus((current) => (current?.type === "error" && current.text === resetLinkError ? null : current));
    }

    async function prepareRecoverySession() {
      const code = searchParams.get("code");
      const errorDescription = searchParams.get("error_description") || searchParams.get("error");
      const hashParams =
        typeof window !== "undefined" && window.location.hash.startsWith("#")
          ? new URLSearchParams(window.location.hash.slice(1))
          : null;
      const accessToken = hashParams?.get("access_token") || "";
      const refreshToken = hashParams?.get("refresh_token") || "";
      const hashType = hashParams?.get("type") || "";

      if (errorDescription) {
        if (alive) {
          setStatus({ type: "error", text: resetLinkError });
          setCheckingSession(false);
        }
        return;
      }

      try {
        const existingSession = await supabase.auth.getSession();
        if (!alive) return;
        if (existingSession.data.session) {
          markSessionReady();
          return;
        }

        if (accessToken && refreshToken && hashType === "recovery") {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;

          await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: accessToken,
              refresh_token: refreshToken,
            }),
          }).catch(() => null);

          window.history.replaceState({}, "", window.location.pathname + window.location.search);
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        for (let attempt = 0; attempt < 12; attempt += 1) {
          const { data } = await supabase.auth.getSession();
          if (!alive) return;

          if (data.session) {
            markSessionReady();
            return;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (!alive) return;
        if (!userError && userData.user) {
          markSessionReady();
          return;
        }

        if (alive) {
          setStatus({ type: "error", text: resetLinkError });
          setCheckingSession(false);
        }
      } catch {
        if (alive) {
          setStatus({ type: "error", text: resetLinkError });
          setCheckingSession(false);
        }
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive || !session) return;
      markSessionReady();
    });

    void prepareRecoverySession();
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [searchParams, supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    if (!sessionReady) {
      setStatus({
        type: "error",
        text: "Din nulstillingssession mangler eller er udløbet. Bed om en ny email for at ændre din adgangskode.",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setStatus({
        type: "success",
        text: "Din adgangskode er opdateret. Du kan nu logge ind.",
      });
    } catch (error: any) {
      const message = String(error?.message || "").toLowerCase();
      const isSamePasswordError =
        message.includes("same password") ||
        message.includes("should be different") ||
        message.includes("password should be different") ||
        message.includes("cannot be the same") ||
        message.includes("different from the old password");

      setStatus({
        type: "error",
        text: isSamePasswordError
          ? "Du kan ikke bruge den samme adgangskode igen. Vælg en ny adgangskode."
          : "Kunne ikke opdatere adgangskoden. Bed om en ny nulstillingsmail og prøv igen.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Ny adgangskode</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          required
          minLength={8}
          placeholder="Ny adgangskode"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2"
          disabled={!sessionReady || checkingSession || loading}
        />
        <button disabled={!sessionReady || checkingSession || loading} className="px-4 py-2 border rounded disabled:opacity-50">
          {loading ? "Opdaterer..." : "Opdater kode"}
        </button>
      </form>
      {checkingSession ? <p className="mt-3 text-sm text-zinc-600">Vi gør nulstillingslinket klar…</p> : null}
      {status && !(sessionReady && status.type === "error" && status.text === resetLinkError) ? (
        <p className={`mt-3 text-sm ${status.type === "error" ? "text-red-600" : "text-green-700"}`}>{status.text}</p>
      ) : null}
      <p className="mt-4 text-sm">
        <a href="/auth/login" className="underline">
          Tilbage til login
        </a>
      </p>
    </div>
  );
}
