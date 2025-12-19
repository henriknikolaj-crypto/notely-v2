Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# === Konfiguration ===
# Dev-URL til Next.js
$baseUrl = "http://127.0.0.1:3000"

# Blue Ocean-filen (kan skiftes senere)
$fileId = "b63bd49f-1895-40a0-9b2c-fa4f0b901728"

# "resume" eller "focus"
$mode = "resume"

# === Request-body ===
$body = @{
    fileId = $fileId
    mode   = $mode
} | ConvertTo-Json

Write-Host "=== POST /api/traener/generate-notes ===" -ForegroundColor Cyan
Write-Host "fileId:" $fileId
Write-Host "mode  :" $mode
Write-Host ""

try {
    $res = Invoke-RestMethod `
        -Uri "$baseUrl/api/traener/generate-notes" `
        -Method POST `
        -ContentType "application/json; charset=utf-8" `
        -Body $body

    Write-Host "HTTP OK" -ForegroundColor Green
    Write-Host ""

    "ok      : $($res.ok)"
    "fromLLM : $($res.fromLLM)"
    "mode    : $($res.mode)"
    "note    :"
    $res.note | Format-List
}
catch {
    Write-Host "HTTP error:" -ForegroundColor Red

    try {
        if ($_.Exception.Response) {
            $respStream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($respStream)
            $raw = $reader.ReadToEnd()
            Write-Host $raw
        } else {
            $_ | Format-List
        }
    }
    catch {
        $_ | Format-List
    }
}
