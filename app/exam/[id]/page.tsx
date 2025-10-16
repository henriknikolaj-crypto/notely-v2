import Link from "next/link";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import DeleteButton from "./DeleteButton";
import type { CookieOptions } from "@supabase/ssr";

export default async function ExamDetailPage(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll(cookiesToSet) { try { cookiesToSet.forEach(({ name, value, options }) => { cookieStore.set(name, value, options as CookieOptions); }); } catch {} } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <div>Du skal være logget ind.</div>;

  const { data, error } = await supabase
    .from("exam_sessions")
    .select("id, question, answer, feedback, score, created_at, model")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) return <div>Ikke fundet.</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/exam" className="text-sm underline">&larr; Tilbage</Link>
      <h1 className="text-2xl font-semibold mt-2">Vurdering</h1>
      <div className="text-sm text-gray-600">{new Date(data.created_at).toLocaleString()}</div>

      <section className="mt-4 rounded-xl border bg-white p-4">
        <h2 className="font-medium mb-1">Spørgsmål</h2>
        <p>{data.question}</p>
      </section>

      <section className="mt-4 rounded-xl border bg-white p-4">
        <h2 className="font-medium mb-1">Dit svar</h2>
        <p className="whitespace-pre-wrap">{data.answer}</p>
      </section>

      <section className="mt-4 rounded-xl border bg-white p-4">
        <h2 className="font-medium mb-1">Feedback</h2>
        <p className="whitespace-pre-wrap">{data.feedback}</p>
      </section>

      <div className="mt-4 font-medium">Score: {data.score}/100</div>

      <DeleteButton id={data.id} />
    </div>
  );
}



