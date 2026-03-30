param(
  [string]$BaseUrl = "http://localhost:3000",
  [Parameter(Mandatory = $true)]
  [ValidateSet("flashcards_generate", "mc_generate", "trainer_round")]
  [string]$FeatureKey,
  [Parameter(Mandatory = $true)]
  [string]$Endpoint,
  [string]$BodyJson = "{}",
  [string]$Cookie = "",
  [string]$DevSecret = ""
)

$ErrorActionPreference = "Stop"

function Get-Headers {
  $h = @{}
  if ($Cookie) { $h["Cookie"] = $Cookie }
  if ($DevSecret) {
    $h["x-dev-secret"] = $DevSecret
    $h["x-shared-secret"] = $DevSecret
  }
  return $h
}

function Read-Used {
  param([string]$Url, [string]$Feature)
  $res = Invoke-WebRequest -Uri $Url -Method GET -Headers (Get-Headers)
  $json = $res.Content | ConvertFrom-Json
  if (-not $json.ok) {
    throw "quota/current svarer ikke med ok=true: $($res.Content)"
  }
  $node = $json.$Feature
  if ($null -eq $node) { return 0 }
  $used = $node.usedThisMonth
  if ($null -eq $used) { return 0 }
  return [int]$used
}

function Invoke-JsonPost {
  param([string]$Url, [string]$Body)
  try {
    $res = Invoke-WebRequest -Uri $Url -Method POST -Headers (Get-Headers) -ContentType "application/json" -Body $Body
    return @{ status = [int]$res.StatusCode; body = $res.Content }
  } catch {
    $http = $_.Exception.Response
    if ($http -and $http.StatusCode) {
      $status = [int]$http.StatusCode
      $reader = New-Object System.IO.StreamReader($http.GetResponseStream())
      $txt = $reader.ReadToEnd()
      return @{ status = $status; body = $txt }
    }
    throw
  }
}

$base = $BaseUrl.TrimEnd("/")
$quotaUrl = "$base/api/quota/current"
$postUrl = "$base$Endpoint"

$before = Read-Used -Url $quotaUrl -Feature $FeatureKey
Write-Host "[quota] before $FeatureKey.usedThisMonth = $before" -ForegroundColor Cyan

for ($i = 1; $i -le 2; $i++) {
  $r = Invoke-JsonPost -Url $postUrl -Body $BodyJson
  Write-Host "[call#$i] POST $Endpoint -> $($r.status)" -ForegroundColor Yellow
  Write-Host $r.body
}

$after = Read-Used -Url $quotaUrl -Feature $FeatureKey
$delta = $after - $before

Write-Host "[quota] after  $FeatureKey.usedThisMonth = $after" -ForegroundColor Green
Write-Host "[quota] delta  = $delta" -ForegroundColor Green

if ($delta -le 0) {
  Write-Error "Forbrug steg ikke. Kontroller endpoint/body/auth."
}
