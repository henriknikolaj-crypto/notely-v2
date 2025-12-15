Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. Sti til din route-fil
$file = "app/api/evaluate/route.ts"

# 2. Læs hele filen som raw tekst
$raw = Get-Content $file -Raw

# 3. Regex: find blokken "1) Forsøg ny /v1/responses stil" frem til "2) Forsøg klassisk"
#    Vi indsætter /* ... */ rundt om den blok for at deaktivere den.
$pattern = '(// --------- 1\) Forsøg ny /v1/responses stil ---------[\s\S]*?)(// --------- 2\) Forsøg klassisk /v1/chat/completions ---------)'

if ($raw -match $pattern) {
    $before      = $Matches[1]
    $afterMarker = $Matches[2]

    # Byg kommenteret version
    $commentedBlock = "/*`r`n$before`r`n*/`r`n$afterMarker"

    # Erstat blokken i originaltekst
    $newRaw = [System.Text.RegularExpressions.Regex]::Replace(
        $raw,
        $pattern,
        [System.Text.RegularExpressions.MatchEvaluator]{
            param($m)
            return $commentedBlock
        },
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    # Backup først
    $backupName = "$file.bak_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Copy-Item $file $backupName

    # Skriv opdateret fil tilbage
    Set-Content $file $newRaw -Encoding utf8

    Write-Host "✔ Responses-blok er nu kommenteret ud i $file"
    Write-Host "  Backup gemt som $backupName"
} else {
    Write-Warning "Kunne ikke finde blokken i route.ts – tjek at kommentarlinjerne stadig matcher."
}
