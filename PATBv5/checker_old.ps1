param(
  [string]$SessionID
)

$SessionsDir = Join-Path $PSScriptRoot "..\polydb\telemetry\sessions"

# Ask for session ID when not provided
Write-Host "`nBOT CHECKER:"
if (-not $SessionID) {
  $SessionID = Read-Host "Enter session ID"
}

$TelemetryArg = ""
$SessionArg = ""
$DisplayTarget = $SessionID

if ($SessionID -and ($SessionID.ToLower().EndsWith(".jsonl") -or (Test-Path $SessionID))) {
  $ResolvedTelemetryPath = (Resolve-Path $SessionID).Path
  $TelemetryArg = "--telemetry-file `"$ResolvedTelemetryPath`""
  $DisplayTarget = $ResolvedTelemetryPath
} else {
  $ResolvedSessionFile = $null
  if ($SessionID -and (Test-Path $SessionsDir)) {
    $ResolvedSessionFile = Get-ChildItem -Path $SessionsDir -Filter "*__$SessionID.jsonl" -File -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      Select-Object -First 1
  }

  if ($ResolvedSessionFile) {
    $TelemetryArg = "--telemetry-file `"$($ResolvedSessionFile.FullName)`""
    $SessionArg = "--session-id $SessionID"
    $DisplayTarget = $ResolvedSessionFile.FullName
  } else {
    $SessionArg = "--session-id $SessionID"
  }
}

# Build commands
$cmd0 = "npx tsx tests/entry_ratio.test.ts"
$cmd1 = "npm run validate:signals -- --bot-id polymarket-bot-v5 $SessionArg $TelemetryArg"
$cmd2 = "npm run analyze:trades -- --bot-id polymarket-bot-v5 $SessionArg $TelemetryArg"
$cmd3 = "npm run check:live-readiness -- --bot-id polymarket-bot-v5 $SessionArg $TelemetryArg"

# Show commands
Write-Host "`nRunning commands:"
Write-Host "Target: $DisplayTarget"
Write-Host $cmd0
Write-Host $cmd1
Write-Host $cmd2
Write-Host $cmd3
Write-Host ""

# Execute commands
Invoke-Expression $cmd0
Invoke-Expression $cmd1
Invoke-Expression $cmd2
Invoke-Expression $cmd3
