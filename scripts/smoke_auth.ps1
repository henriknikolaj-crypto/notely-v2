# ===========================================
# 🔐 Smoke test – Notely auth endpoints
# ===========================================
$base = "http://localhost:3000"

function TestUrl($path) {
  $url = "$base$path"
  $r = try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 } catch { $_.Exception.Response }
  if ($r -and $r.StatusCode -eq 200) {
    Write-Host "✅ $path  →  $($r.StatusCode)" -ForegroundColor Green
  }
  elseif ($r) {
    Write-Host "⚠️  $path  →  $($r.StatusCode)" -ForegroundColor Yellow
  }
  else {
    Write-Host "❌ $path  →  no response" -ForegroundColor Red
  }
}

Write-Host "`n🔍  Testing Notely auth URLs..." -ForegroundColor Cyan

$urls = @(
  "/",                        # Forside (login/redirect)
  "/auth/login",              # Login
  "/auth/signup",             # Signup
  "/auth/reset",              # Reset password
  "/auth/callback?code=test", # Callback (forventer redirect 307)
  "/auth/logout",             # Logout
  "/exam",                    # Exam-dashboard
  "/api/whoami"               # Debug endpoint
)

foreach ($u in $urls) { TestUrl $u }

Write-Host "`n🏁 Done. If all are ✅ or ⚠️ (redirect 307), auth system is healthy." -ForegroundColor Cyan
