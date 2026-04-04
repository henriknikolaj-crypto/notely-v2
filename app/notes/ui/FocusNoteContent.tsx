"use client";

import { isValidElement, type ReactNode, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

const FOCUS_EMPHASIZED_SECTION_TITLES = new Set(["eksamensfokus", "eksamenstips"]);

function flattenMarkdownText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenMarkdownText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return flattenMarkdownText(node.props.children);
  return "";
}

function normalizeHeadingText(value: string) {
  return value.trim().replace(/[:\-–]+$/, "").trim().toLowerCase();
}

function isLikelyFocusSectionHeading(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (text.includes("\n")) return false;
  if (/[.!?]$/.test(text)) return false;
  if (/^\s*[-*•]\s+/.test(text)) return false;

  const normalized = normalizeHeadingText(text);
  if (FOCUS_EMPHASIZED_SECTION_TITLES.has(normalized)) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  if (normalized.length > 48) return false;

  return true;
}

type Props = {
  content: string;
};

export default function FocusNoteContent({ content }: Props) {
  const markdownComponents = useMemo(
    () => ({
      h1: ({ children }: { children?: ReactNode }) => (
        <h1 className="mt-6 mb-3 text-base font-semibold tracking-tight text-zinc-950">{children}</h1>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h2 className="mt-6 mb-3 text-base font-semibold tracking-tight text-zinc-950">{children}</h2>
      ),
      h3: ({ children }: { children?: ReactNode }) => {
        const text = flattenMarkdownText(children);
        const normalized = normalizeHeadingText(text);
        const isEmphasized = FOCUS_EMPHASIZED_SECTION_TITLES.has(normalized);
        return (
          <h3
            className={
              "mt-5 mb-2 text-[15px] font-semibold tracking-tight " +
              (isEmphasized ? "text-zinc-950" : "text-zinc-900")
            }
          >
            {children}
          </h3>
        );
      },
      p: ({ children }: { children?: ReactNode }) => {
        const text = flattenMarkdownText(children);
        const normalized = normalizeHeadingText(text);
        const isHeadingLike = isLikelyFocusSectionHeading(text);
        const isEmphasized = FOCUS_EMPHASIZED_SECTION_TITLES.has(normalized);

        if (isHeadingLike) {
          return (
            <h3
              className={
                "mt-5 mb-2 text-[15px] font-semibold tracking-tight " +
                (isEmphasized ? "text-zinc-950" : "text-zinc-900")
              }
            >
              {text.trim().replace(/[:\-–]+$/, "")}
            </h3>
          );
        }

        return <p className="my-2 leading-7 text-zinc-700">{children}</p>;
      },
      ul: ({ children }: { children?: ReactNode }) => <ul className="my-2 space-y-1.5 pl-5">{children}</ul>,
      ol: ({ children }: { children?: ReactNode }) => <ol className="my-2 space-y-1.5 pl-5">{children}</ol>,
      li: ({ children }: { children?: ReactNode }) => (
        <li className="my-1 leading-6 text-zinc-700 marker:text-zinc-400">{children}</li>
      ),
      strong: ({ children }: { children?: ReactNode }) => (
        <strong className="font-semibold text-zinc-900">{children}</strong>
      ),
      pre: ({ children }: { children?: ReactNode }) => (
        <pre className="overflow-auto rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] leading-relaxed">
          {children}
        </pre>
      ),
      code: ({ children }: { children?: ReactNode }) => (
        <code className="rounded bg-white px-1 py-0.5 text-[12px]">{children}</code>
      ),
    }),
    [],
  );

  return (
    <div className="prose prose-sm max-w-none break-words prose-headings:mt-3 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:font-semibold prose-code:before:content-[''] prose-code:after:content-[''] prose-headings:font-semibold prose-headings:text-zinc-900 prose-p:text-zinc-700 prose-li:text-zinc-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
