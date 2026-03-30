import Link from "next/link";

type MobileNavItem = {
  href: string;
  title: string;
  description: string;
  badge?: string | null;
};

export default function MobileNavHub({
  eyebrow,
  title,
  description,
  items,
  backHref,
  backLabel,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  items: MobileNavItem[];
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <section className="space-y-4">
      {backHref && backLabel ? (
        <Link href={backHref} className="inline-flex text-sm text-zinc-600 hover:text-zinc-900">
          {backLabel}
        </Link>
      ) : null}

      <header className="space-y-2 border-b border-zinc-200 pb-3">
        {eyebrow ? <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{eyebrow}</p> : null}
        <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
        <p className="max-w-xl text-sm leading-6 text-zinc-600">{description}</p>
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
              {item.badge ? (
                <span className="shrink-0 rounded-full border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700">
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
