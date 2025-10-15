Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

# Find .env.local i repo-roden
$RepoRoot = (Split-Path -Parent $PSScriptRoot); if (-not $RepoRoot) { $RepoRoot = (Get-Location).Path }
$EnvPath  = Join-Path $RepoRoot ".env.local"
if (-not (Test-Path $EnvPath)) { throw "Fandt ikke .env.local på: $EnvPath" }

function Get-Env([string]$k) {
  $line = Get-Content $EnvPath | Where-Object { $_ -match ("^" + [regex]::Escape($k) + "=") }
  if (-not $line) { return $null }
  ($line -replace ("^" + [regex]::Escape($k) + "="), '').Trim(' "')
}

$base   = "http://localhost:3000"
$secret = Get-Env "IMPORT_SHARED_SECRET"
$owner  = Get-Env "DEV_USER_ID"
$setId  = $env:STUDY_SET_ID

if (-not $secret) { throw "Missing IMPORT_SHARED_SECRET i $EnvPath" }
if (-not $owner)  { throw "Missing DEV_USER_ID i $EnvPath" }
if (-not $setId)  { throw "Set env var STUDY_SET_ID to an existing Study Set UUID" }

$payload = (@{ ownerId = $owner; mode = "light"; set_id = $setId } | ConvertTo-Json -Depth 10)

Write-Host "POST /api/evaluate (set_id=$setId) ..."
$resp = Invoke-WebRequest -Uri "$base/api/evaluate" -Method POST -TimeoutSec 20 `
  -Headers @{ "x-shared-secret" = $secret; "Content-Type" = "application/json" } `
  -Body $payload

Write-Host "`nStatus: $($resp.StatusCode)"
$resp.Content
