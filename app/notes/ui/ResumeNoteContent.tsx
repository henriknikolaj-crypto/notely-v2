"use client";

import { type ReactNode, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type Props = {
  content: string;
};

export default function ResumeNoteContent({ content }: Props) {
  const markdownComponents = useMemo(
    () => ({
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

  return (
    <div className="max-w-[70ch] break-words text-[15px] leading-7 text-zinc-700 sm:text-[15.5px] sm:leading-8 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-zinc-900 [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-zinc-900 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-zinc-900 [&_ol]:my-4 [&_ol]:pl-5 [&_p]:my-4 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-zinc-800 [&_ul]:my-4 [&_ul]:pl-5 [&_li]:my-1.5 [&_li]:leading-7 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-600">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
