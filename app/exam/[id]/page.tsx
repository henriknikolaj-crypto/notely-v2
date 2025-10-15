import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { getExamSessionById } from "@/lib/data/examSessions";
import DeleteButton from "@/app/components/DeleteButton";

function formatScore(score: number | null) {
  if (score === null || Number.isNaN(score)) return "";
  return `${Math.round((score ?? 0) * 100)}%`;
}
function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("da-DK", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export default async function ExamDetail({ params }: { params: { id: string } }) {
  await requireUser();
  const item = await getExamSessionById(params.id);
  if (!item) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">Vurderingen findes ikke (eller du har ikke adgang).</p>
        <Link href="/exam/history" className="text-sm underline">Tilbage til historik</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vurdering</h1>
        <div className="flex items-center gap-3">
          <Link href="/exam/history" className="text-sm underline">Historik</Link>
          <DeleteButton id={params.id} redirectTo="/exam/history" />
        </div>
      </div>

      <div className="rounded-2xl border bg-white/60 p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{item.question || "(Uden spørgsmålstekst)"}</p>
            <p className="text-xs text-neutral-500">{formatDate(item.created_at)}</p>
          </div>
          <div className="text-right shrink-0 w-28">
            <div className="text-sm font-semibold">{formatScore(item.score)}</div>
          </div>
        </div>

        {item.feedback ? (
          <div>
            <h3 className="text-sm font-semibold">Feedback</h3>
            <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap">{item.feedback}</p>
          </div>
        ) : null}

        {item.answer ? (
          <div>
            <h3 className="text-sm font-semibold">Dit svar</h3>
            <pre className="mt-1 text-sm whitespace-pre-wrap rounded-xl border bg-white/70 p-3">{item.answer}</pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}