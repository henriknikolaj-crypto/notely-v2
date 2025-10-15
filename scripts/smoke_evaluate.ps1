Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

# --- Path resolution (works in PS 5/7) ---
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $PSCommandPath }
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

# --- .env.local in repo root (one level above /scripts) ---
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$EnvPath  = Join-Path $RepoRoot ".env.local"
if (-not (Test-Path $EnvPath)) { throw "Fandt ikke .env.local på: $EnvPath" }

function Get-Env([string]$k) {
  $line = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match ("^" + [regex]::Escape($k) + "=") }
  if (-not $line) { return $null }
  ($line -replace ("^" + [regex]::Escape($k) + "="), '').Trim(' "')
}

# --- Config from .env.local (with sensible defaults) ---
$BaseUrl          = (Get-Env "BASE_URL"); if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:3000" }
$SharedSecret     = Get-Env "IMPORT_SHARED_SECRET"         # fallback header
$DevUserEmail     = Get-Env "DEV_USER_EMAIL"
$DevUserPassword  = Get-Env "DEV_USER_PASSWORD"
$AppVersion       = (Get-Env "APP_VERSION"); if (-not $AppVersion) { $AppVersion = "web-0.6.0" }
$UiLocale         = (Get-Env "UI_LOCALE");   if (-not $UiLocale)   { $UiLocale   = "da-DK" }

# --- HTTP helpers ---
function Invoke-JsonPost {
  param([string]$Url,[string]$Json,[hashtable]$Headers=@{})
  $h = @{}
  foreach($k in $Headers.Keys){ $h[$k] = $Headers[$k] }
  Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Headers $h -Body $Json
}

function Get-AccessToken {
  param([string]$Base,[string]$Email,[string]$Password)
  if (-not $Email -or -not $Password) { return $null }
  $loginBody = @{ email=$Email; password=$Password } | ConvertTo-Json
  try {
    $resp = Invoke-JsonPost -Url ($Base.TrimEnd('/') + "/api/auth/login") -Json $loginBody
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
      $body = $resp.Content | ConvertFrom-Json
      return $body.access_token
    }
    return $null
  } catch {
    return $null
  }
}

# --- Build headers: prefer Bearer, else x-shared-secret ---
$Headers = @{}
$Token = Get-AccessToken -Base $BaseUrl -Email $DevUserEmail -Password $DevUserPassword
if ($Token) {
  $Headers["Authorization"] = "Bearer $Token"
} elseif ($SharedSecret) {
  $Headers["x-shared-secret"] = $SharedSecret
} else {
  throw "Mangler både Auth-token (DEV_USER_EMAIL/DEV_USER_PASSWORD) og IMPORT_SHARED_SECRET i $EnvPath"
}

# --- Build EVALUATE payload (B-profil: academic_soft toggle on) ---
# Ret 'ids' til rigtige file_* / folder_* id'er når de findes i DB
$BodyObj = @{
  analysis_type = "notes"  # "notes" | "quiz" | "flashcards"
  material      = @{
    type  = "selection"
    ids   = @("file_123","file_456")
    scope = "files"       # "files" | "folder" | "all"
  }
  academic_boost = $true
  client_context = @{
    app_version = $AppVersion
    ui_locale   = $UiLocale
  }
}
$Payload = $BodyObj | ConvertTo-Json -Depth 10

# --- POST /api/evaluate ---
$Url = ($BaseUrl.TrimEnd('/') + "/api/evaluate")
Write-Host "POST $Url ..." -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$Resp = Invoke-JsonPost -Url $Url -Json $Payload -Headers $Headers
$sw.Stop()

"`nStatus: $($Resp.StatusCode)"
"Elapsed: {0} ms" -f [math]::Round($sw.Elapsed.TotalMilliseconds)
"`nBody:"
$Resp.Content
