Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$base = "http://127.0.0.1:3000"

Write-Host "=== Smoke MC: hent mapper ==="

# 1) Hent mapper fra /api/folders
$foldersJson = iwr "$base/api/folders" -UseBasicParsing |
  Select-Object -ExpandProperty Content

Write-Host "Raw /api/folders JSON:"
Write-Host $foldersJson
Write-Host ""

$foldersObj = $foldersJson | ConvertFrom-Json

# Support flere formater: [ {..} ], { folders: [..] }, { data: [..] }
if ($foldersObj -is [System.Array]) {
  $folders = $foldersObj
}
elseif ($foldersObj.PSObject.Properties.Name -contains "folders") {
  $folders = $foldersObj.folders
}
elseif ($foldersObj.PSObject.Properties.Name -contains "data") {
  $folders = $foldersObj.data
}
else {
  throw "Kunne ikke finde mapper i JSON fra /api/folders."
}

if (-not $folders -or -not $folders[0]) {
  throw "Ingen mapper fundet – opret mindst én mappe først."
}

$folderId = $folders[0].id
$folderName = $folders[0].name

Write-Host "Bruger mappe:" $folderName "($folderId)" -ForegroundColor Cyan

# 2) POST /api/generate-mc-question
Write-Host ""
Write-Host "=== POST /api/generate-mc-question ==="

$genBody = @{
  scopeFolderIds   = @($folderId)
  difficulty       = "medium"
  maxContextChunks = 8
} | ConvertTo-Json -Depth 5

$genResp = iwr "$base/api/generate-mc-question" `
  -Method Post `
  -ContentType "application/json" `
  -Body $genBody `
  -UseBasicParsing

$genJson = $genResp.Content
$genObj  = $genJson | ConvertFrom-Json

Write-Host "Status:" $genResp.StatusCode
Write-Host "Spørgsmål:" $genObj.question
Write-Host "Svarmuligheder:"
$genObj.options | ForEach-Object {
  Write-Host " - [$($_.id)] $($_.text)"
}

# 3) POST /api/mc-submit (vælg bare første option)
Write-Host ""
Write-Host "=== POST /api/mc-submit ==="

$selected = $genObj.options[0]

$submitBody = @{
  questionId          = $genObj.questionId
  question            = $genObj.question
  selectedOptionId    = $selected.id
  selectedOptionText  = $selected.text
  isCorrect           = $selected.isCorrect
  scopeFolderIds      = @($folderId)
  explanation         = $genObj.explanation
} | ConvertTo-Json -Depth 5

$submitResp = iwr "$base/api/mc-submit" `
  -Method Post `
  -ContentType "application/json" `
  -Body $submitBody `
  -UseBasicParsing

Write-Host "mc-submit status:" $submitResp.StatusCode
Write-Host "mc-submit body:"
Write-Host $submitResp.Content
