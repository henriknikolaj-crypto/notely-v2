param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$ScopeFolderIdsJson = "[]",
  [string]$FolderId = ""
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "== $msg =="
}

$sessionId = [Guid]::NewGuid().ToString()
$turnIndex = 0

Write-Step "1) POST /api/oral/generate"
$generateBody = @{
  scopeFolderIds = (ConvertFrom-Json $ScopeFolderIdsJson)
  folderId = if ($FolderId.Trim().Length -gt 0) { $FolderId } else { $null }
  sessionId = $sessionId
  turnIndex = $turnIndex
  previousTurns = @()
} | ConvertTo-Json -Depth 6

$generateRes = Invoke-RestMethod -Uri "$BaseUrl/api/oral/generate" -Method Post -ContentType "application/json" -Body $generateBody
if (-not $generateRes.ok -or [string]::IsNullOrWhiteSpace($generateRes.questionText)) {
  throw "Generate failed or missing questionText."
}
Write-Host "questionText:"
Write-Host $generateRes.questionText

Write-Step "2) POST /api/oral/tts"
$ttsBody = @{ text = [string]$generateRes.questionText } | ConvertTo-Json
$tmpMp3 = Join-Path $env:TEMP "oral_tts_smoke_$([Guid]::NewGuid().ToString('N')).mp3"

$ttsResponse = Invoke-WebRequest -Uri "$BaseUrl/api/oral/tts" -Method Post -ContentType "application/json" -Body $ttsBody -OutFile $tmpMp3
$ct = [string]$ttsResponse.Headers["Content-Type"]
$size = (Get-Item $tmpMp3).Length

Write-Host "Content-Type: $ct"
Write-Host "Bytes: $size"

if ($ttsResponse.StatusCode -ne 200) { throw "TTS did not return HTTP 200." }
if (-not $ct.ToLower().StartsWith("audio/mpeg")) { throw "TTS content-type is not audio/mpeg." }
if ($size -le 0) { throw "TTS returned empty audio." }

Write-Step "3) Optional placeholder submit check (expect 400 without audio)"
$submitBody = @{
  questionText = [string]$generateRes.questionText
  durationMin = "20"
  startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
  endedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
  sessionId = $sessionId
  turnIndex = "$turnIndex"
  notes = "smoke"
} 

try {
  Invoke-RestMethod -Uri "$BaseUrl/api/oral/submit" -Method Post -Form $submitBody | Out-Null
  throw "Expected submit without audio to fail, but it succeeded."
} catch {
  $msg = $_.Exception.Message
  Write-Host "Submit without audio failed as expected."
  Write-Host $msg
}

Write-Step "Done"
Write-Host "Smoke check passed."
