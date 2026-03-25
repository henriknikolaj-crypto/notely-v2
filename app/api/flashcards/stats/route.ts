import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function dayStartInTimeZoneISO(timeZone: string): string {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-");

  const y = Number(ymd[0]);
  const m = Number(ymd[1]);
  const d = Number(ymd[2]);

  const guessUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0);
  const guess = new Date(guessUtcMs);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(guess);

  const map = new Map(parts.map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(
    Number(map.get("year")),
    Number(map.get("month")) - 1,
    Number(map.get("day")),
    Number(map.get("hour")),
    Number(map.get("minute")),
    Number(map.get("second")),
  );

  const offsetMinutes = Math.round((asIfUtc - guessUtcMs) / 60000);
  const midnightUtcMs = guessUtcMs - offsetMinutes * 60000;
  return new Date(midnightUtcMs).toISOString();
}

export async function GET(req: NextRequest) {
  let sb: any;
  let ownerId: string;
  try {
    const auth = await requireUser(req);
    sb = auth.sb;
    ownerId = auth.id;
  } catch {
    return json(401, { ok: false, error: "Unauthorized (mangler login eller dev-bypass)." });
  }

  const dayStartDK = dayStartInTimeZoneISO("Europe/Copenhagen");
  const { data: sessions, error: sessErr } = await sb
    .from("flashcard_sessions")
    .select("id, requested, returned, created_at")
    .eq("owner_id", ownerId)
    .gte("created_at", dayStartDK)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (sessErr) return json(500, { ok: false, error: "Kunne ikke hente flashcards-stats.", detail: sessErr.message });

  const rows = (sessions ?? []) as Array<{
    id?: string | null;
    requested?: number | null;
    returned?: number | null;
    created_at?: string | null;
  }>;
  const byId = new Map<string, (typeof rows)[number]>();
  const noId: (typeof rows)[number][] = [];
  for (const s of rows) {
    const id = String(s?.id ?? "").trim();
    if (!id) {
      noId.push(s);
      continue;
    }
    if (!byId.has(id)) byId.set(id, s);
  }
  const uniq = [...Array.from(byId.values()), ...noId];

  const todayUsed = uniq.reduce((sum, s) => {
    const returned = Number(s?.returned);
    const requested = Number(s?.requested);
    if (Number.isFinite(returned)) return sum + Math.max(0, Math.round(returned));
    if (Number.isFinite(requested)) return sum + Math.max(0, Math.round(requested));
    return sum;
  }, 0);

  const lastSessionAt = uniq
    .map((s) => String(s?.created_at ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] ?? null;

  return json(200, {
    ok: true,
    todayUsed,
    lastSessionAt,
    dayStartDK,
  });
}
