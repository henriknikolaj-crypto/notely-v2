/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const supabase = createBrowserClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [msg, setMsg] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password !== password2) { setMsg("Adgangskoderne matcher ikke"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` }
      });
      if (error) throw error;

      // Hvis e-mailbekræftelse er slået til, er der endnu ingen session.
      if (!data.session) {
        setMsg("Tjek din mail for at bekræfte og logge ind.");
      } else {
        // Hvis bekræftelse er slået FRA, er man logget ind med det samme
        location.href = "/exam";
      }
    } catch (e:any) {
      setMsg(e.message ?? "Kunne ikke oprette konto");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Opret konto</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="block text-sm mb-1">Email</label>
          <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 py-2"/>
        </div>
        <div>
          <label className="block text-sm mb-1">Kodeord</label>
          <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="w-full border rounded px-3 py-2"/>
        </div>
        <div>
          <label className="block text-sm mb-1">Gentag kodeord</label>
          <input type="password" required value={password2} onChange={e=>setPassword2(e.target.value)} className="w-full border rounded px-3 py-2"/>
        </div>
        <button disabled={loading} className="px-4 py-2 border rounded">{loading ? "Opretter" : "Opret konto"}</button>
      </form>
      <p className="mt-4 text-sm">Har du allerede en konto? <a href="/auth/login" className="underline">Log ind</a></p>
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  );
}


