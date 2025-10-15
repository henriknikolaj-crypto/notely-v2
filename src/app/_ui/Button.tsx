import type { ButtonHTMLAttributes, DetailedHTMLProps, ReactNode } from "react";

type Props = DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & {
  children: ReactNode;
};
export default function Button({ children, className = "", ...rest }: Props) {
  return (
    <button
      className={`px-4 py-2 rounded-md border hover:bg-gray-50 disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}