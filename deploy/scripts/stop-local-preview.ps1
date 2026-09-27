$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$stateFile = Join-Path $repoRoot 'apps/platform/.data/local-preview/processes.json'
if (-not (Test-Path -LiteralPath $stateFile)) { throw 'No local preview process record found.' }

$state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($processId in @($state.platformListener, $state.websiteListener, $state.platform, $state.website) | Select-Object -Unique) {
  if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
    & taskkill.exe /PID $processId /T /F | Out-Null
  }
}
Remove-Item -LiteralPath $stateFile
Write-Host 'Local preview services stopped.'
