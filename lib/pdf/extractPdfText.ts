// lib/pdf/extractPdfText.ts
import "server-only";

type ExtractOpts = {
  maxPages?: number; // sikkerheds-loft
};

export async function extractPdfTextPdfjs(buf: Buffer, opts: ExtractOpts = {}): Promise<string> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 500, 2000));

  // pdfjs-dist legacy build fungerer stabilt i Node (Next route runtime=nodejs)
  const mod: any = await import("pdfjs-dist/legacy/build/pdf.js");
  const pdfjs: any = mod?.default ?? mod;

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const pdf = await loadingTask.promise;

  const pages = Math.min(pdf.numPages || 0, maxPages);
  const out: string[] = [];

  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    const items = Array.isArray(tc?.items) ? tc.items : [];

    const pageText = items
      .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
      .filter(Boolean)
      .join(" ");

    if (pageText.trim()) out.push(pageText.trim());
  }

  return out.join("\n\n");
}
