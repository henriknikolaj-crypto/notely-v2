import * as React from "react";

type Props = {
  names: string[];
  helpText?: string;
  emptyLabel?: string;
  className?: string;
  children?: React.ReactNode;
};

export function formatScopeLabel(names: string[], emptyLabel = "Vælg eller skift mappe her."): string {
  const clean = names.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (clean.length === 0) return emptyLabel;
  if (clean.length === 1) return clean[0];
  return `${clean[0]} + ${clean.length - 1}`;
}

export default function TrainingScopeCard({
  names,
  helpText,
  emptyLabel = "Vælg eller skift mappe her.",
  className,
  children,
}: Props) {
  const cleanNames = names.map((x) => String(x ?? "").trim()).filter(Boolean);
  const label = formatScopeLabel(cleanNames, emptyLabel);
  const classes = ["rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm", className].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500">DU TRÆNER PÅ</div>
      <p className="mt-1 text-sm font-semibold text-zinc-900">{label}</p>
      {helpText && cleanNames.length === 0 ? <p className="mt-1 text-xs text-zinc-600">{helpText}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
