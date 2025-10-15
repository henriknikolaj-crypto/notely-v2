import { supabaseServerRoute } from "@/lib/supabaseServer";
import { requireUser } from "@/lib/auth";
import Link from "next/link";

function decodeSafe(str: string | null | undefined) {
  if (!str) return "";
  try { return decodeURIComponent(escape(str)); } catch { return str; }
}

type Row = {
  id: string;
  question: string;
  score: number | null;
  feedback: string | null;
  created_at: string;
};

export default async function RecentEvaluations() {
  const supabase = await supabaseServerRoute();
  const user = await requireUser();

  const { data, error } = await supabase
    .from("exam_sessions")
    .select("id, question, score, feedback, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("recent exam_sessions error", error);
    return (
      <div className="mt-8 border border-red-200 bg-red-50 text-red-700 p-3 text-sm">
        Kunne ikke hente seneste vurderinger.
      </div>
    );
  }

  const rows = (data ?? []) as Row[];

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold text-neutral-800 mb-3">
        Seneste vurderinger
      </h3>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">
          Ingen vurderinger endnu. Svar på et spørgsmål og tryk “Evaluer mit svar”.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 border border-neutral-200">
          {rows.map((r) => (
            <li key={r.id} className="p-3 bg-white">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-neutral-900 line-clamp-2">
                  <Link
                    href={`/exam/${r.id}`}
                    className="hover:underline"
                    title="Se detaljer"
                  >
                    {decodeSafe(r.question)}
                  </Link>
                </div>
                <div className="shrink-0 text-sm font-medium">
                  {r.score ?? "–"}/100
                </div>
              </div>
              {r.feedback ? (
                <div className="mt-1 text-sm text-neutral-700 line-clamp-2">
                  {decodeSafe(r.feedback)}
                </div>
              ) : null}
              <div className="mt-1 text-xs text-neutral-500">
                {new Date(r.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
