param(
  [Parameter(Mandatory = $true)][string]$FileId,
  [string]$BaseUrl = "http://localhost:3000",
  [string]$SharedSecret = $env:IMPORT_SHARED_SECRET
)

$headers = @{}
if ($SharedSecret) {
  $headers["x-shared-secret"] = $SharedSecret
}

$uri = "$BaseUrl/api/dev/rebuild-chunks?fileId=$FileId"
Write-Host "Kalder $uri" -ForegroundColor Cyan

try {
  $resp = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers
  Write-Host ("Metode: {0} | Kvalitet: {1} | OCR-sider: {2}" -f $resp.extractionMethod, $resp.extractionQuality, $resp.ocrPages) -ForegroundColor Green
  if ($resp.extractionMeta) {
    Write-Host ("Dominant side-type: {0}" -f $resp.extractionMeta.dominant_page_type) -ForegroundColor Yellow
    Write-Host "Page type counts:" -ForegroundColor Cyan
    $resp.extractionMeta.page_type_counts | ConvertTo-Json -Depth 5
    Write-Host ("Table blocks: {0} | Formula blocks: {1}" -f $resp.extractionMeta.total_table_blocks, $resp.extractionMeta.total_formula_blocks) -ForegroundColor Green

    Write-Host "Pages:" -ForegroundColor Cyan
    foreach ($page in $resp.extractionMeta.pages) {
      Write-Host ("  side {0}: {1} ({2}/{3}) tbl={4} frm={5}" -f $page.page, $page.page_type, $page.extraction_method, $page.extraction_quality, $page.table_blocks, $page.formula_blocks)
      if ($page.structured_preview) {
        $preview = [string]$page.structured_preview
        if ($preview.Length -gt 160) { $preview = $preview.Substring(0, 160) + "..." }
        Write-Host ("    preview: {0}" -f ($preview -replace "`n"," <NL> ")) -ForegroundColor DarkGray
      }
    }
  }

  if ($resp.chunkPreview) {
    Write-Host "Chunk preview:" -ForegroundColor Magenta
    foreach ($chunk in $resp.chunkPreview) {
      $preview = [string]$chunk.content_preview
      if ($preview.Length -gt 180) { $preview = $preview.Substring(0, 180) + "..." }
      Write-Host ("  chunk {0} side {1} ({2}/{3}): {4}" -f $chunk.idx, $chunk.page_from, $chunk.extraction_method, $chunk.extraction_quality, ($preview -replace "`n"," <NL> ")) -ForegroundColor DarkGray
    }
  }

  $resp | ConvertTo-Json -Depth 10
}
catch {
  Write-Error "Smoke failed: $($_.Exception.Message)"
  exit 1
}
