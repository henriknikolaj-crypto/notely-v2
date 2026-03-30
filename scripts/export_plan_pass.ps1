param(
  [string]$OutFile = "plan_pass_bundle.md"
)

$paths = @(
  "lib/quota.ts",
  "lib/rateLimit.ts",
  "app/api/quota/current/route.ts",
  "app/api/evaluate/route.ts",
  "app/api/generate-question/route.ts",
  "app/api/generate-mc-batch/route.ts",
  "app/api/mc-submit/route.ts",
  "app/api/flashcards/generate/route.ts"
)

$patterns = @(
  "supabase/migrations/*quota*",
  "supabase/migrations/*plan*",
  "supabase/migrations/*usage*",
  "supabase/migrations/*entitlement*",
  "app/**/TrainingSidebar*.tsx",
  "app/**/Sidebar*Quota*.tsx",
  "app/**/Quota*.tsx",
  "app/**/useQuota*.ts",
  "app/**/useQuota*.tsx"
)

function Add-File([string]$p, [ref]$missing) {
  if (Test-Path $p) {
    "`n`n---`n## $p`n" | Out-File -FilePath $OutFile -Append -Encoding utf8
    Get-Content $p -Raw | Out-File -FilePath $OutFile -Append -Encoding utf8
  } else {
    $missing.Value += $p
  }
}

# Start fresh
"# Plan-pass bundle`n" | Out-File -FilePath $OutFile -Encoding utf8

# Optional git meta
try {
  $sha = (git rev-parse --short HEAD 2>$null)
  "`nRepo: $(Get-Location)`nCommit: $sha`n" | Out-File -FilePath $OutFile -Append -Encoding utf8
} catch {}

$missing = @()

# Exact paths
foreach ($p in $paths) { Add-File $p ([ref]$missing) }

# Pattern matches (best effort)
$seen = New-Object System.Collections.Generic.HashSet[string]
foreach ($pat in $patterns) {
  Get-ChildItem -Path $pat -File -ErrorAction SilentlyContinue | ForEach-Object {
    $rel = $_.FullName.Substring((Get-Location).Path.Length).TrimStart('\','/')
    if ($seen.Add($rel)) { Add-File $rel ([ref]$missing) }
  }
}

"`n`n---`n## Missing files (not found)`n" | Out-File -FilePath $OutFile -Append -Encoding utf8
if ($missing.Count -eq 0) {
  "None ✅" | Out-File -FilePath $OutFile -Append -Encoding utf8
} else {
  ($missing | Sort-Object | Get-Unique) | ForEach-Object { "- $_" } | Out-File -FilePath $OutFile -Append -Encoding utf8
}

Write-Host "Wrote: $OutFile"
