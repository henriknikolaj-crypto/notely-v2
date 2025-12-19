# scripts/quota_tool.ps1
# PowerShell 5.1-kompatibel helper til kvote-flowet (reset, view, smoke)

Set-StrictMode -Version 2.0

function Get-EnvValue([string]$Name) {
  $line = Get-Content .env.local | Where-Object { $_ -match ("^" + [regex]::Escape($Name) + "=") }
  if (-not $line) { return $null }
  ($line -replace ("^" + [regex]::Escape($Name) + "="), '') | ForEach-Object { $_.Trim('"').Trim() }
}

function Copy-ResetQuotaSql([string]$Email, [int]$Quota = 2, [int]$Days = 7) {
  if (-not $Email) { throw "Email required" }
  $e = $Email.Replace("'", "''")
  $sql = @"
update public.profiles
   set quota = $Quota,
       quota_renew_at = now() + interval '$Days days'
 where lower(email) = lower('$e');
"@
  Set-Clipboard $sql
  Write-Host "✅ Reset-SQL kopieret → Supabase SQL Editor → Paste → Run" -ForegroundColor Green
}

function Copy-ShowQuotaSql([string]$Email) {
  if (-not $Email) { throw "Email required" }
  $e = $Email.Replace("'", "''")
  $sql = @"
select id, email, quota, quota_renew_at
  from public.profiles
 where lower(email)=lower('$e');
"@
  Set-Clipboard $sql
  Write-Host "👀 View-SQL kopieret → Supabase SQL Editor → Paste → Run" -ForegroundColor Cyan
}

function Smoke-ImportByEmailPs51([string]$Email, [int]$Times = 4, [int]$Cost = 1) {
  if (-not $Email) { throw "Email required" }

  $base    = "http://127.0.0.1:3000"
  $secret  = Get-EnvValue "IMPORT_SHARED_SECRET"

  if (-not $secret) { throw "IMPORT_SHARED_SECRET mangler i .env.local" }

  1..$Times | ForEach-Object {
    $payload = @{ userEmail = $Email; cost = $Cost } | ConvertTo-Json -Compress
    try {
      $r = Invoke-WebRequest -Uri "$base/api/import" -Method POST `
            -Headers @{ "x-shared-secret"=$secret; "Content-Type"="application/json" } `
            -Body $payload
      $b = $r.Content | ConvertFrom-Json

      # Find 'remaining' robust uden ?? / ?. (PS 5.1)
      $remaining = $null
      if ($b -and $b.PSObject.Properties.Match('remaining').Count -gt 0) {
        $remaining = $b.remaining
      } elseif ($b -and $b.PSObject.Properties.Match('result').Count -gt 0 -and $b.result `
                 -and $b.result.PSObject.Properties.Match('audit').Count -gt 0 -and $b.result.audit `
                 -and $b.result.audit.PSObject.Properties.Match('quota_after').Count -gt 0) {
        $remaining = $b.result.audit.quota_after
      }

      [pscustomobject]@{
        i         = $_
        http      = [int]$r.StatusCode
        ok        = $b.ok
        remaining = $remaining
      }
    } catch {
      $resp = $_.Exception.Response
      if ($resp) {
        $sr  = New-Object IO.StreamReader($resp.GetResponseStream())
        $raw = $sr.ReadToEnd()
        $rem = $null
        try {
          $bj = $raw | ConvertFrom-Json
          if ($bj -and $bj.PSObject.Properties.Match('remaining').Count -gt 0) { $rem = $bj.remaining }
        } catch {}
        [pscustomobject]@{
          i         = $_
          http      = [int]$resp.StatusCode
          ok        = $false
          remaining = $rem
        }
      } else {
        [pscustomobject]@{ i = $_; http = -1; ok = $false; remaining = $null }
      }
    }
  } | Format-Table -AutoSize
}

function Start-QuotaTool {
  Write-Host "`n=== Notely Quota Tool ===" -ForegroundColor Yellow
  $global:QTEmail = Read-Host "Indtast brugerens email (bruges som default i menuen)"

  while ($true) {
    Write-Host "`nVælg handling:"
    Write-Host "  1) Smoke-test (4 kald, cost=1)"
    Write-Host "  2) Reset quota (vælg quota + dage)"
    Write-Host "  3) Show quota (kopiér SELECT til clipboard)"
    Write-Host "  4) Custom smoke (vælg times + cost)"
    Write-Host "  5) Skift email (nu: $QTEmail)"
    Write-Host "  0) Afslut"
    $c = Read-Host "Valg"

    switch ($c) {
      '1' {
        Smoke-ImportByEmailPs51 $QTEmail 4 1
      }
      '2' {
        $q = Read-Host "Quota (default 2)"; if (-not $q) { $q = 2 }
        $d = Read-Host "Forny om (dage) (default 7)"; if (-not $d) { $d = 7 }
        Copy-ResetQuotaSql $QTEmail ([int]$q) ([int]$d)
      }
      '3' {
        Copy-ShowQuotaSql $QTEmail
      }
      '4' {
        $t = Read-Host "Antal kald (default 4)"; if (-not $t) { $t = 4 }
        $k = Read-Host "Cost pr. kald (default 1)"; if (-not $k) { $k = 1 }
        Smoke-ImportByEmailPs51 $QTEmail ([int]$t) ([int]$k)
      }
      '5' {
        $global:QTEmail = Read-Host "Ny email"
      }
      '0' { break }
      default { Write-Host "Ugyldigt valg." -ForegroundColor DarkYellow }
    }
  }
  Write-Host "Farvel 👋"
}
