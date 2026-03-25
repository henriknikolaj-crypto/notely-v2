import Link from "next/link";

export default function AuthStateNotice({
  title = "Login mangler",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <p className="mt-2 text-sm text-zinc-600">{message}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/auth/login"
          className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white"
        >
          Log ind
        </Link>
        <Link
          href="/"
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-900"
        >
          Til forsiden
        </Link>
      </div>
    </section>
  );
}
