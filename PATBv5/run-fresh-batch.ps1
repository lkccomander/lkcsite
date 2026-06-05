param(
  [string]$Since = "2026-06-05",
  [ValidateSet("PAPER", "LIVE", "ANY")]
  [string]$Mode = "PAPER",
  [string]$Strategy = "trade_5x",
  [switch]$IncludeAlreadyAnalyzed,
  [switch]$StopOnError
)

$ProjectRoot = $PSScriptRoot
$CohortFile = Join-Path $ProjectRoot "sessions_fresh_comparable.txt"
$BuildCmd = @(
  "npm", "run", "cohort:fresh", "--",
  "--since", $Since,
  "--mode", $Mode,
  "--strategy", $Strategy
)

Write-Host ""
Write-Host "=== BUILD FRESH COHORT ===" -ForegroundColor Cyan
Write-Host ($BuildCmd -join " ")
Write-Host ""

& $BuildCmd[0] $BuildCmd[1] $BuildCmd[2] $BuildCmd[3] $BuildCmd[4] $BuildCmd[5] $BuildCmd[6] $BuildCmd[7] $BuildCmd[8] $BuildCmd[9]
if ($LASTEXITCODE -ne 0) {
  Write-Error "Fresh cohort build failed."
  exit $LASTEXITCODE
}

if (-not (Test-Path $CohortFile)) {
  Write-Error "Fresh cohort file not found: $CohortFile"
  exit 1
}

$sessions = Get-Content $CohortFile | Where-Object { $_.Trim() -ne "" }
Write-Host ""
Write-Host "Fresh comparable sessions: $($sessions.Count)" -ForegroundColor Green
Write-Host "Sessions file: $CohortFile"
Write-Host ""

$RunBatchArgs = @(
  "-NoProfile",
  "-File", (Join-Path $ProjectRoot "run-batch.ps1"),
  "-SessionsFile", $CohortFile
)

if ($IncludeAlreadyAnalyzed) {
  $RunBatchArgs += "-IncludeAlreadyAnalyzed"
}

if ($StopOnError) {
  $RunBatchArgs += "-StopOnError"
}

& pwsh @RunBatchArgs
exit $LASTEXITCODE
