export default function Page() {
  return (
    <div className="p-6 bg-brand-50 text-brand-600 rounded-2xl prose">
      <h1>Tailwind v4 kører </h1>
      <p>
        Farver og radius kommer fra <code>@theme</code>, og <code>prose</code> fra
        typography-pluginet.
      </p>
      <a href="/">Til forsiden</a>
    </div>
  );
}

