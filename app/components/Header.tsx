import Link from "next/link";
import HeaderClient from "./HeaderClient";
import { supabaseServerRSC } from "@/lib/supabase/server";

export default async function ServerHeader() {
  const supabase = await supabaseServerRSC();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <HeaderClient>
      <header className="w-full border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/40">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xl font-semibold tracking-tight">
              Notely <span className="text-sm align-top text-neutral-400">β</span>
            </Link>
            <nav className="ml-6 hidden md:flex gap-4 text-sm text-neutral-700">
              <Link href="/exam" className="hover:text-black">Eksamen</Link>
              <Link href="/dev/jobs" className="hover:text-black">Dev / Jobs</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm text-neutral-600 hidden sm:inline">{user.email}</span>
                <a href="/auth/logout" className="rounded-xl border px-3 py-1.5 text-sm hover:bg-neutral-50">Log ud</a>
              </>
            ) : (
              <Link href="/auth/login" className="rounded-xl border px-3 py-1.5 text-sm hover:bg-neutral-50">Log ind</Link>
            )}
          </div>
        </div>
      </header>
    </HeaderClient>
  );
}

