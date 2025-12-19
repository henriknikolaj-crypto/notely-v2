# Set-DevPlan.ps1
$ErrorActionPreference = "Stop"

function Read-DotEnv($path) {
  if (!(Test-Path $path)) { throw ".env file not found at $path" }
  $dict = @{}
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("="); if ($idx -lt 1) { return }
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
    if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length - 2) }
    $dict[$k] = $v
  }
  return $dict
}

$envs = Read-DotEnv ".env.local"
$SUPABASE_URL = $envs["SUPABASE_URL"]; if (-not $SUPABASE_URL) { $SUPABASE_URL = $envs["NEXT_PUBLIC_SUPABASE_URL"] }
$SERVICE_ROLE = $envs["SUPABASE_SERVICE_ROLE_KEY"]
$DEV_USER_ID  = $envs["DEV_USER_ID"]

$missing = @()
if (-not $SUPABASE_URL) { $missing += "SUPABASE_URL (eller NEXT_PUBLIC_SUPABASE_URL)" }
if (-not $SERVICE_ROLE) { $missing += "SUPABASE_SERVICE_ROLE_KEY" }
if (-not $DEV_USER_ID)  { $missing += "DEV_USER_ID" }
if ($missing.Count -gt 0) { throw "Mangler i .env.local: $($missing -join ', ')" }

$profilesUrl = "$SUPABASE_URL/rest/v1/profiles?id=eq.$DEV_USER_ID"
$headers = @{
  apikey        = $SERVICE_ROLE
  Authorization = "Bearer $SERVICE_ROLE"
  "Content-Type"= "application/json"
  Prefer        = "return=minimal"
}

Write-Host "Setting plan='pro' for DEV_USER_ID=$DEV_USER_ID ..." -ForegroundColor Cyan
Invoke-RestMethod -Uri $profilesUrl -Method PATCH -Headers $headers -Body '{"plan":"pro"}'

$verify = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/profiles?id=eq.$DEV_USER_ID&select=id,plan,quota_renew_at" -Headers $headers
if ($verify.Count -eq 1 -and $verify[0].plan -eq "pro") {
  Write-Host "✅ Plan updated: $($verify[0].id) → $($verify[0].plan) (quota_renew_at: $($verify[0].quota_renew_at))" -ForegroundColor Green
} else {
  Write-Host "⚠️ Could not verify plan update:" -ForegroundColor Yellow
  $verify | ConvertTo-Json -Depth 5
}
