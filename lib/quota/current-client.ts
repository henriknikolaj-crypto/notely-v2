"use client";

type QuotaCurrentResponse = {
  ok?: boolean;
  plan?: string;
  error?: string;
  [key: string]: unknown;
};

type FetchQuotaCurrentOptions = {
  force?: boolean;
};

const CACHE_TTL_MS = 5_000;

let cached: QuotaCurrentResponse | null = null;
let cachedAt = 0;
let inflight: Promise<QuotaCurrentResponse | null> | null = null;

async function readJsonSafe(res: Response): Promise<QuotaCurrentResponse | null> {
  const text = await res.text();
  try {
    return text.trim() ? (JSON.parse(text) as QuotaCurrentResponse) : {};
  } catch {
    return null;
  }
}

export function clearQuotaCurrentCache() {
  cached = null;
  cachedAt = 0;
}

export async function fetchQuotaCurrent(
  opts: FetchQuotaCurrentOptions = {},
): Promise<QuotaCurrentResponse | null> {
  const { force = false } = opts;
  const now = Date.now();

  if (!force && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const res = await fetch("/api/quota/current", {
        method: "GET",
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });

      const json = await readJsonSafe(res);
      if (res.ok && json) {
        cached = json;
        cachedAt = Date.now();
      } else if (force) {
        clearQuotaCurrentCache();
      }
      return json;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
