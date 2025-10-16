/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createBrowserClient();
  const [tab, setTab] = useState<"password"|"magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // (valgfrit) sikre profil-række
      if (data?.user) {
        await supabase.from("profiles").upsert({
          id: data.user.id, email: data.user.email, plan: "Freemium",
        });
      }
      location.href = "/exam";
    } catch (e:any) { setMsg(e.message ?? "Login-fejl"); }
    finally { setLoading(false); }
  }

  async function onMagic(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email, options: { emailRedirectTo: `${location.origin}/auth/callback` }
      });
      if (error) throw error;
      setMsg("Tjek din mail for login-link.");
    } catch (e:any) { setMsg(e.message ?? "Fejl"); }
    finally { setLoading(false); }
  }

  async function onReset(e: React.MouseEvent) {
    e.preventDefault(); setMsg(null); setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/auth/reset`
      });
      if (error) throw error;
      setMsg("Hvis e-mail findes, er der sendt en reset-mail.");
    } catch (e:any) { setMsg(e.message ?? "Fejl"); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Log ind</h1>

      <div className="flex gap-2 mb-4">
        <button onClick={()=>setTab("password")} className={`px-3 py-1 border rounded ${tab==="password"?"bg-gray-100":""}`}>Password</button>
        <button onClick={()=>setTab("magic")} className={`px-3 py-1 border rounded ${tab==="magic"?"bg-gray-100":""}`}>Magic link</button>
      </div>

      {tab==="password" ? (
        <form onSubmit={onPassword} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 py-2"/>
          </div>
          <div>
            <label className="block text-sm mb-1">Kodeord</label>
            <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="w-full border rounded px-3 py-2"/>
          </div>
          <div className="flex items-center justify-between">
            <button disabled={loading} className="px-4 py-2 border rounded">{loading?"Logger ind":"Log ind"}</button>
            <a href="#" onClick={onReset} className="text-sm underline">Glemt kode?</a>
          </div>
        </form>
      ) : (
        <form onSubmit={onMagic} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 py-2"/>
          </div>
          <button disabled={loading} className="px-4 py-2 border rounded">{loading?"Sender":"Send magic link"}</button>
        </form>
      )}

      {msg && <p className="mt-3 text-sm">{msg}</p>}
      <p className="mt-4 text-sm">Ingen konto? <a href="/auth/signup" className="underline">Opret en</a></p>
    </div>
  );
}

