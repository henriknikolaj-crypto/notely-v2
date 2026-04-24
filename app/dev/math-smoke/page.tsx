import MathMarkdown from "@/components/ui/MathMarkdown";
import { MATH_SMOKE_FIXTURES, MATH_SMOKE_SURFACE_PREVIEWS } from "@/lib/matematik/smokeFixtures";
import { notFound } from "next/navigation";

function badgeTone(kind: string) {
  if (kind === "invalid-soft-fail") return "bg-amber-100 text-amber-900 border-amber-200";
  if (kind === "aligned" || kind === "cases") return "bg-sky-100 text-sky-900 border-sky-200";
  if (kind === "block") return "bg-emerald-100 text-emerald-900 border-emerald-200";
  return "bg-neutral-100 text-neutral-800 border-neutral-200";
}

function surfaceLabel(surface: string) {
  switch (surface) {
    case "trainer-feedback":
      return "Traener-feedback";
    case "mc-explanation":
      return "MC explanation";
    case "flashcards-front":
      return "Flashcards front";
    case "flashcards-back":
      return "Flashcards back";
    default:
      return surface;
  }
}

export default function MathSmokePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">Dev / Math Smoke</p>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Math smoke-suite</h1>
          <p className="max-w-3xl text-sm leading-6 text-neutral-600">
            Denne side renderer centrale math-fixtures gennem den eksisterende <code>MathMarkdown</code>, sa vi
            hurtigt kan tjekke KaTeX, normalisering, step-by-step layout og soft-fail ved ugyldig math.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
          <span className="rounded-full border border-neutral-200 bg-white px-3 py-1">
            {MATH_SMOKE_FIXTURES.length} fixtures samlet et sted
          </span>
          <span className="rounded-full border border-neutral-200 bg-white px-3 py-1">
            Daekker inline, block, aligned, cases og invalid-soft-fail
          </span>
          <span className="rounded-full border border-neutral-200 bg-white px-3 py-1">
            Bruges som manuel reference for notes, traener, eksamen, MC og flashcards
          </span>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
        {Object.entries(MATH_SMOKE_SURFACE_PREVIEWS).map(([key, preview]) => (
          <article key={key} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">{preview.title}</p>
            <MathMarkdown
              content={preview.content}
              preserveWhitespace
              className="text-sm leading-6 text-neutral-900 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1 [&_p]:my-0"
            />
          </article>
        ))}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-neutral-950">Fixtures</h2>
          <p className="text-sm text-neutral-600">
            Hver case viser baade kildeindhold og renderet output. Den ugyldige case maa gerne se forkert ud, men
            siden maa ikke crashe.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {MATH_SMOKE_FIXTURES.map((fixture) => (
            <article key={fixture.id} className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
              <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-neutral-950">{fixture.title}</h3>
                  {fixture.renderKinds.map((kind) => (
                    <span
                      key={kind}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${badgeTone(kind)}`}
                    >
                      {kind}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-sm text-neutral-600">{fixture.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {fixture.surfaces.map((surface) => (
                    <span
                      key={surface}
                      className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] text-neutral-600"
                    >
                      {surfaceLabel(surface)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-0 border-neutral-200 md:grid-cols-2">
                <div className="border-b border-neutral-200 p-5 md:border-b-0 md:border-r">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">Fixture source</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-neutral-950 p-4 text-xs leading-6 text-neutral-100">
                    {fixture.content}
                  </pre>
                </div>
                <div className="p-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">Rendered via MathMarkdown</p>
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <MathMarkdown
                      content={fixture.content}
                      preserveWhitespace
                      className="text-sm leading-6 text-neutral-900 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1"
                    />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
