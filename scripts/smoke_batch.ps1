param(
  [int]$Count = 3,
  [int]$TimeoutSec = 30,
  [int]$IntervalMs = 750
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

# --- .env.local ---
$repo = Get-Location
$envPath = Join-Path $repo ".env.local"
if (-not (Test-Path $envPath)) { throw "Fandt ikke .env.local i $repo" }

function Get-Env([string]$k) {
  $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match ("^" + [regex]::Escape($k) + "=") }
  if (-not $line) { return $null }
  ($line -replace ("^" + [regex]::Escape($k) + "="), '').Trim(' "')
}

$Base   = (Get-Env "BASE_URL"); if (-not $Base) { $Base = "http://127.0.0.1:3000" }
$Secret = Get-Env "IMPORT_SHARED_SECRET"
if (-not $Secret) { throw "IMPORT_SHARED_SECRET mangler i .env.local" }
$hdr = @{ "x-shared-secret" = $Secret }

# --- helpers ---
function Invoke-JsonPost {
  param([string]$Url,[hashtable]$Headers,[object]$BodyObj)
  $json = $BodyObj | ConvertTo-Json -Depth 10
  return Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Headers $Headers -Body $json
}

function Get-Job([string]$Id,[hashtable]$Headers){
  $r = Invoke-WebRequest -Uri ($Base.TrimEnd('/') + "/api/jobs/$Id") -Headers $Headers -Method GET
  return ($r.Content | ConvertFrom-Json)
}

function Complete-Job([string]$Id,[hashtable]$Headers){
  $b = @{ id = $Id }
  $r = Invoke-JsonPost -Url ($Base.TrimEnd('/') + "/api/dev/complete-job") -Headers $Headers -BodyObj $b
  return ($r.Content | ConvertFrom-Json)
}

function Wait-Job([string]$Id,[hashtable]$Headers,[int]$TimeoutSec,[int]$IntervalMs){
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $last = $null
  while((Get-Date) -lt $deadline){
    try {
      $o = Get-Job -Id $Id -Headers $Headers
      $last = $o
      if ($o.status -in @("succeeded","failed")) { break }
    } catch { $last = @{ status="error"; error=$_.Exception.Message } ; break }
    Start-Sleep -Milliseconds $IntervalMs
  }
  return $last
}

# --- Preflight: er dev-serveren oppe? ---
try {
  Invoke-WebRequest -Uri ($Base.TrimEnd('/') + "/api/dev/last-job") -Headers $hdr -Method GET -TimeoutSec 5 | Out-Null
} catch {
  $msg = if ($_.Exception.Message) { $_.Exception.Message } else { "Ukendt fejl" }
  throw "Dev-server ikke klar (kør 'npm run dev' i et andet vindue). Detaljer: $msg"
}

# --- payload skabelon ---
function New-Payload {
  param([int]$i)
  return @{
    analysis_type  = "notes"
    material       = @{ type="selection"; ids=@("file_$i","file_$([Guid]::NewGuid().ToString('N').Substring(6))"); scope="files" }
    academic_boost = $true
    client_context = @{ app_version="web-0.6.0"; ui_locale="da-DK" }
  }
}

# --- kør batch ---
$results = @()
for($i=1; $i -le $Count; $i++){
  Write-Host "[$i/$Count] Opretter job..." -ForegroundColor Cyan
  try {
    $resp = Invoke-JsonPost -Url ($Base.TrimEnd('/') + "/api/evaluate") -Headers $hdr -BodyObj (New-Payload -i $i)
    $obj  = $resp.Content | ConvertFrom-Json
    $id   = $obj.job.id
    Write-Host "  POST /api/evaluate -> 200 (id: $id)" -ForegroundColor Green
  } catch {
    if ($_.Exception.Response) {
      $sr = New-Object IO.StreamReader $_.Exception.Response.GetResponseStream(); $txt=$sr.ReadToEnd(); $sr.Close()
      throw "  Fejl ved opret: $([int]$_.Exception.Response.StatusCode) $txt"
    } else {
      throw "  Fejl ved opret (ingen HTTP-response): $($_.Exception.Message)"
    }
  }

  # Markér succeeded i dev
  try {
    Complete-Job -Id $id -Headers $hdr | Out-Null
    Write-Host "  complete-job -> OK" -ForegroundColor DarkGreen
  } catch {
    if ($_.Exception.Response) {
      $sr = New-Object IO.StreamReader $_.Exception.Response.GetResponseStream(); $txt=$sr.ReadToEnd(); $sr.Close()
      throw "  Fejl ved complete-job: $([int]$_.Exception.Response.StatusCode) $txt"
    } else {
      throw "  Fejl ved complete-job (ingen HTTP-response): $($_.Exception.Message)"
    }
  }

  # Vent/poll til færdig
  $res = Wait-Job -Id $id -Headers $hdr -TimeoutSec $TimeoutSec -IntervalMs $IntervalMs
  $ok  = ($res.status -eq "succeeded")
  $results += [pscustomobject]@{
    id          = $id
    status      = $res.status
    tokens_used = $res.tokens_used
    latency_ms  = $res.latency_ms
    ok          = $ok
  }
  $color = $(if ($ok) { "Green" } else { "Yellow" })
  Write-Host ("  result: {0} (tokens={1}, latency={2} ms)" -f $res.status, $res.tokens_used, $res.latency_ms) -ForegroundColor $color
}

# --- summary (robust) ---
Write-Host "`nSUMMARY" -ForegroundColor Magenta
$results | Format-Table id, status, tokens_used, latency_ms, ok -AutoSize

# Nogle shells kan sende ikke-objekter i arrays; filtrér defensivt:
$failed = @(
  $results | Where-Object {
    $_ -is [psobject] -and $_.psobject.Properties["ok"] -and (-not $_.ok)
  }
)
if ($failed.Count -gt 0) {
  throw "Én eller flere jobs endte ikke i 'succeeded'."
} else {
  Write-Host "`nAlle $Count jobs endte i 'succeeded' ✅" -ForegroundColor Green
}
