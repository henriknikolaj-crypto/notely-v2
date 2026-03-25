param(
  [string]$BaseUrl = "http://localhost:3000",
  [Parameter(Mandatory = $true)]
  [string]$FolderId,
  [string]$SecondFolderId = "",
  [int]$Count = 10,
  [string]$DevSecret = "",
  [string]$Cookie = ""
)

$ErrorActionPreference = "Stop"

function Get-Headers {
  $h = @{}
  if ($DevSecret) {
    $h["x-dev-secret"] = $DevSecret
    $h["x-shared-secret"] = $DevSecret
  }
  if ($Cookie) { $h["Cookie"] = $Cookie }
  return $h
}

function Invoke-Json {
  param([string]$Method, [string]$Url, [object]$Body = $null)
  $headers = Get-Headers
  try {
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Depth 8
      $res = Invoke-WebRequest -Uri $Url -Method $Method -Headers $headers -ContentType "application/json" -Body $json
    } else {
      $res = Invoke-WebRequest -Uri $Url -Method $Method -Headers $headers
    }
    return @{ status = [int]$res.StatusCode; json = ($res.Content | ConvertFrom-Json) }
  } catch {
    $http = $_.Exception.Response
    if ($http -and $http.StatusCode) {
      $status = [int]$http.StatusCode
      $reader = New-Object System.IO.StreamReader($http.GetResponseStream())
      $txt = $reader.ReadToEnd()
      $obj = $null
      try { $obj = $txt | ConvertFrom-Json } catch {}
      return @{ status = $status; json = $obj; raw = $txt }
    }
    throw
  }
}

$base = $BaseUrl.TrimEnd("/")
$since = (Get-Date -Hour 0 -Minute 0 -Second 0).ToString("o")

Write-Host "== Smoke: Flashcards sessions/progress ==" -ForegroundColor Cyan
Write-Host "BaseUrl: $base"
Write-Host "FolderId: $FolderId"
if ($SecondFolderId) { Write-Host "SecondFolderId: $SecondFolderId" }
Write-Host "Count: $Count"
Write-Host ""

$scopeIds = @($FolderId)
if ($SecondFolderId) { $scopeIds += $SecondFolderId }

$genBody = @{
  scopeFolderIds = $scopeIds
  count = $Count
  difficulty = "medium"
  maxContextChunks = 14
}

$gen = Invoke-Json -Method "POST" -Url "$base/api/flashcards/generate" -Body $genBody
Write-Host "POST /api/flashcards/generate -> $($gen.status)"
if ($gen.json) { Write-Host (($gen.json | ConvertTo-Json -Depth 6)) }
if ($gen.status -ne 200) { throw "Generate fejlede med status $($gen.status)." }

$sessQs = "limit=5"
foreach ($sid in $scopeIds) {
  $sessQs += "&scopeFolderIds[]=$([uri]::EscapeDataString($sid))"
}
$sessUrl = "$base/api/flashcards/sessions?$sessQs"
$sess = Invoke-Json -Method "GET" -Url $sessUrl
Write-Host ""
Write-Host "GET /api/flashcards/sessions?limit=5 -> $($sess.status)"
if ($sess.json) { Write-Host (($sess.json | ConvertTo-Json -Depth 6)) }
if ($sess.status -ne 200) { throw "Sessions fejlede med status $($sess.status)." }

$sessionCount = @($sess.json.sessions).Count
if ($sessionCount -lt 1) { throw "Forventede mindst 1 session efter generate." }

$progQs = "since=$([uri]::EscapeDataString($since))"
foreach ($sid in $scopeIds) {
  $progQs += "&scopeFolderIds[]=$([uri]::EscapeDataString($sid))"
}
$progUrl = "$base/api/flashcards/progress?$progQs"
$prog = Invoke-Json -Method "GET" -Url $progUrl
Write-Host ""
Write-Host "GET /api/flashcards/progress -> $($prog.status)"
if ($prog.json) { Write-Host (($prog.json | ConvertTo-Json -Depth 6)) }
if ($prog.status -ne 200) { throw "Progress fejlede med status $($prog.status)." }

$todayUsed = 0
if ($null -ne $prog.json.todayUsed) { $todayUsed = [int]$prog.json.todayUsed }
elseif ($null -ne $prog.json.doneToday) { $todayUsed = [int]$prog.json.doneToday }

if ($todayUsed -lt $Count) {
  throw "Forventede todayUsed >= $Count, men fik $todayUsed."
}

Write-Host ""
Write-Host "OK: sessions>=1 og todayUsed=$todayUsed" -ForegroundColor Green
