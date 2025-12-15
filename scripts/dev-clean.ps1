$ErrorActionPreference = "Continue"
taskkill /F /IM node.exe 2>$null | Out-Null
Remove-Item -Recurse -Force .\.next -ErrorAction SilentlyContinue
try { Set-StrictMode -Off } catch {}
npx --yes next dev -p 3000 -H 127.0.0.1
