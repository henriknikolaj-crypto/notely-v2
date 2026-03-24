 
"use client";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export default function ResetPage() {
  const supabase = createBrowserClient();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function prepareRecoverySession() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState({}, "", "/auth/reset");
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          window.history.replaceState({}, "", "/auth/reset");
        }

        if (!cancelled) setReady(true);
      } catch (error: any) {
        if (!cancelled) {
          setStatus({ type: "error", text: error?.message ?? "Reset-linket er ugyldigt eller udløbet." });
          setReady(true);
        }
      }
    }

    void prepareRecoverySession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setStatus(null);
    const { error } = await supabase.auth.updateUser({ password });
    setStatus(
      error
        ? { type: "error", text: error.message }
        : { type: "success", text: "Kode opdateret. Du kan nu logge ind." },
    );
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Ny adgangskode</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          required
          disabled={!ready}
          placeholder="Ny adgangskode"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
        <button disabled={!ready} className="px-4 py-2 border rounded">Opdater kode</button>
      </form>
      {status && (
        <p className={`mt-3 text-sm ${status.type === "error" ? "text-red-600" : "text-green-600"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}


