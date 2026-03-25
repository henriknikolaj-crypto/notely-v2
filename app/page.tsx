import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import Link from "next/link";
import HeaderClient from "@/app/components/HeaderClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  let userEmail: string | null = null;
  try {
    const sb = await supabaseServerRSC();
    const { data } = await sb.auth.getUser();
    userEmail = data?.user?.email ?? null;
  } catch {
    userEmail = null;
  }
  console.info("[auth-debug] root render", {
    hasUser: !!userEmail,
    path: "/",
    redirecting: false,
  });

  return (
    <main className="min-h-screen bg-[#fffef9]">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 md:px-6">
          <Link href="/" className="logo-script [font-family:var(--font-logo)] text-4xl leading-none text-zinc-900">
            Notely.
          </Link>
          <HeaderClient userEmail={userEmail} />
        </div>
      </header>

      <div className="px-4 py-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold text-zinc-900">Notely</h1>
          <p className="mt-2 text-sm text-zinc-600">Vælg hvor du vil starte.</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/traener" className="rounded-full bg-black px-5 py-2 text-sm font-semibold text-white">
              Gå til Træner
            </Link>
            <Link href="/m" className="rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-semibold text-zinc-900">
              Åbn mobil-hub
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
