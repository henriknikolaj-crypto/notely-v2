param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$FolderId = "f4388a81-a50e-499d-85ac-3631026294b9",
  [int]$Count = 10,
  [string]$Difficulty = "medium",
  [string]$DevSecret = "dev123"
)

Write-Host "== Smoke: /api/flashcards/generate ==" -ForegroundColor Cyan
Write-Host "BaseUrl: $BaseUrl"
Write-Host "FolderId: $FolderId"
Write-Host "Count: $Count"
Write-Host "Difficulty: $Difficulty"
Write-Host ""

$bodyObj = @{ scopeFolderIds=@($FolderId); count=$Count; difficulty=$Difficulty }
$bodyObj | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 .\body.json

function Invoke-Curl($Headers) {
  $args = @("-s","-i","$BaseUrl/api/flashcards/generate",
            "-H","Content-Type: application/json",
            "--data-binary","@body.json")

  foreach ($k in $Headers.Keys) {
    $args += @("-H", ("{0}: {1}" -f $k, $Headers[$k]))
  }

  $resp = & curl.exe @args
  if (-not $resp) { return @{ status = 0; raw = "" } }

  $raw = ($resp -join "`n")
  $m = [regex]::Match($raw, "^HTTP/1\.1\s+(\d+)", "Multiline")
  $status = if ($m.Success) { [int]$m.Groups[1].Value } else { 0 }
  return @{ status = $status; raw = $raw }
}

Write-Host "-- Auth attempt (no dev headers) (forvent 200 hvis logged-in ellers 401)" -ForegroundColor Yellow
$r1 = Invoke-Curl @{}
Write-Host "HTTP: $($r1.status)"
if ($r1.raw) {
  $i = $r1.raw.IndexOf("`n`n")
  if ($i -ge 0) { Write-Host $r1.raw.Substring($i + 2) }
}
Write-Host ""

Write-Host "-- Dev-bypass (x-dev-secret) (forvent 200)" -ForegroundColor Yellow
$r2 = Invoke-Curl @{ "x-dev-secret" = $DevSecret }
Write-Host "HTTP: $($r2.status)"
if ($r2.raw) {
  $i = $r2.raw.IndexOf("`n`n")
  if ($i -ge 0) { Write-Host $r2.raw.Substring($i + 2) }
}
Write-Host ""

Write-Host "-- Dev-bypass (x-shared-secret) (forvent 200)" -ForegroundColor Yellow
$r3 = Invoke-Curl @{ "x-shared-secret" = $DevSecret }
Write-Host "HTTP: $($r3.status)"
if ($r3.raw) {
  $i = $r3.raw.IndexOf("`n`n")
  if ($i -ge 0) { Write-Host $r3.raw.Substring($i + 2) }
}

Write-Host ""
Write-Host "✅ Done (PowerShell bliver ikke lukket af dette script)." -ForegroundColor Green
