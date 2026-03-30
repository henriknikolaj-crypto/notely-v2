import "server-only";

import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined> | undefined;

export default async function OralHistoryDetailRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const qp = new URLSearchParams();

  for (const [key, value] of Object.entries(sp)) {
    if (value == null) continue;
    if (Array.isArray(value)) qp.set(key, value[0] ?? "");
    else qp.set(key, value);
  }

  qp.set("mode", "mundtlig");

  const qs = qp.toString();
  redirect(qs ? `/traener/simulator/historik/${id}?${qs}` : `/traener/simulator/historik/${id}?mode=mundtlig`);
}
