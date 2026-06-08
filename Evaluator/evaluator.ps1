param(
  [string]$SessionID
)

$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SessionsDir = Join-Path $WorkspaceRoot "polydb/telemetry/sessions"
$HistoryPath = Join-Path $PSScriptRoot "evaluator_history.json"
$EvaluationDir = Join-Path $WorkspaceRoot "PATBv5/polydb/evaluation/session_evaluations"
$DiagnosticsDir = Join-Path $WorkspaceRoot "PATBv5/polydb/evaluation/diagnostics"
$EvaluatorStatus = "passed"

function Read-EvaluatorHistory {
  param([string]$Path)

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

function Write-EvaluatorHistory {
  param(
    [string]$Path,
    [string]$SessionIdValue,
    [string]$Target,
    [string]$Status,
    [string]$OutputPath
  )

  $history = Read-EvaluatorHistory -Path $Path
  $entry = [PSCustomObject]@{
    sessionId  = $SessionIdValue
    checkedAt  = (Get-Date).ToString("o")
    target     = $Target
    status     = $Status
    outputPath = $OutputPath
  }

  $filtered = @($history | Where-Object { $_.sessionId -ne $SessionIdValue })
  $updated = @($entry) + $filtered
  $updated | ConvertTo-Json -Depth 4 | Set-Content -Path $Path -Encoding utf8
}

function Resolve-ExistingEvaluationOutput {
  param([string]$SessionIdValue)

  $evalPath = Join-Path $EvaluationDir "$SessionIdValue.json"
  if (Test-Path $evalPath) {
    return (Resolve-Path $evalPath).Path
  }

  $diagPath = Join-Path $DiagnosticsDir "$SessionIdValue.json"
  if (Test-Path $diagPath) {
    return (Resolve-Path $diagPath).Path
  }

  return $null
}

Write-Host "`nEVALUATOR:"
if (-not $SessionID) {
  $SessionID = Read-Host "Enter session ID"
}

$TelemetryArg = ""
$SessionArg = ""
$DisplayTarget = $SessionID
$ResolvedSessionId = $SessionID

if ($SessionID -and ($SessionID.ToLower().EndsWith(".jsonl") -or (Test-Path $SessionID))) {
  $ResolvedTelemetryPath = (Resolve-Path $SessionID).Path
  $TelemetryArg = "--telemetry-file `"$ResolvedTelemetryPath`""
  $DisplayTarget = $ResolvedTelemetryPath
  $match = [regex]::Match([System.IO.Path]::GetFileName($ResolvedTelemetryPath), "__([0-9a-fA-F-]{36})\.jsonl$")
  if ($match.Success) {
    $ResolvedSessionId = $match.Groups[1].Value
  }
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

$cmd = "npm run evaluate:session -- $SessionArg $TelemetryArg"

Write-Host "`nRunning command:"
Write-Host "Target: $DisplayTarget"
Write-Host $cmd
Write-Host ""

try {
  Invoke-Expression $cmd
} catch {
  $EvaluatorStatus = "failed"
  throw
} finally {
  $OutputPath = Resolve-ExistingEvaluationOutput -SessionIdValue $ResolvedSessionId
  Write-EvaluatorHistory `
    -Path $HistoryPath `
    -SessionIdValue $ResolvedSessionId `
    -Target $DisplayTarget `
    -Status $EvaluatorStatus `
    -OutputPath $OutputPath
}
