param(
    [int]$Limit = 1
)

$ErrorActionPreference = "Stop"

if (-not $env:IMPORT_SHARED_SECRET) {
    Write-Error "IMPORT_SHARED_SECRET mangler i miljøet. Sæt den først."
}

$uri    = "http://localhost:3000/api/dev/last-job?type=import&limit=$Limit"
$secret = $env:IMPORT_SHARED_SECRET

Write-Host "Henter seneste $Limit import-job(s)..." -ForegroundColor Cyan

$response = curl.exe -s -H "x-shared-secret: $secret" $uri
$response | Out-Host
