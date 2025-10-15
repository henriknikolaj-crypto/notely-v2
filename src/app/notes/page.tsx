import PageShell from "@/app/_ui/PageShell";
import { createServerClient } from "@/lib/supabase/server";
import { NewNoteForm, DeleteNoteBtn } from "./_actions";
import Link from "next/link";

export default async function NotesPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="p-6">
        <p>Du er ikke logget ind.</p>
        <Link className="underline" href="/auth/login">Log ind</Link>
      </div>
    );
  }

  const { data: notes, error } = await supabase
    .from("notes")
    .select("id, title, content, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return <div className="p-6 text-red-600">Kunne ikke hente noter.</div>;

  const isEmpty = !notes || notes.length === 0;

  return (
    <PageShell title="Noter">
      <NewNoteForm />
      {isEmpty ? (
        <div className="border rounded-md p-6 text-sm text-gray-600">
          Ingen noter endnu. Opret din første note ovenfor.
        </div>
      ) : (
        <ul className="list-none divide-y">
          {notes.map((n) => (
            <li key={n.id} className="py-3 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Link href={`/notes/${n.id}`} className="font-medium underline">
                  {n.title}
                </Link>
                <DeleteNoteBtn id={n.id} />
              </div>
              {n.content && <p className="text-sm text-gray-700 line-clamp-3">{n.content}</p>}
              <p className="text-xs text-gray-500">Oprettet: {new Date(n.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}