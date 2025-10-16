/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export default function ResetPage() {
  const supabase = createBrowserClient();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string|null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    setMsg(error ? error.message : "Kode opdateret. Du kan nu logge ind.");
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Ny adgangskode</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          required
          placeholder="Ny adgangskode"
          value={password}
          onChange={e=>setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
        <button className="px-4 py-2 border rounded">Opdater kode</button>
      </form>
      {msg && <p className="mt-3 text-green-600">{msg}</p>}
{msg && <p className="mt-3 text-green-600">{msg}</p>}
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  );
}



