// app/api/trainer/upload/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRAINER_BUCKET = "trainer_uploads";

// Chunking
const CHUNK_LEN = 1800;

// Per-plan hard limits (beskytter systemet)
// Du kan tune senere – de her er “sikre defaults”.
const PLAN_HARD_LIMITS: Record<
  string,
  { maxBytes: number; maxPdfPages: number; maxChunks: number }
> = {
  freemium: { maxBytes: 10 * 1024 * 1024, maxPdfPages: 60, maxChunks: 120 },
  basis: { maxBytes: 20 * 1024 * 1024, maxPdfPages: 120, maxChunks: 260 },
  pro: { maxBytes: 30 * 1024 * 1024, maxPdfPages: 200, maxChunks: 520 },
};

function limitsForPlan(planRaw: string | null | undefined) {
  const plan = (planRaw ?? "freemium").toLowerCase();
  return PLAN_HARD_LIMITS[plan] ?? PLAN_HARD_LIMITS.freemium;
}

type QuotaResult = {
  plan: string;
  usedThisMonth: number;
  monthlyLimit: number;
  monthStart: string;
  monthEnd: string; // sidste ms i måneden (display/debug)
  resetAt: string; // næste måneds start (exclusive)
  blocked: boolean;
};

async function getOwnerId(
  sb: any,
): Promise<{ ownerId: string | null; mode: "auth" | "dev" }> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return { ownerId: data.user.id as string, mode: "auth" };
    }
  } catch {
    // fall through
  }

  const dev = (process.env.DEV_USER_ID ?? "").trim();
  if (process.env.NODE_ENV !== "production" && dev) {
    return { ownerId: dev, mode: "dev" };
  }

  return { ownerId: null, mode: "auth" };
}

/**
 * Månedens start + næste måneds start i UTC.
 * - monthStart: inklusiv
 * - resetAt: eksklusiv
 * - monthEnd: sidste millisekund i måneden (kun til visning/debug)
 */
function getMonthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(resetAt.getTime() - 1);

  return {
    monthStart: start.toISOString(),
    resetAt: resetAt.toISOString(),
    monthEnd: monthEnd.toISOString(),
  };
}

async function getUserPlan(sb: any, ownerId: string): Promise<string> {
  const { data, error } = await sb
    .from("profiles")
    .select("plan")
    .eq("id", ownerId)
    .maybeSingle();

  if (!error && data?.plan) return String(data.plan);
  return "freemium";
}

async function getMonthlyLimit(sb: any, plan: string, feature: string): Promise<number | null> {
  const { data, error } = await sb
    .from("plan_limits")
    .select("monthly_limit")
    .eq("plan", plan)
    .eq("feature", feature)
    .maybeSingle();

  if (error) return null;
  const n = (data as any)?.monthly_limit;
  return typeof n === "number" ? n : null;
}

async function countMonthlyUsage(sb: any, ownerId: string, monthStart: string, resetAt: string) {
  // NOTE: UI tæller “gjort klar” (= succeeded).
  // Gating kan du senere vælge at udvide til også at inkludere queued/started,
  // hvis du vil beskytte mod parallel uploads.
  const { count, error } = await sb
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", "import")
    .eq("status", "succeeded")
    .gte("queued_at", monthStart)
    .lt("queued_at", resetAt);

  if (error) throw error;
  return Number(count ?? 0);
}

async function assertImportQuota(sb: any, ownerId: string): Promise<QuotaResult> {
  const plan = await getUserPlan(sb, ownerId);
  const monthlyLimit = await getMonthlyLimit(sb, plan, "import");

  // Fail-closed
  if (!monthlyLimit || monthlyLimit <= 0) {
    throw new Error(`PLAN_LIMITS_MISSING(import) for plan=${plan}`);
  }

  const { monthStart, resetAt, monthEnd } = getMonthBoundsUTC(new Date());
  const usedThisMonth = await countMonthlyUsage(sb, ownerId, monthStart, resetAt);

  return {
    plan,
    usedThisMonth,
    monthlyLimit,
    monthStart,
    monthEnd,
    resetAt,
    blocked: usedThisMonth >= monthlyLimit,
  };
}

/** pdfjs-dist loader – dynamisk import + cache. */
let cachedPdfJs: any = null;
async function getPdfJs(): Promise<any> {
  if (cachedPdfJs) return cachedPdfJs;
  const mod: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  cachedPdfJs = mod;
  return mod;
}

async function loadPdf(buffer: Buffer) {
  const mod = await getPdfJs();
  const pdfjsLib: any =
    mod && typeof mod.getDocument === "function"
      ? mod
      : mod?.default && typeof mod.default.getDocument === "function"
        ? mod.default
        : null;

  if (!pdfjsLib) {
    throw new Error("pdfjs-dist getDocument ikke fundet (server-konfiguration).");
  }

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    useSystemFonts: false,
    isEvalSupported: false,
  });

  return loadingTask.promise;
}

async function extractTextFromPdf(opts: {
  buffer: Buffer;
  maxPages: number;
}): Promise<{ text: string; pageCount: number }> {
  const { buffer, maxPages } = opts;

  const pdf = await loadPdf(buffer);
  const pageCount = Number(pdf.numPages ?? 0);

  if (pageCount <= 0) {
    return { text: "[PDF-tekstfejl: Kunne ikke læse sider i PDF.]", pageCount: 0 };
  }

  let fullText = "";
  const pagesToRead = Math.min(pageCount, maxPages);

  for (let pageNum = 1; pageNum <= pagesToRead; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = (content.items as any[])
      .map((item) => (typeof item?.str === "string" ? item.str : ""))
      .filter(Boolean);
    fullText += strings.join(" ") + "\n\n";
  }

  const cleaned = fullText
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text: cleaned || "[PDF-tekstfejl: Ingen tekst fundet i PDF.]",
    pageCount,
  };
}

function splitIntoChunks(text: string, maxLen = CHUNK_LEN): string[] {
  if (!text.trim()) return [];
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const next = current ? `${current}\n\n${part}` : part;

    if (next.length > maxLen) {
      if (current) chunks.push(current);

      if (part.length > maxLen) {
        for (let i = 0; i < part.length; i += maxLen) {
          chunks.push(part.slice(i, i + maxLen));
        }
        current = "";
      } else {
        current = part;
      }
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function insertDocChunks(opts: {
  sb: any;
  ownerId: string;
  folderId: string | null;
  fileId: string;
  chunks: string[];
}) {
  const { sb, ownerId, folderId, fileId, chunks } = opts;
  if (!chunks.length) return;

  const rows = chunks.map((content) => ({
    owner_id: ownerId,
    folder_id: folderId,
    file_id: fileId,
    content,
    source_type: "trainer_upload",
    academic_weight: 0,
  }));

  const { error } = await sb.from("doc_chunks").insert(rows);
  if (error) console.error("[trainer/upload] doc_chunks insert error:", error);
}

export async function GET() {
  return NextResponse.json(
    { ok: true, msg: "trainer/upload route is alive" },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const { ownerId, mode } = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json(
      { ok: false, error: "Mangler bruger-id (hverken login eller DEV_USER_ID sat)." },
      { status: 401 },
    );
  }

  // 0) Parse formdata
  const formData = await req.formData();
  const file = formData.get("file");
  const folderIdRaw = formData.get("folderId") ?? formData.get("folder_id");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Ingen fil modtaget i upload." },
      { status: 400 },
    );
  }

  const folderId =
    typeof folderIdRaw === "string" && folderIdRaw.length > 0 ? folderIdRaw : null;

  // 1) Quota gate (måned)
  let quota: QuotaResult;
  try {
    quota = await assertImportQuota(sb, ownerId);
  } catch (e: any) {
    console.error("[trainer/upload] quota check failed:", e);
    const msg = String(e?.message ?? e);
    const isMissing = msg.includes("PLAN_LIMITS_MISSING");
    return NextResponse.json(
      {
        ok: false,
        code: isMissing ? "PLAN_LIMITS_MISSING" : "QUOTA_CHECK_FAILED",
        message: isMissing
          ? "Plan limits for upload mangler. Tjek plan_limits-tabellen."
          : "Kunne ikke validere din månedlige upload-kvote. Prøv igen.",
      },
      { status: 500 },
    );
  }

  if (quota.blocked) {
    return NextResponse.json(
      {
        ok: false,
        code: "QUOTA_EXCEEDED",
        message: "Du har nået din månedlige upload-kvote.",
        plan: quota.plan,
        usedThisMonth: quota.usedThisMonth,
        monthlyLimit: quota.monthlyLimit,
        monthStart: quota.monthStart,
        monthEnd: quota.monthEnd,
        resetAt: quota.resetAt,
      },
      { status: 402 },
    );
  }

  // 2) Hard limits pr. fil (MB/pages/chunks)
  const hard = limitsForPlan(quota.plan);
  const maxBytes = hard.maxBytes;
  const maxPages = hard.maxPdfPages;
  const maxChunks = hard.maxChunks;

  // Type check (nu: PDF-only)
  const isPdf =
    (file.type || "").toLowerCase().includes("pdf") ||
    (file.name || "").toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    return NextResponse.json(
      {
        ok: false,
        code: "UNSUPPORTED_FILE_TYPE",
        message: "Kun PDF-filer er understøttet lige nu.",
      },
      { status: 415 },
    );
  }

  // Size check før vi læser hele filen ind
  const sizeBytes = typeof file.size === "number" ? file.size : 0;
  if (sizeBytes > maxBytes) {
    return NextResponse.json(
      {
        ok: false,
        code: "FILE_TOO_LARGE",
        message: `Filen er for stor til din plan (${quota.plan}). Maks ${Math.floor(
          maxBytes / (1024 * 1024),
        )} MB pr. fil.`,
        limit: { maxBytes, maxMb: Math.floor(maxBytes / (1024 * 1024)) },
        file: { name: file.name, sizeBytes },
      },
      { status: 413 },
    );
  }

  const safeName = file.name || "upload.pdf";
  const buffer = Buffer.from(await file.arrayBuffer());

  // 3) PDF page limit (hurtig check via pdfjs)
  let pageCount = 0;
  try {
    const pdf = await loadPdf(buffer);
    pageCount = Number(pdf.numPages ?? 0);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json(
      {
        ok: false,
        code: "PDF_READ_FAILED",
        message: "Vi kunne ikke læse PDF’en. Prøv at gemme den igen som PDF og upload på ny.",
        details: msg,
      },
      { status: 400 },
    );
  }

  if (pageCount > maxPages) {
    return NextResponse.json(
      {
        ok: false,
        code: "PDF_TOO_MANY_PAGES",
        message: `PDF’en er for lang (${pageCount} sider). Maks ${maxPages} sider pr. fil på din plan (${quota.plan}). Del den op og upload igen.`,
        limit: { maxPages },
        file: { name: safeName, pageCount },
      },
      { status: 413 },
    );
  }

  // 4) Extract + chunk limits (måler “rigtigt” forbrug)
  let extractedText = "";
  try {
    const r = await extractTextFromPdf({ buffer, maxPages });
    extractedText = r.text;
    // pageCount allerede målt ovenfor, men r.pageCount findes også
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json(
      {
        ok: false,
        code: "PDF_TEXT_EXTRACT_FAILED",
        message: "Vi kunne ikke udtrække tekst fra PDF’en. Hvis den er scannet, prøv en tekst-baseret PDF.",
        details: msg,
      },
      { status: 400 },
    );
  }

  const chunks = splitIntoChunks(extractedText, CHUNK_LEN);
  if (chunks.length > maxChunks) {
    return NextResponse.json(
      {
        ok: false,
        code: "TOO_MANY_CHUNKS",
        message: `Filen indeholder meget tekst og bliver for stor at gøre klar (${chunks.length} dele). Del filen op og upload igen.`,
        limit: { maxChunks, chunkLen: CHUNK_LEN },
        file: { name: safeName, pageCount, chunkCount: chunks.length },
      },
      { status: 413 },
    );
  }

  // 5) Storage
  const fileId = randomUUID();
  const storagePath = `${ownerId}/${fileId}/${safeName}`;

  const { error: storageError } = await sb.storage.from(TRAINER_BUCKET).upload(storagePath, buffer, {
    contentType: file.type || "application/pdf",
    upsert: false,
  });

  if (storageError) {
    console.error("[trainer/upload] storage upload error:", storageError);
    return NextResponse.json(
      {
        ok: false,
        code: "STORAGE_UPLOAD_FAILED",
        message: "Kunne ikke uploade filen. Tjek at storage-bucket findes og at du har adgang.",
      },
      { status: 500 },
    );
  }

  // 6) files row
  const { data: fileRow, error: filesError } = await sb
    .from("files")
    .insert({
      id: fileId,
      owner_id: ownerId,
      folder_id: folderId,
      name: safeName,
      original_name: safeName,
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      size_bytes: buffer.length,
    })
    .select()
    .single();

  if (filesError) {
    console.error("[trainer/upload] files insert error:", filesError);
    // cleanup storage (best effort)
    await sb.storage.from(TRAINER_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { ok: false, code: "FILES_INSERT_FAILED", message: "Kunne ikke gemme fil-metadata." },
      { status: 500 },
    );
  }

  // 7) doc_chunks
  await insertDocChunks({ sb, ownerId, folderId, fileId, chunks });

  // 8) registrér “gjort klar” (succeeded)
  const { error: jobErr } = await sb.from("jobs").insert({
    owner_id: ownerId,
    kind: "import",
    status: "succeeded",
    queued_at: new Date().toISOString(),
    payload: {
      source: "trainer/upload",
      fileId,
      storagePath,
      mode,
      fileName: safeName,
      sizeBytes: buffer.length,
      pageCount,
      chunkCount: chunks.length,
    },
  });

  if (jobErr) console.error("[trainer/upload] jobs insert error:", jobErr);

  return NextResponse.json(
    {
      ok: true,
      fileId,
      file: fileRow,
      quota: {
        plan: quota.plan,
        usedThisMonth: quota.usedThisMonth + 1,
        monthlyLimit: quota.monthlyLimit,
        monthStart: quota.monthStart,
        monthEnd: quota.monthEnd,
        resetAt: quota.resetAt,
      },
      limits: {
        maxBytes,
        maxPdfPages: maxPages,
        maxChunks,
        chunkLen: CHUNK_LEN,
      },
      stats: {
        sizeBytes: buffer.length,
        pageCount,
        chunkCount: chunks.length,
      },
    },
    { status: 200 },
  );
}
