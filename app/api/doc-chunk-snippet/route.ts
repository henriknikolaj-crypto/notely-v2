import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChunkRow = {
  id: string;
  content: string | null;
  source: string | null;
  source_url: string | null;
  file_id: string | null;
  folder_id: string | null;
  page?: number | string | null;
  page_from?: number | string | null;
  page_to?: number | string | null;
  source_page?: number | string | null;
  page_label?: string | null;
  source_page_label?: string | null;
  printed_page?: number | string | null;
  printed_page_from?: number | string | null;
  printed_page_to?: number | string | null;
  printed_page_label?: string | null;
  position?: string | null;
  page_position?: string | null;
  meta?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

type RankedChunk = {
  row: ChunkRow;
  m: ReturnType<typeof matchStats>;
};

type FileRow = {
  id: string;
  created_at: string | null;
  original_name: string | null;
  name: string | null;
};

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function normalizeText(raw: unknown) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

function normalizeDocName(raw: unknown) {
  return normalizeText(raw).toLowerCase();
}

function parseKeywordsCsv(raw: string): string[] {
  const parts = String(raw ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length >= 4);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 10) break;
  }
  return out;
}

function matchStats(textLower: string, keywords: string[]) {
  let minIndex = Number.MAX_SAFE_INTEGER;
  let hitCount = 0;
  let matchedKeyword: string | null = null;

  for (const kw of keywords) {
    const idx = textLower.indexOf(kw);
    if (idx >= 0) {
      hitCount += 1;
      if (idx < minIndex) {
        minIndex = idx;
        matchedKeyword = kw;
      }
    }
  }

  const hasHit = hitCount > 0;
  const baseScore = hasHit ? hitCount * 1000 - minIndex : Number.NEGATIVE_INFINITY;
  const introPenalty = hasHit && minIndex < 250 ? 5000 : 0;
  return {
    hasHit,
    hitCount,
    minMatchIndex: hasHit ? minIndex : -1,
    matchedKeyword,
    score: baseScore - introPenalty,
  };
}

function trimAtWordBoundaryStart(s: string): string {
  if (!s) return s;
  const i = s.indexOf(" ");
  if (i <= 0) return s;
  return s.slice(i + 1);
}

function trimAtWordBoundaryEnd(s: string): string {
  if (!s) return s;
  const i = s.lastIndexOf(" ");
  if (i <= 0) return s;
  return s.slice(0, i);
}

function windowSnippet(textRaw: unknown, start: number, size: number): string {
  const text = normalizeText(textRaw);
  if (!text) return "";
  let s = Math.max(0, Math.min(start, text.length));
  let e = Math.min(text.length, s + size);
  if (e - s < size) s = Math.max(0, e - size);

  let slice = text.slice(s, e);
  if (s > 0) slice = trimAtWordBoundaryStart(slice);
  if (e < text.length) slice = trimAtWordBoundaryEnd(slice);
  return slice.trim();
}

function snippetFingerprint(raw: string): string {
  return normalizeText(raw).toLowerCase().slice(0, 180);
}

function pickPageLike(row: ChunkRow, keys: string[]): string | null {
  const all: Record<string, unknown> = {
    ...(row.meta ?? {}),
    ...(row.metadata ?? {}),
    ...row,
  };
  for (const key of keys) {
    const v = all[key];
    const s = String(v ?? "").trim();
    if (!s) continue;
    return s;
  }
  return null;
}

function hasPageMetadata(row: ChunkRow): boolean {
  const keys = [
    "page",
    "page_from",
    "page_to",
    "source_page",
    "page_label",
    "source_page_label",
    "printed_page",
    "printed_page_from",
    "printed_page_to",
    "printed_page_label",
    "position",
    "page_position",
    "pageFrom",
    "pageTo",
    "sourcePage",
    "pageLabel",
    "sourcePageLabel",
    "printedPage",
    "printedPageFrom",
    "printedPageTo",
    "printedPageLabel",
    "pagePosition",
  ];
  return keys.some((k) => Boolean(pickPageLike(row, [k])));
}

function hasAnyPageMetadata(rows: ChunkRow[]): boolean {
  return rows.some((row) => hasPageMetadata(row));
}

function hasAnyContent(rows: ChunkRow[]): boolean {
  return rows.some((row) => normalizeText(row.content).length > 0);
}

export async function GET(req: NextRequest) {
  try {
    const chunkIdRaw = String(req.nextUrl.searchParams.get("chunkId") ?? "").trim();
    const fileIdRaw = String(req.nextUrl.searchParams.get("fileId") ?? "").trim();
    const folderIdRaw = String(req.nextUrl.searchParams.get("folderId") ?? "").trim();
    const titleRaw = String(req.nextUrl.searchParams.get("title") ?? "").trim();
    const keywordsRaw = String(req.nextUrl.searchParams.get("keywords") ?? "").trim();
    const topKRaw = String(req.nextUrl.searchParams.get("topK") ?? "").trim();

    const chunkId = chunkIdRaw && isUuidLike(chunkIdRaw) ? chunkIdRaw : null;
    const fileId = fileIdRaw && isUuidLike(fileIdRaw) ? fileIdRaw : null;
    const folderId = folderIdRaw && isUuidLike(folderIdRaw) ? folderIdRaw : null;
    const titleNormalized = normalizeDocName(titleRaw);
    const keywords = parseKeywordsCsv(keywordsRaw);
    const topKParsed = Number.parseInt(topKRaw, 10);
    const topK = Number.isFinite(topKParsed) ? Math.min(3, Math.max(1, topKParsed)) : 1;

    const sb = await supabaseServerRoute();
    const owner = await getOwnerCtx(req, sb);
    const ownerId = owner?.ownerId ?? null;
    if (!ownerId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!fileId && !folderId && !chunkId) {
      return NextResponse.json({ ok: false, error: "Mangler folderId, fileId eller chunkId." }, { status: 400 });
    }

    let chosenRanked: RankedChunk[] = [];
    let sourceCandidates: ChunkRow[] = [];

    if (fileId) {
      const { data: rows, error: rowsError } = await sb
        .from("doc_chunks")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("file_id", fileId)
        .limit(80);

      if (rowsError) {
        console.error("[doc-chunk-snippet] file chunks error:", rowsError);
        return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
      }
      sourceCandidates = (rows ?? []) as ChunkRow[];
    } else if (folderId) {
      const { data: rows, error: rowsError } = await sb
        .from("doc_chunks")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("folder_id", folderId)
        .limit(120);
      if (rowsError) {
        console.error("[doc-chunk-snippet] folder chunks error:", rowsError);
        return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
      }
      sourceCandidates = (rows ?? []) as ChunkRow[];
    }

    // Recover from stale file/chunk refs by resolving newest matching file title inside folder.
    if (folderId && titleNormalized) {
      const chunkMissingInSource = chunkId ? !sourceCandidates.some((row) => String(row.id) === chunkId) : false;
      const sourceHasMeta = hasAnyPageMetadata(sourceCandidates);
      const shouldTryTitleFallback = sourceCandidates.length === 0 || chunkMissingInSource || !sourceHasMeta;

      if (shouldTryTitleFallback) {
        const { data: filesRows, error: filesError } = await sb
          .from("files")
          .select("id, created_at, original_name, name")
          .eq("owner_id", ownerId)
          .eq("folder_id", folderId)
          .order("created_at", { ascending: false })
          .limit(80);

        if (filesError) {
          console.error("[doc-chunk-snippet] files title fallback error:", filesError);
        } else {
          const fileCandidates = ((filesRows ?? []) as FileRow[]).filter((f) => {
            const originalNorm = normalizeDocName(f.original_name);
            const nameNorm = normalizeDocName(f.name);
            return (
              originalNorm === titleNormalized ||
              nameNorm === titleNormalized ||
              originalNorm.includes(titleNormalized) ||
              nameNorm.includes(titleNormalized)
            );
          });

          let replacementRows: ChunkRow[] = [];
          for (const f of fileCandidates.slice(0, 6)) {
            const candidateFileId = String(f.id ?? "").trim();
            if (!candidateFileId) continue;
            const { data: chunksRows, error: chunksError } = await sb
              .from("doc_chunks")
              .select("*")
              .eq("owner_id", ownerId)
              .eq("file_id", candidateFileId)
              .limit(120);
            if (chunksError) {
              console.error("[doc-chunk-snippet] title fallback chunks error:", chunksError);
              continue;
            }
            const rows = (chunksRows ?? []) as ChunkRow[];
            if (!hasAnyContent(rows)) continue;
            replacementRows = rows;
            if (hasAnyPageMetadata(rows)) break;
          }

          if (replacementRows.length > 0) {
            const replacementHasMeta = hasAnyPageMetadata(replacementRows);
            if (
              sourceCandidates.length === 0 ||
              !sourceHasMeta ||
              chunkMissingInSource ||
              replacementHasMeta
            ) {
              sourceCandidates = replacementRows;
            }
          }
        }
      }
    }

    if (sourceCandidates.length > 0) {
      const rankedRaw = sourceCandidates
        .map((row) => {
          const m = matchStats(normalizeText(row.content).toLowerCase(), keywords);
          return { row, m };
        })
        .sort((a, b) => b.m.score - a.m.score);

      const seen = new Set<string>();
      const ranked = rankedRaw.filter((r) => {
        if (seen.has(r.row.id)) return false;
        seen.add(r.row.id);
        return true;
      });

      const hitRanked = ranked.filter((r) => r.m.hasHit);
      if (hitRanked.length > 0) {
        chosenRanked = hitRanked.slice(0, topK);
      } else if (chunkId) {
        const fallbackChunk = sourceCandidates.find((c) => c.id === chunkId) ?? sourceCandidates[0];
        if (fallbackChunk) {
          const m = matchStats(normalizeText(fallbackChunk.content).toLowerCase(), keywords);
          chosenRanked = [{ row: fallbackChunk, m }];
        }
      } else if (ranked.length > 0) {
        chosenRanked = ranked.slice(0, topK);
      }
    }

    if (chosenRanked.length === 0 && chunkId) {
      const { data, error } = await sb
        .from("doc_chunks")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("id", chunkId)
        .maybeSingle();

      if (error) {
        console.error("[doc-chunk-snippet] single chunk error:", error);
        return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
      }

      const fallback = (data as ChunkRow | null) ?? null;
      if (fallback) {
        const m = matchStats(normalizeText(fallback.content).toLowerCase(), keywords);
        chosenRanked = [{ row: fallback, m }];
      }
    }

    if (chosenRanked.length === 0) {
      return NextResponse.json({ ok: false, error: "Ikke fundet." }, { status: 404 });
    }

    const selectedChunkIds = new Set<string>();
    const selectedFingerprints = new Set<string>();
    const items: Array<{
      chunkId: string;
      title: string | null;
      url: string | null;
      snippetShort: string;
      snippetLong: string;
      hitCount: number;
      matchIndex: number;
      page?: string;
      pageFrom?: string;
      pageTo?: string;
      sourcePage?: string;
      pageLabel?: string;
      sourcePageLabel?: string;
      printedPage?: string;
      printedPageFrom?: string;
      printedPageTo?: string;
      printedPageLabel?: string;
      position?: string;
    }> = [];

    for (const { row, m } of chosenRanked) {
      const chunkIdStr = String(row.id);
      if (selectedChunkIds.has(chunkIdStr)) continue;

      const contentText = normalizeText(row.content);
      const center = m.minMatchIndex >= 0 ? m.minMatchIndex : Math.floor(contentText.length / 2);
      const snippetShort = windowSnippet(contentText, Math.max(0, center - 120), 450);
      const fp = snippetFingerprint(snippetShort);
      if (selectedFingerprints.has(fp)) continue;

      const snippetLong = windowSnippet(contentText, Math.max(0, center - 220), 900);
      items.push({
        chunkId: chunkIdStr,
        title: row.source ? String(row.source) : null,
        url: row.source_url ? String(row.source_url) : null,
        snippetShort,
        snippetLong,
        hitCount: m.hitCount,
        matchIndex: center,
        ...(pickPageLike(row, ["page"]) ? { page: pickPageLike(row, ["page"])! } : {}),
        ...(pickPageLike(row, ["page_from", "pageFrom"]) ? { pageFrom: pickPageLike(row, ["page_from", "pageFrom"])! } : {}),
        ...(pickPageLike(row, ["page_to", "pageTo"]) ? { pageTo: pickPageLike(row, ["page_to", "pageTo"])! } : {}),
        ...(pickPageLike(row, ["source_page", "sourcePage"]) ? { sourcePage: pickPageLike(row, ["source_page", "sourcePage"])! } : {}),
        ...(pickPageLike(row, ["page_label", "pageLabel"]) ? { pageLabel: pickPageLike(row, ["page_label", "pageLabel"])! } : {}),
        ...(pickPageLike(row, ["source_page_label", "sourcePageLabel"]) ? { sourcePageLabel: pickPageLike(row, ["source_page_label", "sourcePageLabel"])! } : {}),
        ...(pickPageLike(row, ["printed_page", "printedPage"]) ? { printedPage: pickPageLike(row, ["printed_page", "printedPage"])! } : {}),
        ...(pickPageLike(row, ["printed_page_from", "printedPageFrom"]) ? { printedPageFrom: pickPageLike(row, ["printed_page_from", "printedPageFrom"])! } : {}),
        ...(pickPageLike(row, ["printed_page_to", "printedPageTo"]) ? { printedPageTo: pickPageLike(row, ["printed_page_to", "printedPageTo"])! } : {}),
        ...(pickPageLike(row, ["printed_page_label", "printedPageLabel"]) ? { printedPageLabel: pickPageLike(row, ["printed_page_label", "printedPageLabel"])! } : {}),
        ...(pickPageLike(row, ["position", "page_position", "pagePosition"]) ? { position: pickPageLike(row, ["position", "page_position", "pagePosition"])! } : {}),
      });
      selectedChunkIds.add(chunkIdStr);
      selectedFingerprints.add(fp);
      if (items.length >= topK) break;
    }

    const response: Record<string, unknown> = {
      ok: true,
      items,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error("[doc-chunk-snippet] route error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
