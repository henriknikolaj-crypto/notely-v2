"use client";

import { type ReactNode, useEffect, useMemo } from "react";
import type { Components } from "react-markdown";
import MathFocusNoteView from "@/app/notes/ui/MathFocusNoteView";
import MathMarkdown from "@/components/ui/MathMarkdown";
import {
  looksLikeUnsafeMathFocusMarkdown,
  noteContentFallbackMessage,
  renderableNoteContent,
} from "@/lib/notes/contentSafety";
import { readMathRenderedNoteFromMetadata } from "@/lib/notes/mathRenderedNote";

type Props = {
  content: string;
  metadata?: unknown;
  mathRenderedNote?: unknown;
  renderContext?: "generated_preview" | "saved_note_detail" | "focus_note";
  noteId?: string | null;
  noteType?: string | null;
};

function metadataKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

export default function FocusNoteContent({
  content,
  metadata,
  mathRenderedNote,
  renderContext = "focus_note",
  noteId = null,
  noteType = null,
}: Props) {
  const structuredMathNote = useMemo(
    () => readMathRenderedNoteFromMetadata(metadata) ?? readMathRenderedNoteFromMetadata(mathRenderedNote),
    [metadata, mathRenderedNote],
  );
  const unsafeMathMarkdownSuppressed = useMemo(
    () => !structuredMathNote && looksLikeUnsafeMathFocusMarkdown(content),
    [content, structuredMathNote],
  );
  const safeContent = useMemo(
    () => (unsafeMathMarkdownSuppressed ? "" : renderableNoteContent(content)),
    [content, unsafeMathMarkdownSuppressed],
  );
  const markdownComponents = useMemo(
    (): Components => ({
      pre: ({ children }: { children?: ReactNode }) => (
        <pre className="overflow-auto rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-zinc-800">
          {children}
        </pre>
      ),
      code: ({ children }: { children?: ReactNode }) => (
        <code className="rounded bg-white px-1 py-0.5 text-[12px] text-zinc-800">{children}</code>
      ),
    }),
    [],
  );
  const rendererPath = structuredMathNote
    ? "structured_math_renderer"
    : unsafeMathMarkdownSuppressed
      ? "suppressed_unsafe_math_markdown"
      : "markdown_fallback";

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    console.info("[notes/focus-renderer]", {
      noteId,
      noteType,
      renderContext,
      rendererPath,
      hasMetadata: Boolean(metadata),
      metadataKeys: metadataKeys(metadata),
      hasStructuredMathPayload: Boolean(structuredMathNote),
      hasMathRenderedNote: Boolean(structuredMathNote),
      unsafeMarkdownFallbackSuppressed: unsafeMathMarkdownSuppressed,
      blocks: structuredMathNote?.blocks.length ?? 0,
      keyFormulas: structuredMathNote?.keyFormulas.length ?? 0,
    });
  }, [metadata, noteId, noteType, renderContext, rendererPath, structuredMathNote, unsafeMathMarkdownSuppressed]);

  if (structuredMathNote) {
    return <MathFocusNoteView note={structuredMathNote} />;
  }

  return (
    safeContent.trim() ? (
      <MathMarkdown
        content={safeContent}
        className="max-w-[72ch] break-words text-[15px] leading-7 text-zinc-700 sm:text-[15.5px] sm:leading-8 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-zinc-900 [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-zinc-900 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-zinc-900 [&_ol]:my-4 [&_ol]:pl-5 [&_ol]:marker:font-medium [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-zinc-900 [&_ul]:my-3 [&_ul]:pl-5 [&_li]:my-1.5 [&_li]:leading-7 [&_blockquote]:my-4 [&_blockquote]:rounded-lg [&_blockquote]:border [&_blockquote]:border-zinc-200 [&_blockquote]:bg-zinc-50/80 [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:text-zinc-700 [&_blockquote_p]:my-1.5"
        components={markdownComponents}
      />
    ) : (
      <p className="text-sm text-zinc-600">
        {noteContentFallbackMessage(unsafeMathMarkdownSuppressed ? "math_focus_unsafe" : "generic")}
      </p>
    )
  );
}
