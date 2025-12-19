// scripts/pdf-text-test.mjs
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Brug: node scripts/pdf-text-test.mjs <sti-til-pdf>");
    process.exit(1);
  }

  const absPath = path.resolve(inputPath);
  const buffer = await fs.readFile(absPath);

  // pdfjs vil have Uint8Array, ikke Buffer
  const uint8Array = new Uint8Array(buffer);

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { getDocument } = pdfjsLib;

  const loadingTask = getDocument({ data: uint8Array });
  const pdf = await loadingTask.promise;

  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const pageText = (content.items || [])
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .filter(Boolean)
      .join(" ");

    fullText += `\n\n===== Side ${pageNum} =====\n\n${pageText}`;
  }

  const cleaned = fullText.replace(/\0/g, "").trim();

  console.log("Første 500 tegn:");
  console.log(cleaned.slice(0, 500));
  console.log("\n---");
  console.log("Antal tegn i alt:", cleaned.length);
}

main().catch((err) => {
  console.error("PDF-testfejl:", err);
  process.exit(1);
});
