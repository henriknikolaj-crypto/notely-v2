import "server-only";

import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientUXShell from "./ClientUXShell";

export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {}

  return process.env.DEV_USER_ID ?? null;
}

export default async function TrainerDemoPage() {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="min-h-screen bg-[#fffef9] p-6 text-sm text-zinc-800">
        <p>Du er ikke logget ind.</p>
        <Link href="/auth/login" className="mt-2 inline-block rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50">
          Gå til login
        </Link>
      </main>
    );
  }

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-zinc-900">Træner</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          Træn eksamenslignende spørgsmål og få feedback på dine svar, baseret på et fast demo-materiale.
        </p>
        <div className="mt-3 inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800">
          Demo-materiale
        </div>
        <div className="mt-3 h-px w-full bg-zinc-200" />
      </header>

      <ClientUXShell ownerId={ownerId} />
    </main>
  );
}
