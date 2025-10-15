param([string]$Base = "http://localhost:3000")

function Test-Route($path) {
  $url = "$Base$path"
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -ErrorAction Stop
    Write-Host " $path   $($resp.StatusCode)"
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code) { Write-Host " $path   $code" -ForegroundColor Red }
    else       { Write-Host "  $path   ingen svar" -ForegroundColor Yellow }
  }
}

Write-Host "`n--- Testing local Next.js routes ---`n"
"/","/auth/login","/auth/callback?code=test","/exam" | % { Test-Route $_ }

Write-Host "`n--- File sanity ---`n"
$loginFile = "src/app/auth/login/page.tsx"
$callbackFile = "src/app/auth/callback/route.ts"
if (Test-Path $loginFile)    { Write-Host " $loginFile findes" } else { Write-Host " $loginFile mangler" -ForegroundColor Red }
if (Test-Path $callbackFile) { Write-Host " $callbackFile findes" } else { Write-Host " $callbackFile mangler" -ForegroundColor Red }
