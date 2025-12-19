import "server-only";
import type { NextRequest } from "next/server";

export function requireDevSecret(req: NextRequest): { ok: true } | { ok: false; status: number; message: string } {
  // Skjul ruter i prod
  if (process.env.NODE_ENV === "production") {
    return { ok: false, status: 404, message: "Not found" };
  }

  const expected = String(process.env.DEV_BYPASS_SECRET ?? process.env.DEV_SECRET ?? "").trim();

  // Hvis der ikke er sat secret, så er debug-ruter “slået fra”
  if (!expected) {
    return { ok: false, status: 404, message: "Not found" };
  }

  const presented = String(req.headers.get("x-dev-secret") || req.headers.get("x-shared-secret") || "").trim();
  if (presented !== expected) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  return { ok: true };
}
