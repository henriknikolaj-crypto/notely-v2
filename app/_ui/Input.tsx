import * as React from "react";
type Props = React.InputHTMLAttributes<HTMLInputElement>;
export default function Input({ className = "", ...props }: Props) {
  return <input className={"rounded-xl px-3 py-2 border w-full " + className} {...props} />;
}

