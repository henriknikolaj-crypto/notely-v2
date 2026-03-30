"use client";

import type { ReactNode } from "react";

type Props = {
  feature?: string | null;   // fx "trainer_round", "mc_generate", "flashcards_generate"
  message?: string | null;   // fx rate-limit tekst eller server-fejl
  children?: ReactNode;
  className?: string;
};

function labelFromFeature(feature?: string | null) {
  switch (String(feature ?? "").trim()) {
    case "trainer_round":
      return "Træner-runder";
    case "mc_generate":
    case "mc_round":
      return "Multiple Choice";
    case "flashcards_generate":
    case "flashcards_round":
      return "Flashcards";
    default:
      return null;
  }
}

function defaultMessage(feature?: string | null) {
  const label = labelFromFeature(feature);
  return label ? `Du har nået din grænse for ${label} denne måned.` : "Du har nået din grænse denne måned.";
}

export default function LimitNotice({ feature, message, children, className }: Props) {
  const msg = message && message.trim() ? message.trim() : null;

  const content =
    msg ??
    (typeof children === "string" ? children : null) ??
    defaultMessage(feature);

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700",
        className ?? "",
      ].join(" ")}
    >
      {typeof children !== "undefined" && typeof children !== "string" ? children : content}
    </div>
  );
}
