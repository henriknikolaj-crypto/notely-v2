param(
    [string]$Secret
)

Write-Host "=== Quota status ==="

# 1) Find shared secret: først -Secret param, ellers miljøvariabel
$secretValue = $Secret
if (-not $secretValue -or [string]::IsNullOrWhiteSpace($secretValue)) {
    $secretValue = $env:IMPORT_SHARED_SECRET
}

if ([string]::IsNullOrWhiteSpace($secretValue)) {
    Write-Warning "IMPORT_SHARED_SECRET kunne ikke findes."
    Write-Host "Sæt den i denne PowerShell-session som f.eks.:"
    Write-Host '  $env:IMPORT_SHARED_SECRET = "din-hemmelige-nøgle"'
    Write-Host ""
    Write-Host "Eller kør scriptet med -Secret, fx:"
    Write-Host '  .\scripts\quota_status.ps1 -Secret "din-hemmelige-nøgle"'
    exit 1
}

$uri = "http://localhost:3000/api/dev/quota-status"
$headers = @{ "x-shared-secret" = $secretValue }

try {
    Write-Host ""
    Write-Host "Kalder $uri ..." -ForegroundColor DarkGray

    $resp = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers

    # === Case 1: API har allerede et samlet quota-felt ===
    $plan  = $resp.plan
    $quota = $resp.quota

    if ($quota) {
        Write-Host ""
        if ($plan) {
            Write-Host ("Plan:    {0}" -f $plan)
        }

        $remaining = $quota.remaining
        $limit     = $quota.limit
        $renewAt   = $quota.renewAt

        if ($remaining -ne $null -and $limit -ne $null) {
            Write-Host ("Forbrug: {0} / {1}" -f $remaining, $limit)
        }

        if ($renewAt) {
            Write-Host ("Fornys:  {0}" -f $renewAt)
        }

        Write-Host ""
        Write-Host "Rå JSON-svar:" -ForegroundColor DarkGray
        $resp | ConvertTo-Json -Depth 8
        return
    }

    # === Case 2: Ingen quota-felt → brug profile/import/evaluate som i dit svar ===
    $profile  = $resp.profile
    $import   = $resp.import
    $evaluate = $resp.evaluate

    Write-Host ""

    if ($resp.ownerId) {
        Write-Host ("Bruger-ID: {0}" -f $resp.ownerId)
    }

    if ($profile) {
        $pPlan   = $profile.plan
        $pQuota  = $profile.quota
        $renewAt = $profile.quota_renew_at

        if ($pPlan) {
            Write-Host ("Plan:     {0}" -f $pPlan)
        }
        if ($pQuota -ne $null) {
            Write-Host ("Quota (profil): {0}" -f $pQuota)
        }
        if ($renewAt) {
            Write-Host ("Quota fornyes:  {0}" -f $renewAt)
        }
    }

    if ($import) {
        $used   = $import.usedThisMonth
        $total  = $import.totalAllTime
        $limitM = $import.limitPerMonth

        $limitText = if ($limitM -ne $null) { $limitM } else { "ingen grænse sat" }

        Write-Host ""
        Write-Host "Import (upload af pensum):"
        Write-Host ("  Brug denne måned: {0}" -f $used)
        Write-Host ("  I alt:            {0}" -f $total)
        Write-Host ("  Månedlig grænse:  {0}" -f $limitText)
    }

    if ($evaluate) {
        $used   = $evaluate.usedThisMonth
        $total  = $evaluate.totalAllTime
        $limitM = $evaluate.limitPerMonth

        $limitText = if ($limitM -ne $null) { $limitM } else { "ingen grænse sat" }

        Write-Host ""
        Write-Host "Evaluate (skriftlig sensorevaluering):"
        Write-Host ("  Brug denne måned: {0}" -f $used)
        Write-Host ("  I alt:            {0}" -f $total)
        Write-Host ("  Månedlig grænse:  {0}" -f $limitText)
    }

    Write-Host ""
    Write-Host "Rå JSON-svar:" -ForegroundColor DarkGray
    $resp | ConvertTo-Json -Depth 8
}
catch {
    Write-Error ("Fejl ved kald til {0}: {1}" -f $uri, $_.Exception.Message)
}
