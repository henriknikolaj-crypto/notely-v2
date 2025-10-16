export default function EmptyState({
  title = "Ingen vurderinger endnu.",
  description = "Kør din første evaluering – så dukker resultaterne op her.",
  ctaHref = "#evaluate",
  ctaText = "Kør evaluering",
}: {
  title?: string;
  description?: string;
  ctaHref?: string;
  ctaText?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white/70 p-6 text-center">
      <div className="mx-auto mb-2 h-10 w-10 rounded-full border flex items-center justify-center">
        <span className="text-lg">📝</span>
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-neutral-600">{description}</p>
      <a
        href={ctaHref}
        className="mt-4 inline-block rounded-xl border px-4 py-2 text-sm hover:bg-neutral-50"
      >
        {ctaText}
      </a>
    </div>
  );
}

