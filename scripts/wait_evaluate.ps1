param(
  [string]$Base = "http://127.0.0.1:3000",
  [string]$JobId,
  [int]$TimeoutSec = 90,
  [int]$IntervalMs = 1000
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

# --- resolve paths (.env.local i repo-roden: ../ fra /scripts) ---
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { try { $ScriptDir = Split-Path -Parent $PSCommandPath } catch {} }
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }

$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$EnvPath  = Join-Path $RepoRoot ".env.local"

function Get-Env([string]$k){
  if (-not (Test-Path -LiteralPath $EnvPath)) { return $null }
  $line = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match ("^" + [regex]::Escape($k) + "=") }
  if (-not $line) { return $null }
  ($line -replace ("^" + [regex]::Escape($k) + "="), '').Trim(' "')
}

# --- auth headers (bearer or shared secret) ---
function Get-AuthHeaders {
  $h = @{}

  $email = Get-Env "DEV_USER_EMAIL"
  $pwd   = Get-Env "DEV_USER_PASSWORD"
  if ($email -and $pwd) {
    $body = @{ email = $email; password = $pwd } | ConvertTo-Json
    try {
      $resp = Invoke-WebRequest -Uri ($Base.TrimEnd('/') + "/api/auth/login") -Method POST -ContentType "application/json" -Body $body
      $tok  = ($resp.Content | ConvertFrom-Json).access_token
      if ($tok) { $h["Authorization"] = "Bearer $tok" }
    } catch {}
  }

  if (-not $h.ContainsKey("Authorization")) {
    $secret = Get-Env "IMPORT_SHARED_SECRET"
    if ($secret) { $h["x-shared-secret"] = $secret }
  }

  return $h
}

# <<< FIX: brug invocation-operatoren & >>> 
$Headers = & Get-AuthHeaders

# --- resolve JobId if missing: GET /api/dev/last-job ---
if (-not $JobId -or $JobId -eq "") {
  $r = Invoke-WebRequest -Uri ($Base.TrimEnd('/') + "/api/dev/last-job") -Headers $Headers -Method GET
  $o = $r.Content | ConvertFrom-Json
  if (-not $o -or -not $o.id) { throw "Kunne ikke hente seneste job-id. Angiv -JobId eksplicit." }
  $JobId = $o.id
}

# --- poll loop ---
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$last = $null

while ((Get-Date) -lt $deadline) {
  $res = Invoke-WebRequest -Uri ($Base.TrimEnd('/') + "/api/jobs/$JobId") -Method GET -Headers $Headers
  $obj = $res.Content | ConvertFrom-Json
  $last = $obj
  if ($obj.status -in @("succeeded","failed")) { break }
  Start-Sleep -Milliseconds $IntervalMs
}

"status: $($last.status)"
if ($last.status -eq "succeeded") {
  "tokens_used: $($last.tokens_used)"
  "latency_ms:  $($last.latency_ms)"
  "filters:     $([string]($last.filters | ConvertTo-Json -Depth 10))"
  "`nresult preview:`n$([string]($last.result | ConvertTo-Json -Depth 5))"
} else {
  "error: $($last.error)"
}
