// app/traener/mundtlig/historik/page.tsx
import "server-only";
import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const params = new URLSearchParams();

  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) params.set(k, v[0] ?? "");
    else params.set(k, v);
  }

  params.set("mode", "mundtlig");

  const qs = params.toString();
  redirect(qs ? `/traener/simulator/historik?${qs}` : "/traener/simulator/historik?mode=mundtlig");
}
