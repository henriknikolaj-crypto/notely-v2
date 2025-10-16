import { supabaseServerRSC } from "@/lib/supabase/server";
import EditNoteForm from "./_EditNoteForm";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function NoteDetailPage({ params }: { params: { id: string } }) {
  const supabase = await supabaseServerRSC();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("notes")
    .select("id, owner_id, title, content, created_at")
    .eq("id", params.id)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-red-600">Noten blev ikke fundet.</p>
        <Link className="underline" href="/notes">Tilbage</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-4"><Link className="underline" href="/notes">← Tilbage til noter</Link></div>
      <h1 className="text-2xl font-semibold mb-2">Rediger note</h1>
      <p className="text-sm text-gray-500 mb-6">Oprettet: {new Date(data.created_at).toLocaleString()}</p>
      <EditNoteForm note={data} />
    </div>
  );
}

