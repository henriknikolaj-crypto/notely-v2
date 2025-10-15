import type { InputHTMLAttributes, DetailedHTMLProps } from "react";
export default function Input(props: DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`w-full border rounded-md px-3 py-2 ${className}`} {...rest} />;
}