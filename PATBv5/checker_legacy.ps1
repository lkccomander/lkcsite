param(
  [string]$SessionID
)

$SessionsDir = Join-Path $PSScriptRoot "..\polydb\telemetry\sessions"
$CheckerHistoryPath = Join-Path $PSScriptRoot "checker_history.json"
$CheckerStatus = "passed"
$CheckerExitCode = 0
$DefaultBotId = "polymarket-bot-v5"

function Read-CheckerHistory {
  param(
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return @()
  }

  try {
    $raw = Get-Content -Path $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return @()
    }

    $parsed = $raw | ConvertFrom-Json
    if ($parsed -is [System.Array]) {
      return @($parsed)
    }
    if ($null -ne $parsed) {
      return @($parsed)
    }
  } catch {
  }

  return @()
}

function Write-CheckerHistory {
  param(
    [string]$Path,
    [string]$SessionIdValue,
    [string]$Target,
    [string]$Status
  )

  $history = Read-CheckerHistory -Path $Path
  $entry = [PSCustomObject]@{
    sessionId  = $SessionIdValue
    checkedAt  = (Get-Date).ToString("o")
    target     = $Target
    status     = $Status
  }

  $filtered = @($history | Where-Object { $_.sessionId -ne $SessionIdValue })
  $updated = @($entry) + $filtered
  $updated | ConvertTo-Json -Depth 4 | Set-Content -Path $Path -Encoding utf8
}

function Resolve-CheckerBotId {
  param(
    [string]$TelemetryPath,
    [string]$FallbackBotId
  )

  if (-not $TelemetryPath -or -not (Test-Path $TelemetryPath)) {
    return $FallbackBotId
  }

  $reader = $null
  try {
    $reader = [System.IO.File]::OpenText($TelemetryPath)
    for ($lineNumber = 0; $lineNumber -lt 200 -and -not $reader.EndOfStream; $lineNumber++) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line)) {
        continue
      }

      try {
        $event = $line | ConvertFrom-Json
        if ($event.botId -and -not [string]::IsNullOrWhiteSpace([string]$event.botId)) {
          return [string]$event.botId
        }
      } catch {
      }
    }
  } catch {
  } finally {
    if ($reader) {
      $reader.Dispose()
    }
  }

  return $FallbackBotId
}

# Ask for session ID when not provided
Write-Host "`nBOT CHECKER:"
if (-not $SessionID) {
  $SessionID = Read-Host "Enter session ID"
}

$TelemetryArg = ""
$SessionArg = ""
$DisplayTarget = $SessionID
$ResolvedTelemetryPath = $null

if ($SessionID -and ($SessionID.ToLower().EndsWith(".jsonl") -or (Test-Path $SessionID))) {
  $ResolvedTelemetryPath = (Resolve-Path $SessionID).ProviderPath
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
    $ResolvedTelemetryPath = $ResolvedSessionFile.FullName
    $TelemetryArg = "--telemetry-file `"$($ResolvedSessionFile.FullName)`""
    $SessionArg = "--session-id $SessionID"
    $DisplayTarget = $ResolvedSessionFile.FullName
  } else {
    $SessionArg = "--session-id $SessionID"
  }
}

$DetectedBotId = Resolve-CheckerBotId -TelemetryPath $ResolvedTelemetryPath -FallbackBotId $DefaultBotId

# Build commands
$cmd0 = "npx tsx tests/entry_ratio.test.ts"
$cmd1 = "npm run validate:signals -- --bot-id $DetectedBotId $SessionArg $TelemetryArg"
$cmd2 = "npm run analyze:trades -- --bot-id $DetectedBotId $SessionArg $TelemetryArg"
$cmd3 = "npm run check:live-readiness -- --bot-id $DetectedBotId $SessionArg $TelemetryArg"

# Show commands
Write-Host "`nRunning commands:"
Write-Host "Target: $DisplayTarget"
Write-Host "Bot ID: $DetectedBotId"
Write-Host $cmd0
Write-Host $cmd1
Write-Host $cmd2
Write-Host $cmd3
Write-Host ""

function Invoke-CheckerCommand {
  param(
    [string]$Command
  )

  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command"
  }
}

try {
  # Execute commands and preserve failing exit codes from npm/tsx.
  Invoke-CheckerCommand $cmd0
  Invoke-CheckerCommand $cmd1
  Invoke-CheckerCommand $cmd2
  Invoke-CheckerCommand $cmd3
} catch {
  $CheckerStatus = "failed"
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    $CheckerExitCode = $LASTEXITCODE
  } else {
    $CheckerExitCode = 1
  }
  Write-Error $_
} finally {
  Write-CheckerHistory `
    -Path $CheckerHistoryPath `
    -SessionIdValue $SessionID `
    -Target $DisplayTarget `
    -Status $CheckerStatus
}

exit $CheckerExitCode
