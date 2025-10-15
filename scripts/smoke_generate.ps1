$base = "http://127.0.0.1:3000"

Write-Host "Testing POST /api/generate-question ..." -ForegroundColor Cyan
$response = Invoke-RestMethod -Uri "$base/api/generate-question" -Method POST -Body '{"includeBackground":false}' -ContentType "application/json"

$response | ConvertTo-Json -Depth 6
