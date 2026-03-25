// app/traener/page.tsx
import "server-only";
import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const sp = (await searchParams) ?? {};
  const rawScope = sp.scope ?? sp["scope"];

  let scopeFolderIds: string[] = [];

  if (typeof rawScope === "string") {
    scopeFolderIds = rawScope
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(rawScope) && rawScope.length > 0) {
    scopeFolderIds = rawScope[0]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const qs = new URLSearchParams();
  if (scopeFolderIds.length > 0) qs.set("scope", scopeFolderIds.join(","));

  redirect(qs.toString() ? `/traener/noter?${qs.toString()}` : "/traener/noter");
}
