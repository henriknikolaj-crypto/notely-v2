import * as React from "react";
type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
export default function Textarea({ className = "", ...props }: Props) {
  return <textarea className={"rounded-xl px-3 py-2 border w-full " + className} {...props} />;
}

