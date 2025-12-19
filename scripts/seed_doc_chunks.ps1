[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [string]$FolderId,

  [Parameter(Mandatory=$true)]
  [string]$TopicName,

  [string]$UserEmail = "dev@example.com"
)

if (-not $env:IMPORT_SHARED_SECRET) {
  Write-Error "IMPORT_SHARED_SECRET mangler i miljøvariablerne. Sæt den først."
  return
}

# Eksempeltekst – skift den gerne senere
$chunk1 = @'
In the crowded hall, no one noticed when she stood up. The speech had drifted past
their ears like so many others – promises, numbers, distant conflicts. But in that
moment, as she placed her hands on the table and cleared her throat, the room
quietly shifted.

"I am tired of being told that patience is our only option," she began. "Patience
has become another word for silence."

For the first time that evening, people stopped scrolling on their phones.
'@

$chunk2 = @'
The road ahead will not be easy. It will demand courage, cooperation, and sacrifice.
Yet it is precisely in difficult times that the strength of a people is revealed.

So let us move forward together – not as rivals, but as partners in the unfinished
work of freedom and responsibility.
'@

$docChunks = @(
  @{
    content         = $chunk1
    source_type     = "user_upload"
    academic_weight = 10
  },
  @{
    content         = $chunk2
    source_type     = "user_upload"
    academic_weight = 10
  }
)

$bodyObject = @{
  userEmail = $UserEmail
  cost      = 1
  file      = @{
    md5         = ("{0:x32}" -f [math]::Abs($TopicName.GetHashCode()))
    fileId      = $TopicName
    fileName    = "$TopicName.pdf"
    storagePath = "external/dev/$TopicName"
  }
  folderId  = $FolderId
  docChunks = $docChunks
}

$bodyJson = $bodyObject | ConvertTo-Json -Depth 5

Write-Host "== Request body =="
Write-Host $bodyJson
Write-Host ""

$headers = @{
  "x-shared-secret" = $env:IMPORT_SHARED_SECRET
  "Content-Type"    = "application/json"
}

try {
  $response = Invoke-WebRequest -Method POST `
    -Uri "http://localhost:3000/api/import" `
    -Headers $headers `
    -Body $bodyJson

  Write-Host "Status:" $response.StatusCode
  Write-Host "Body:"
  Write-Host $response.Content
}
catch {
  Write-Error "Fejl ved kald til /api/import: $($_.Exception.Message)"
}
