param([string]$BaseUrl = "http://localhost:3000")
Write-Host "[SMOKE] generate-question ($BaseUrl)" -ForegroundColor Cyan

$body = '{"includeBackground":false}'
$resp = $null; $code = $null
try {
  $resp = Invoke-WebRequest -Uri "$BaseUrl/api/generate-question" -Method POST -ContentType 'application/json' -Body $body -ErrorAction Stop
  $code = [int]$resp.StatusCode
} catch {
  $resp = $_.Exception.Response
  if ($resp -and $resp.StatusCode) { $code = [int]$resp.StatusCode }
}
if ($null -eq $code) { Write-Error "Failed: no HTTP response (server unreachable?)"; exit 1 }
if ($code -ge 200 -and $code -lt 500) { Write-Host "OK: HTTP $code (server reachable)" -ForegroundColor Green } else { Write-Error "Failed: HTTP $code"; exit 1 }
