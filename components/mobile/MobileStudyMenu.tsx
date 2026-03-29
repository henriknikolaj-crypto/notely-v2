import Link from "next/link";

const items = [
  {
    href: "/m/noter",
    title: "Noter",
    description: "Generér noter fra dit materiale og arbejd videre med dem.",
  },
  {
    href: "/multiple-choice",
    title: "Multiple Choice",
    description: "Træn med korte MC-forløb baseret på dit eget pensum.",
  },
  {
    href: "/flashcards",
    title: "Flashcards",
    description: "Repeter centrale begreber med enkle kort på mobil.",
  },
  {
    href: "/traener",
    title: "Træner",
    description: "Få spørgsmål og feedback på dine egne svar.",
    badge: "Demo",
  },
  {
    href: "/eksamen",
    title: "Eksamen",
    description: "Gå til skriftlig eller mundtlig eksamenstræning.",
    badge: "Pro",
  },
];

export default function MobileStudyMenu() {
  return (
    <section className="space-y-4">
      <header className="space-y-2 border-b border-zinc-200 pb-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
          Noter / træning
        </p>
        <h1 className="text-xl font-semibold text-zinc-900">Vælg træning</h1>
        <p className="max-w-xl text-sm leading-6 text-zinc-600">Gå direkte til noter, træning eller eksamen.</p>
      </header>

      <div className="space-y-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-zinc-900">{item.title}</div>
                <p className="mt-1 text-sm leading-6 text-zinc-600">{item.description}</p>
              </div>
              {"badge" in item ? (
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium " +
                    (item.badge === "Demo"
                      ? "border border-zinc-200 bg-zinc-50 text-zinc-600"
                      : "border border-zinc-300 text-zinc-700")
                  }
                >
                  {item.badge}
                </span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
