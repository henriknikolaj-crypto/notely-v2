param(
    [string]$Type = "import",
    [int]$Limit = 1
)

Write-Host "=== Retry seneste import-job ===" -ForegroundColor Cyan

# 1) Tjek hemmeligheden
if (-not $env:IMPORT_SHARED_SECRET -or [string]::IsNullOrWhiteSpace($env:IMPORT_SHARED_SECRET)) {
    Write-Warning "IMPORT_SHARED_SECRET er ikke sat i dette PowerShell-vindue."
    Write-Host  "Sæt den med fx:"
    Write-Host  '$env:IMPORT_SHARED_SECRET = "din-hemmelige-nøgle-fra-.env.local"' -ForegroundColor Yellow
    throw "Manglende IMPORT_SHARED_SECRET."
}

$baseUri = "http://localhost:3000"
$headers = @{ "x-shared-secret" = $env:IMPORT_SHARED_SECRET }

# 2) Hent seneste import-job
$lastJobUri = "$baseUri/api/dev/last-job?type=$Type&limit=$Limit"
Write-Host "Henter seneste $Type-job via:" -ForegroundColor DarkGray
Write-Host "  $lastJobUri" -ForegroundColor DarkGray

try {
    $lastResp = Invoke-RestMethod -Method GET -Uri $lastJobUri -Headers $headers
} catch {
    Write-Error "Fejl ved kald til /api/dev/last-job: $_"
    return
}

if (-not $lastResp.ok) {
    Write-Error "Server svarede ok=false: $($lastResp.error)"
    return
}

if (-not $lastResp.jobs -or $lastResp.jobs.Count -eq 0) {
    Write-Warning "Ingen jobs fundet af typen '$Type'."
    return
}

$job = $lastResp.jobs[0]

Write-Host "Seneste job:" -ForegroundColor Cyan
Write-Host ("  id:        {0}" -f $job.id)
Write-Host ("  kind:      {0}" -f $job.kind)
Write-Host ("  status:    {0}" -f $job.status)
Write-Host ("  queued_at: {0}" -f $job.queued_at)
Write-Host ("  finished:  {0}" -f $job.finished_at)

if (-not $job.payload) {
    Write-Error "Job har ingen payload – kan ikke retry import."
    return
}

# 3) POST payloaden igen til /api/import
$importUri = "$baseUri/api/import"
Write-Host ""
Write-Host "Kalder $importUri med payload fra seneste job..." -ForegroundColor DarkGray

# Konverter payload til JSON
$bodyJson = $job.payload | ConvertTo-Json -Depth 15

try {
    $importResp = Invoke-RestMethod `
        -Method POST `
        -Uri $importUri `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $bodyJson

    Write-Host "Svar fra /api/import:" -ForegroundColor Cyan
    $importResp | ConvertTo-Json -Depth 10
} catch {
    Write-Error "Fejl ved kald til /api/import: $_"
}
