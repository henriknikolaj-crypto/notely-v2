Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Write-Section($t){ Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }

# 0) Find .env.local i projektroden (kør script fra /notely-v2 eller /notely-v2/scripts)
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $repoRoot) { $repoRoot = (Get-Location).Path }
$envPath  = Join-Path $repoRoot ".env.local"
if (-not (Test-Path $envPath)) { Fail "Fandt ikke .env.local på: $envPath" }
Write-Host "ENV: $envPath" -ForegroundColor DarkGray

function Get-Env([string]$k) {
  $line = Get-Content $envPath | Where-Object { $_ -match ("^" + [regex]::Escape($k) + "=") }
  if (-not $line) { return $null }
  ($line -replace ("^" + [regex]::Escape($k) + "="), '').Trim(' "')
}

$base     = "http://127.0.0.1:3000"
$secret   = Get-Env "IMPORT_SHARED_SECRET"
$devEmail = Get-Env "DEV_USER_EMAIL"

if (-not $secret) { Fail "IMPORT_SHARED_SECRET mangler i .env.local" }

# 1) Sanity GET
Write-Section "GET $base/api/evaluate"
try {
  $get = Invoke-WebRequest -Uri "$base/api/evaluate" -Method GET -TimeoutSec 10
  Write-Host "Status: $($get.StatusCode)" -ForegroundColor Green
  Write-Host $get.Content
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Tip: Kører dev-serveren? (npm run dev)" -ForegroundColor Yellow
  exit 1
}

# 2) POST /api/evaluate (targets)
Write-Section "POST $base/api/evaluate (targets)"
$bodyObj = @{
  ownerEmail = $devEmail
  mode       = "light"
  targets    = @(
    @{ type = "generic";  text = "Smoke test via Invoke-WebRequest" }
    @{ type = "note";     id   = "00000000-0000-0000-0000-000000000001" }
  )
}
$payload = $bodyObj | ConvertTo-Json -Depth 10
Write-Host "Header x-shared-secret: <redacted>  | Body length: $($payload.Length)" -ForegroundColor DarkGray

try {
  $resp = Invoke-WebRequest -Uri "$base/api/evaluate" -Method POST -TimeoutSec 20 `
    -Headers @{ "x-shared-secret" = $secret; "Content-Type" = "application/json" } `
    -Body $payload
  Write-Host "Status: $($resp.StatusCode)" -ForegroundColor Green
  Write-Host $resp.Content
} catch {
  Write-Host "POST fejlede:" -ForegroundColor Red
  if ($_.Exception.Response) {
    $r = $_.Exception.Response
    Write-Host ("HTTP {0} {1}" -f $r.StatusCode.value__, $r.StatusCode) -ForegroundColor Red
    try {
      $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
      $errBody = $sr.ReadToEnd()
      Write-Host $errBody -ForegroundColor DarkRed
    } catch {}
  } else {
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
  Write-Host "`nTjek:" -ForegroundColor Yellow
  Write-Host "  • IMPORT_SHARED_SECRET matcher i .env.local og i route" -ForegroundColor Yellow
  Write-Host "  • app/api/evaluate/route.ts er bygget (se Next.js terminal for kompileringsfejl)" -ForegroundColor Yellow
  exit 1
}

Write-Host "`n✅ Debug færdig." -ForegroundColor Green
