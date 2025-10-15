# === patch_generate_button.ps1 ===
Write-Host "🔧 Tilføjer 'Nyt spørgsmål'-knap til ClientExam.tsx" -ForegroundColor Cyan

$File = "app\exam\ClientExam.tsx"

if (-not (Test-Path $File)) {
  Write-Host "❌ Kunne ikke finde $File – kør fra roden af projektet (notely-v2)" -ForegroundColor Red
  exit 1
}

# Læs fil
$code = Get-Content $File -Raw

# Tilføj onGenerate-funktionen før return()
if ($code -notmatch "async function onGenerate") {
  $code = $code -replace "(?ms)(const MIN_LEN.*?)\r?\n", '$1

  async function onGenerate() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground: false, count: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Kunne ikke generere spørgsmål");
      const q = (data?.question ?? "").toString();
      setQuestion(q);
      setToast("Nyt spørgsmål genereret");
      router.refresh();
      setTimeout(() => answerRef.current?.focus(), 50);
    } catch (e) {
      console.error("[generate-question]", e);
      setToast(e.message || "Fejl ved generering");
    } finally {
      setLoading(false);
    }
  }
'
  Write-Host "✅ Tilføjet onGenerate()-funktion" -ForegroundColor Green
}

# Tilføj knappen før </form>
if ($code -notmatch "onGenerate") {
  Write-Host "⚠️ onGenerate ikke fundet — springer knap-indsættelse over" -ForegroundColor Yellow
} elseif ($code -notmatch "Generér nyt spørgsmål") {
  $code = $code -replace '(?ms)(</form>)', @"
  <div className="pt-4">
    <button
      type="button"
      onClick={onGenerate}
      disabled={loading}
      className="rounded-xl border px-4 py-2 text-sm bg-black text-white hover:bg-neutral-800 disabled:opacity-60"
    >
      {loading ? "Henter…" : "Generér nyt spørgsmål"}
    </button>
  </div>
$1
"@
  Write-Host "✅ Tilføjet knap i formularen" -ForegroundColor Green
}

# Gem
Set-Content $File $code -Encoding utf8
Write-Host "💾 Gemt: $File" -ForegroundColor Cyan
Write-Host "Genstart dev-server: npm run dev" -ForegroundColor Yellow
