import type { TextareaHTMLAttributes, DetailedHTMLProps } from "react";
export default function Textarea(props: DetailedHTMLProps<TextareaHTMLAttributes<HTMLTextAreaElement>, HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`w-full border rounded-md px-3 py-2 min-h-[120px] ${className}`} {...rest} />;
}