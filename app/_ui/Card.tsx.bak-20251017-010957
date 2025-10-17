import type { ReactNode, HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  className?: string;
  children: ReactNode;
};

export default function Card({ className = "", children, ...rest }: Props) {
  return (
    <div {...rest} className={`bg-white border rounded-md shadow-sm ${className}`}>
      {children}
    </div>
  );
}
