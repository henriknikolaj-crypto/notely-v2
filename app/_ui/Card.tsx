import { ReactNode } from "react";
const cx = (...a: (string|false|undefined)[]) => a.filter(Boolean).join(" ");

export function Card({children, className}: {children: ReactNode; className?: string}) {
  return <section className={cx("rounded border border-black/10 bg-white shadow-sm", className)}>{children}</section>;
}
