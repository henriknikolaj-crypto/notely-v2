// app/notes/[id]/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

type NoteRow = {
  id: string;
  title: string | null;
  content: string | null;
  created_at: string | null;
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

function formatDT(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d
    .toLocaleString("da-DK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\.$/, "");
}

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NoteDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const scopeParam = typeof sp.scope === "string" ? sp.scope : undefined;
  const trainerScopeParam = typeof sp.tscope === "string" ? sp.tscope : undefined;

  // Byg "tilbage"-link afhængigt af scope
  const backParams = new URLSearchParams();
  let backLabel = "← Tilbage til noter";

  switch (scopeParam) {
    case "resume":
      backParams.set("scope", "resume");
      backLabel = "← Tilbage til resuméer";
      break;
    case "focus":
      backParams.set("scope", "focus");
      backLabel = "← Tilbage til fokus-noter";
      break;
    case "feedback":
    case "evalueringer":
      backParams.set("scope", "feedback");
      if (trainerScopeParam) {
        // husk hvilke mapper der var valgt i Træner
        backParams.set("tscope", trainerScopeParam);
      }
      backLabel = "← Tilbage til Træner-noter";
      break;
    default:
      backLabel = "← Tilbage til noter";
      break;
  }

  const backHref = backParams.toString() ? `/notes?${backParams.toString()}` : "/notes";

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Mangler bruger-id.</p>
      </main>
    );
  }

  const { data, error } = await sb
    .from("notes")
    .select("id,title,content,created_at,note_type")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .single<NoteRow>();

  if (error || !data) {
    console.error("NOTE detail error:", error);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Note ikke fundet.</p>
        <Link href={backHref} className="mt-3 inline-block text-xs text-zinc-600 hover:underline">
          {backLabel}
        </Link>
      </main>
    );
  }

  const titlePrefix =
    data.note_type === "feedback" ||
    data.note_type === "trainer" ||
    data.note_type === "trainer_feedback"
      ? "Træner: "
      : "";

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href={backHref} className="text-xs text-zinc-600 hover:underline">
        {backLabel}
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-zinc-900">
          {titlePrefix}
          {data.title || "Uden titel"}
        </h1>
        <p className="text-xs text-zinc-500">{formatDT(data.created_at)}</p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="prose prose-sm max-w-none whitespace-pre-wrap">{data.content}</div>
      </section>
    </main>
  );
}
