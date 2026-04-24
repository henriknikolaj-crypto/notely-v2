"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { normalizeMathContent } from "@/lib/text/normalizeMathContent";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const mathSanitizeSchema: RehypeSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", "language-math", "math-inline", "math-display"],
    ],
  },
};

const rehypePlugins: PluggableList = [
  [rehypeSanitize, mathSanitizeSchema],
  [rehypeKatex, { output: "html", strict: "ignore", throwOnError: false }],
];

type MathMarkdownProps = {
  content: string;
  className?: string;
  components?: Components;
  preserveWhitespace?: boolean;
};

export default function MathMarkdown({
  content,
  className,
  components,
  preserveWhitespace = false,
}: MathMarkdownProps) {
  const normalizedContent = normalizeMathContent(content);

  return (
    <div
      className={cx(
        "notely-math-markdown max-w-none break-words [overflow-wrap:anywhere] prose-code:before:content-[''] prose-code:after:content-['']",
        preserveWhitespace && "whitespace-pre-wrap",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={rehypePlugins} components={components}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
