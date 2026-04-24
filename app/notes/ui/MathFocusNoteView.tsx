"use client";

import MathMarkdown from "@/components/ui/MathMarkdown";
import type { MathRenderedNote, MathRenderedNoteBlock } from "@/lib/notes/mathRenderedNote";

type Props = {
  note: MathRenderedNote;
};

const KIND_LABELS: Record<MathRenderedNoteBlock["kind"], string> = {
  rule: "Regel",
  method: "Metode",
  concept: "Begreb",
  example: "Eksempel",
  pitfall: "Faldgrube",
};

function Formula({ latex, inline = false }: { latex: string; inline?: boolean }) {
  return (
    <MathMarkdown
      content={inline ? `$${latex}$` : `$$\n${latex}\n$$`}
      className={inline ? "text-zinc-900 [&_p]:my-0" : "text-zinc-900 [&_p]:my-0"}
    />
  );
}

function BlockCard({ block }: { block: MathRenderedNoteBlock }) {
  const meta = [KIND_LABELS[block.kind], block.topicGroup, block.sourceLabel].filter(Boolean).join(" · ");

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold text-zinc-900">{block.title}</h3>
        {meta ? <p className="text-[11px] uppercase tracking-wide text-zinc-500">{meta}</p> : null}
      </div>

      <div className="mt-3 space-y-3 text-[15px] leading-7 text-zinc-700">
        {block.explanation ? <p>{block.explanation}</p> : null}

        {block.formulaLatex ? (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Formel</div>
            <Formula latex={block.formulaLatex} />
          </div>
        ) : null}

        {block.steps?.length ? (
          <ul className="space-y-1 pl-5 text-zinc-700">
            {block.steps.map((step, index) => (
              <li key={`${block.id}-step-${index}`}>{step}</li>
            ))}
          </ul>
        ) : null}

        {block.usageText ? <p><span className="font-semibold text-zinc-900">Bruges til:</span> {block.usageText}</p> : null}
        {block.meaningText ? <p><span className="font-semibold text-zinc-900">Det vil sige:</span> {block.meaningText}</p> : null}
        {block.warningText ? <p><span className="font-semibold text-zinc-900">Pas på:</span> {block.warningText}</p> : null}
        {block.notationLatex ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-900">Notation:</span>
            <div className="min-w-0 flex-1"><Formula latex={block.notationLatex} inline /></div>
          </div>
        ) : null}
        {block.exampleText ? <p><span className="font-semibold text-zinc-900">Eksempel:</span> {block.exampleText}</p> : null}
        {!block.exampleText && block.exampleLatex ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-900">Eksempel:</span>
            <div className="min-w-0 flex-1"><Formula latex={block.exampleLatex} inline /></div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function MathFocusNoteView({ note }: Props) {
  return (
    <div className="space-y-6 text-zinc-700">
      <section className="space-y-3">
        {note.intro.title ? <h2 className="text-base font-semibold text-zinc-900">{note.intro.title}</h2> : null}
        {note.intro.paragraphs.map((paragraph, index) => (
          <p key={`intro-${index}`} className="text-[15px] leading-7">
            {paragraph}
          </p>
        ))}
      </section>

      {note.overview.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900">Emneoversigt</h2>
          <div className="space-y-2">
            {note.overview.map((item) => (
              <div key={item.topic} className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-3">
                <p className="font-semibold text-zinc-900">{item.topic}</p>
                <p className="mt-1 text-[14px] leading-6 text-zinc-700">{item.summary}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {note.keyFormulas.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900">Nøgleformler</h2>
          <div className="grid gap-3">
            {note.keyFormulas.map((formula) => (
              <article key={`${formula.title}-${formula.formulaLatex}`} className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-4">
                <div className="space-y-1">
                  <h3 className="text-[15px] font-semibold text-zinc-900">{formula.title}</h3>
                  {formula.sourceLabel ? <p className="text-[11px] uppercase tracking-wide text-zinc-500">{formula.sourceLabel}</p> : null}
                </div>
                <div className="mt-3">
                  <Formula latex={formula.formulaLatex} />
                </div>
                {formula.explanation ? <p className="mt-2 text-[14px] leading-6 text-zinc-700">{formula.explanation}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900">Vidensblokke</h2>
        <div className="space-y-3">
          {note.blocks.map((block) => (
            <BlockCard key={block.id} block={block} />
          ))}
        </div>
      </section>
    </div>
  );
}
