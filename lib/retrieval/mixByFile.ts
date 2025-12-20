// lib/retrieval/mixByFile.ts
export type FileChunkLike = {
  id: string;
  file_id: string | null;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function uniq<T>(arr: T[]) {
  const s = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (!s.has(x)) {
      s.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Input chunks antages at være "ranked" (bedst først).
 * Output forsøger at blande på tværs af file_id med round-robin.
 */
export function mixChunksByFile<T extends FileChunkLike>(
  rankedChunks: T[],
  targetTotal: number,
  opts?: { minFiles?: number; maxFiles?: number },
) {
  const minFiles = opts?.minFiles ?? 2;
  const maxFiles = opts?.maxFiles ?? 6;

  const chunks = rankedChunks.filter((c) => !!c.file_id) as Array<T & { file_id: string }>;
  if (chunks.length <= targetTotal) return chunks;

  const fileIdsInRankOrder = uniq(chunks.map((c) => c.file_id));
  const desiredFiles = clamp(
    Math.ceil(targetTotal / 3), // ca. 3 chunks pr fil som default
    minFiles,
    Math.min(maxFiles, fileIdsInRankOrder.length),
  );

  const pickedFileIds = fileIdsInRankOrder.slice(0, desiredFiles);
  const perFileCap = Math.max(1, Math.ceil(targetTotal / pickedFileIds.length));

  // group
  const byFile: Record<string, T[]> = {};
  for (const f of pickedFileIds) byFile[f] = [];
  for (const c of chunks) {
    if (pickedFileIds.includes(c.file_id)) byFile[c.file_id].push(c);
  }

  // trim pr fil (så én stor fil ikke dominerer)
  for (const f of pickedFileIds) byFile[f] = byFile[f].slice(0, perFileCap);

  // round-robin
  const idx = new Map<string, number>(pickedFileIds.map((f) => [f, 0]));
  const out: T[] = [];
  while (out.length < targetTotal) {
    let added = false;
    for (const f of pickedFileIds) {
      const i = idx.get(f) ?? 0;
      const list = byFile[f] ?? [];
      if (i < list.length) {
        out.push(list[i]);
        idx.set(f, i + 1);
        added = true;
        if (out.length >= targetTotal) break;
      }
    }
    if (!added) break;
  }

  // fallback: hvis vi stadig mangler (fx få chunks i en fil), fyld op fra resten
  if (out.length < targetTotal) {
    const used = new Set(out.map((c) => c.id));
    for (const c of chunks) {
      if (out.length >= targetTotal) break;
      if (used.has(c.id)) continue;
      out.push(c);
      used.add(c.id);
    }
  }

  return out.slice(0, targetTotal);
}
