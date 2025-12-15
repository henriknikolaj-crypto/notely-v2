Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. Læs DEV_USER_ID fra .env.local
$envPath = ".\.env.local"
$envText = Get-Content $envPath -Raw

$devUserId = ($envText -split "`n" |
    Where-Object { $_ -match '^DEV_USER_ID=' } |
    ForEach-Object { $_ -replace '^DEV_USER_ID=', '' }
).Trim()

if (-not $devUserId) {
    Write-Warning "Kunne ikke finde DEV_USER_ID i .env.local - bruger <PUT_USER_ID_HER>"
    $devUserId = "<PUT_USER_ID_HER>"
}

# 2. Lav SQL-indhold
$sql = @"
-- Slå Row Level Security til
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: tillad INSERT hvis owner_id == DEV_USER_ID
CREATE POLICY insert_own_exam_sessions_dev
ON public.exam_sessions
FOR INSERT
WITH CHECK ( owner_id = '$devUserId' );

-- Policy: tillad SELECT hvis owner_id == DEV_USER_ID
CREATE POLICY select_own_exam_sessions_dev
ON public.exam_sessions
FOR SELECT
USING ( owner_id = '$devUserId' );
"@

# 3. Gem i en fil
$outFile = ".\exam_sessions_policies.sql"
Set-Content $outFile $sql -Encoding utf8

Write-Host "✔ Skrev policies til $outFile"
Write-Host ""
Write-Host "Næste trin:"
Write-Host "1. Åbn Supabase projektet i browseren"
Write-Host "2. Gå til SQL editor"
Write-Host "3. Kopiér hele exam_sessions_policies.sql ind og kør det"
Write-Host "4. Hvis Supabase brokker sig over duplikerede policy-navne,"
Write-Host "   så slet gamle policies under Table Editor → exam_sessions → Policies og prøv igen."
