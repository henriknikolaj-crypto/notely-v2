// app/overblik/layout.tsx
import "server-only";

import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import TrainingSidebarMainNav from "../traener/ui/TrainingSidebarMainNav";
import TrainingSidebarFolders from "../traener/ui/TrainingSidebarFolders";
import TrainingSidebarStats from "../traener/ui/TrainingSidebarStats";

type FolderRow = {
  id: string;
  name: string;
  parent_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  archived_at?: string | null;
};

type LatestNoteRow = {
  id: string;
  title: string | null;
  note_type: string | null;
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {}
  return process.env.DEV_USER_ID ?? null;
}

export const dynamic = "force-dynamic";

export default async function OverblikLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="min-h-screen bg-[#fffef9]">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
            <Link href="/" className="logo-script text-4xl leading-none">
              Notely.
            </Link>
            <Link
              href="/auth/login"
              className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
            >
              Log ind
            </Link>
          </div>
        </header>
        <div className="mx-auto max-w-6xl p-6">
          <h1 className="mb-2 text-2xl font-semibold">Overblik</h1>
          <p className="text-sm text-red-600">
            Mangler bruger-id (hverken login eller DEV_USER_ID sat).
          </p>
        </div>
      </main>
    );
  }

  // ---- Mapper til venstre træ ----
  const { data: foldersData, error: foldersError } = await sb
    .from("folders")
    .select("id,name,parent_id,start_date,end_date,archived_at")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (foldersError) console.error("OVERBLIK layout folders error:", foldersError);

  const folders = (foldersData ?? []) as FolderRow[];
  const foldersForSidebar = folders.map((f) => ({
    ...f,
    parent_id: f.parent_id ?? null,
  }));

  // ---- Seneste noter ----
  const { data: latestNotesData } = await sb
    .from("notes")
    .select("id,title,note_type")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(20);

  const latestNotes = (latestNotesData ?? []) as LatestNoteRow[];

  // ---- Seneste evalueringer ----
  const { data: latestEvalsData } = await sb
    .from("exam_sessions")
    .select("id,score,created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);

  const latestEvals =
    (latestEvalsData as {
      id: string;
      score: number | null;
      created_at: string | null;
    }[]) ?? [];

  // ---- Counts (NB: count kan være null) ----
  const { count: notesCountRaw } = await sb
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);

  const { count: evalCountRaw } = await sb
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);

  const notesCount = notesCountRaw ?? 0;
  const evalCount = evalCountRaw ?? 0;

  return (
    <main className="min-h-screen bg-[#fffef9]">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <Link href="/overblik" className="logo-script text-4xl leading-none">
            Notely.
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-700">henriknikolaj@gmail.com</span>
            <Link
              href="/auth/logout"
              className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
            >
              Log ud
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6 md:px-6">
        <aside className="w-64 shrink-0">
          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-3 text-sm shadow-sm">
            <div className="px-2 pb-1 pt-1 font-semibold text-zinc-800">Mit Notely</div>

            <TrainingSidebarMainNav />

            <div className="px-2 pt-2 font-semibold text-zinc-800">Dine fag</div>
            <TrainingSidebarFolders folders={foldersForSidebar} />

            <TrainingSidebarStats
              latestNotes={latestNotes}
              latestEvals={latestEvals}
              notesCount={notesCount}
              evalCount={evalCount}
            />
          </div>
        </aside>

        <section className="min-w-0 flex-1 bg-transparent">{children}</section>
      </div>
    </main>
  );
}
