<# ========================================================================
 Phase 4 Extras – Notely (helpers & patches)
 Compatible with Windows PowerShell 5.1 and PowerShell 7

 USAGE (from repo root):
   . .\scripts\phase4_extras.ps1          # dot-source once per session
   Reset-Quota; View-Quota                # copy SQL -> clipboard
   Smoke-Import 4 1                       # raw smoke
   Smoke-ImportPretty 4 1                 # pretty table smoke
   Set-Plan pro                           # copy SQL to set plan
   Patch-Audit                            # add audit to route.ts
   RateLimit-Enable 10 60                 # enable simple in-memory 429
   RateLimit-Disable                      # remove the RL block again
   Checklist-Quick                        # mini checklist output

========================================================================= #>

function Get-Env($k){
  (Get-Content .env.local | ? { $_ -match "^$k=" }) `
    -replace ("^$k=",'' ) | % { $_.Trim('"').Trim() }
}

# ---------- SQL helpers (copy to clipboard) ----------
function Reset-Quota {
@"
update public.profiles
set quota = 2, quota_renew_at = now() + interval '7 days'
where id = '$(Get-Env DEV_USER_ID)'::uuid;
"@ | Set-Clipboard
'✅ Reset-SQL -> clipboard (Supabase SQL Editor → Run)'
}

function View-Quota {
@"
select id, email, plan, quota, quota_renew_at
from public.profiles
where id = '$(Get-Env DEV_USER_ID)'::uuid;
"@ | Set-Clipboard
'✅ View-Quota SQL -> clipboard'
}

function Set-Plan([ValidateSet('free','basic','pro')]$plan='free') {
@"
update public.profiles
set plan = '$plan'
where id = '$(Get-Env DEV_USER_ID)'::uuid;
"@ | Set-Clipboard
"✅ Set-Plan ($plan) SQL -> clipboard"
}

function Seed-PlanLimits {
@"
insert into public.plan_limits(plan, monthly_quota, per_import_cost) values
('free',20,1),('basic',200,1),('pro',1000,1)
on conflict (plan) do update
set monthly_quota = excluded.monthly_quota,
    per_import_cost = excluded.per_import_cost;
"@ | Set-Clipboard
'✅ Seed plan_limits SQL -> clipboard'
}

function Show-PlanLimits {
@"
select * from public.plan_limits order by plan;
"@ | Set-Clipboard
'✅ Show plan_limits SQL -> clipboard'
}

function Jobs-Audit {
@"
select id, owner_id, kind, status, started_at, finished_at,
       result->'audit' as audit
from public.jobs
where kind = 'import'
order by created_at desc
limit 20;
"@ | Set-Clipboard
'✅ Jobs+Audit SQL -> clipboard'
}

# ---------- Smoke tests ----------
function Smoke-Import([int]$times=4, [int]$cost=1) {
  $base   = "http://127.0.0.1:3000"
  $secret = Get-Env IMPORT_SHARED_SECRET
  $owner  = Get-Env DEV_USER_ID
  1..$times | % {
    Start-Sleep -Milliseconds 120
    $payload = @{ owner_id = $owner; cost = $cost } | ConvertTo-Json -Compress
    try {
      $r = Invoke-WebRequest -Uri "$base/api/import" -Method POST `
           -Headers @{ "x-shared-secret"=$secret; "Content-Type"="application/json" } `
           -Body $payload
      "{0}: {1}" -f $_, [int]$r.StatusCode
    } catch {
      $resp = $_.Exception.Response
      if ($resp) { "{0}: {1}" -f $_, [int]$resp.StatusCode } else { "{0}: -1 {1}" -f $_, $_.Exception.Message }
    }
  }
}

function Smoke-ImportPretty([int]$times=4, [int]$cost=1) {
  $base   = "http://127.0.0.1:3000"
  $secret = Get-Env IMPORT_SHARED_SECRET
  $owner  = Get-Env DEV_USER_ID
  1..$times | % {
    Start-Sleep -Milliseconds 120
    $payload = @{ owner_id = $owner; cost = $cost } | ConvertTo-Json -Compress
    try {
      $r = Invoke-WebRequest -Uri "$base/api/import" -Method POST `
           -Headers @{ "x-shared-secret"=$secret; "Content-Type"="application/json" } `
           -Body $payload
      $b = $r.Content | ConvertFrom-Json
      $remaining = $null
      if ($b -and $b.PSObject.Properties.Match('remaining').Count -gt 0) { $remaining = $b.remaining }
      elseif ($b -and $b.PSObject.Properties.Match('result').Count -gt 0 -and $b.result `
        -and $b.result.PSObject.Properties.Match('audit').Count -gt 0 -and $b.result.audit `
        -and $b.result.audit.PSObject.Properties.Match('quota_after').Count -gt 0) {
        $remaining = $b.result.audit.quota_after
      }
      [pscustomobject]@{ i=$_; http=200; ok=$b.ok; remaining=$remaining; requestId=$b.requestId }
    } catch {
      $resp = $_.Exception.Response
      if ($resp) {
        $sr = New-Object IO.StreamReader($resp.GetResponseStream())
        $raw = $sr.ReadToEnd()
        try { $b = $raw | ConvertFrom-Json } catch { $b = $null }
        $remaining = $null
        if ($b -and $b.PSObject.Properties.Match('remaining').Count -gt 0) { $remaining = $b.remaining }
        [pscustomobject]@{ i=$_; http=[int]$resp.StatusCode; ok=$false; remaining=$remaining; requestId=($b.requestId) }
      } else {
        [pscustomobject]@{ i=$_; http=-1; ok=$false; remaining=$null; requestId=$null }
      }
    }
  } | Format-Table -AutoSize
}

# ---------- Patches ----------
function Patch-Audit {
  $api = "app/api/import/route.ts"
  if (!(Test-Path $api)) { return "❌ $api not found" }
  $c = Get-Content $api -Raw

  # Add audit to 402 responses (clamped to 0)
  $c = [regex]::Replace($c,
    'return\s+NextResponse\.json\(\s*\{\s*error:\s*"Out of credits",\s*remaining:\s*([^)]+)\}\s*,\s*\{\s*status:\s*402\s*\}\s*\);',
    'return NextResponse.json({ error: "Out of credits", remaining: Math.max(0, $1), audit: { cost, quota_before: Math.max(0, $1), quota_after: Math.max(0, $1) } }, { status: 402 });'
  )

  # Add audit to success result -> jobs.result
  $c = [regex]::Replace($c,
    'result:\s*\{\s*ok:\s*true,\s*requestId,\s*file_id\s*\}',
    'result: { ok: true, requestId, file_id, audit: { cost, quota_after: Math.max(0, quotaRes.remaining), quota_before: Math.max(0, quotaRes.remaining + cost) } }'
  )

  Set-Content -Encoding UTF8 $api $c
  "✅ Patched audit into $api (restart dev)"
}

# ---------- Simple in-memory rate limit (dev only) ----------
function RateLimit-Enable([int]$limit=10, [int]$windowSec=60) {
  $api = "app/api/import/route.ts"
  if (!(Test-Path $api)) { return "❌ $api not found" }
  $c = Get-Content $api -Raw

  if ($c -notmatch 'const\s+_rlBuckets') {
    $c = $c -replace 'export const runtime = "nodejs";',
'export const runtime = "nodejs";
const _rlBuckets: Map<string,{t:number,c:number}> = new Map();
function _rateLimit(owner: string, limit='+$limit+', windowSec='+$windowSec+') {
  const now = Date.now();
  const key = owner || "anon";
  const b = _rlBuckets.get(key) || { t: now, c: 0 };
  if (now - b.t > windowSec*1000) { b.t = now; b.c = 0; }
  b.c++; _rlBuckets.set(key, b);
  const remaining = Math.max(0, limit - b.c);
  return { allowed: b.c <= limit, remaining };
}
'
  }
  if ($c -notmatch 'Phase 4\.5: Rate limit') {
    $c = [regex]::Replace($c,
      '(let|const)\s+owner_id\s*=\s*[^;]+;',
      "`$0`r`n  // === Phase 4.5: Rate limit (dev/simple) ===`r`n  { const rl = _rateLimit(owner_id, $limit, $windowSec); if (!rl.allowed) { return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT', remaining: rl.remaining }, { status: 429 }); } }"
    )
  }
  Set-Content -Encoding UTF8 $api $c
  "✅ Enabled 429 rate limit ($limit calls / $windowSec s). Restart dev."
}

function RateLimit-Disable {
  $api = "app/api/import/route.ts"
  if (!(Test-Path $api)) { return "❌ $api not found" }
  $c = Get-Content $api -Raw
  # Remove RL check block
  $c = [regex]::Replace($c,
    '(\s*// === Phase 4\.5: Rate limit.*?429\ }\);\s*\}\s*\})','', 'Singleline'
  )
  # Remove bucket + helper if present
  $c = [regex]::Replace($c,
    'const\s+_rlBuckets[\s\S]*?return\s*\{\s*allowed:[\s\S]*?\}\s*\}\s*',''
  )
  Set-Content -Encoding UTF8 $api $c
  "✅ Disabled 429 rate limit. Restart dev."
}

# ---------- Quick checklist ----------
function Checklist-Quick {
  $ok1 = [string]::IsNullOrWhiteSpace((Get-Env NEXT_PUBLIC_SUPABASE_URL)) -eq $false
  $ok2 = [string]::IsNullOrWhiteSpace((Get-Env SUPABASE_SERVICE_ROLE_KEY)) -eq $false
  $ok3 = [string]::IsNullOrWhiteSpace((Get-Env IMPORT_SHARED_SECRET)) -eq $false
  $ok4 = [string]::IsNullOrWhiteSpace((Get-Env DEV_USER_ID)) -eq $false
  [pscustomobject]@{
    NEXT_PUBLIC_SUPABASE_URL = $ok1
    SUPABASE_SERVICE_ROLE_KEY = $ok2
    IMPORT_SHARED_SECRET = $ok3
    DEV_USER_ID = $ok4
  } | Format-Table -AutoSize
}
