import Link from "next/link";

const items = [
  {
    href: "/traener/overblik",
    title: "Overblik",
    description: "Gå til dit overblik og fortsæt derfra.",
  },
  {
    href: "/m/traening",
    title: "Noter / træning",
    description: "Åbn den simple menu til noter og træningsflows.",
    badge: "Demo",
  },
  {
    href: "/upload",
    title: "Upload / ret materiale",
    description: "Upload nye filer eller ryd op i dit materiale.",
  },
  {
    href: "/konto",
    title: "Konto",
    description: "Se plan, forbrug og kontooplysninger.",
  },
];

export default function MobileHomeMenu() {
  return (
    <section className="space-y-4">
      <header className="space-y-2 border-b border-zinc-200 pb-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
          Mit Notely
        </p>
        <p className="max-w-xl text-sm leading-6 text-zinc-600">
          Vælg, hvor du vil fortsætte. Gå til overblik, noter, træning, upload eller konto.
        </p>
      </header>

      <div className="space-y-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-base font-semibold text-zinc-900">{item.title}</div>
              {"badge" in item ? (
                <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                  {item.badge}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-600">{item.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
