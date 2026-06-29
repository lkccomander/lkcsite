# run-batch-append.ps1
# Append-only batch execution of checker.ps1 for every session ID listed in a sessions file.
#
# Usage:
#   .\run-batch-append.ps1
#   .\run-batch-append.ps1 -SessionsFile ".\sessions_fresh_comparable.txt"
#   .\run-batch-append.ps1 -LogFile ".\batch_checker_confirm.log"
#   .\run-batch-append.ps1 -StopOnError
#   .\run-batch-append.ps1 -RecheckLoggedSessions
#
# This script never rewrites the batch log. It appends a new run block and,
# by default, only processes session IDs that are not already recorded in the log.

param(
  [string]$SessionsFile = (Join-Path $PSScriptRoot "sessions.txt"),
  [string]$LogFile = (Join-Path $PSScriptRoot "batch_checker_confirm.log"),
  [switch]$StopOnError,
  [switch]$RecheckLoggedSessions
)

$CheckerScript = Join-Path $PSScriptRoot "checker.ps1"

function Get-LoggedSessionIds {
  param(
    [string]$Path
  )

  $sessionIds = @{}
  if (-not (Test-Path $Path)) {
    return $sessionIds
  }

  foreach ($line in Get-Content -Path $Path) {
    if ($line -match '^\d{2}:\d{2}:\d{2}\s+\[\d+/\d+\]\s+(PASS|FAIL(?:\s+\(.+?\))?|SKIP)\s+\([^)]+\)\s+([0-9a-f-]{36})$') {
      $sessionIds[$matches[2]] = $true
    }
  }

  return $sessionIds
}

if (-not (Test-Path $CheckerScript)) {
  Write-Error "checker.ps1 not found at: $CheckerScript"
  exit 1
}

if (-not (Test-Path $SessionsFile)) {
  Write-Error "sessions file not found at: $SessionsFile"
  exit 1
}

$RequestedSessions = Get-Content $SessionsFile | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $_.Trim() }
if ($RequestedSessions.Count -eq 0) {
  Write-Error "sessions file is empty: $SessionsFile"
  exit 1
}

$LoggedSessionIds = @{}
if (-not $RecheckLoggedSessions) {
  $LoggedSessionIds = Get-LoggedSessionIds -Path $LogFile
}

$Sessions = @()
foreach ($sessionId in $RequestedSessions) {
  if ($RecheckLoggedSessions -or (-not $LoggedSessionIds.ContainsKey($sessionId))) {
    $Sessions += $sessionId
  }
}

$AlreadyLogged = $RequestedSessions.Count - $Sessions.Count
$Total = $Sessions.Count
$Passed = 0
$Failed = 0
$Skipped = 0
$Results = @()
$StartTime = Get-Date

Add-Content -Path $LogFile -Value ""
Add-Content -Path $LogFile -Value "=== Append batch run started: $StartTime ==="
Add-Content -Path $LogFile -Value "Sessions file: $SessionsFile"
Add-Content -Path $LogFile -Value "Recheck logged sessions: $RecheckLoggedSessions"
Add-Content -Path $LogFile -Value "Already logged before this run: $AlreadyLogged"

Write-Host ""
Write-Host "=== APPEND BATCH CHECKER ===" -ForegroundColor Cyan
Write-Host "Requested sessions : $($RequestedSessions.Count)"
Write-Host "Already in log     : $AlreadyLogged" -ForegroundColor DarkYellow
Write-Host "To process now     : $Total" -ForegroundColor Green
Write-Host "Log file           : $LogFile"
Write-Host ""

if ($Total -eq 0) {
  Write-Host "No new sessions to process." -ForegroundColor Yellow
  Add-Content -Path $LogFile -Value "No new sessions to process."
  Add-Content -Path $LogFile -Value "=== Append batch run ended: $(Get-Date) ==="
  exit 0
}

$Index = 0
foreach ($SessionID in $Sessions) {
  $Index++

  Write-Host "---------------------------------------------------------" -ForegroundColor DarkGray
  Write-Host "[$Index/$Total] Session: $SessionID" -ForegroundColor Yellow
  Write-Host ""

  $SessionStart = Get-Date
  $CheckerOutput = & pwsh -NoProfile -File $CheckerScript -SessionID $SessionID *>&1
  $ExitCode = $LASTEXITCODE
  $ReadinessVerdict = $null

  foreach ($Line in @($CheckerOutput)) {
    if ("$Line" -match 'LIVE readiness verdict:\s+(.+)$') {
      $ReadinessVerdict = $matches[1].Trim()
    }
  }

  $CheckerOutput | ForEach-Object { Write-Host $_ }

  $Elapsed = [math]::Round(((Get-Date) - $SessionStart).TotalSeconds, 1)
  $BatchFailed = ($ExitCode -ne 0) -or ($null -ne $ReadinessVerdict -and $ReadinessVerdict -ne "READY")

  if (-not $BatchFailed) {
    $Status = "PASS"
    $Passed++
    Write-Host "[$Index/$Total] PASS  (${Elapsed}s)" -ForegroundColor Green
  } else {
    if ($ExitCode -ne 0 -and $null -ne $ReadinessVerdict -and $ReadinessVerdict -ne "READY") {
      $Status = "FAIL (exit $ExitCode, $ReadinessVerdict)"
    } elseif ($ExitCode -ne 0) {
      $Status = "FAIL (exit $ExitCode)"
    } elseif ($null -ne $ReadinessVerdict) {
      $Status = "FAIL ($ReadinessVerdict)"
    } else {
      $Status = "FAIL"
    }
    $Failed++

    if ($ExitCode -ne 0) {
      Write-Host "[$Index/$Total] FAIL  exit=$ExitCode  (${Elapsed}s)" -ForegroundColor Red
    } elseif ($null -ne $ReadinessVerdict) {
      Write-Host "[$Index/$Total] FAIL  verdict=$ReadinessVerdict  (${Elapsed}s)" -ForegroundColor Red
    } else {
      Write-Host "[$Index/$Total] FAIL  (${Elapsed}s)" -ForegroundColor Red
    }
  }

  $Results += [PSCustomObject]@{
    Index     = $Index
    SessionID = $SessionID
    Status    = $Status
    Elapsed   = $Elapsed
  }

  Add-Content -Path $LogFile -Value ""
  Add-Content -Path $LogFile -Value "---------------------------------------------------------"
  Add-Content -Path $LogFile -Value "[$Index/$Total] Session: $SessionID"
  Add-Content -Path $LogFile -Value "---------------------------------------------------------"
  $CheckerOutput | ForEach-Object { $_ | Add-Content -Path $LogFile }
  Add-Content -Path $LogFile -Value "$([datetime]::Now.ToString('HH:mm:ss'))  [$Index/$Total]  $Status  (${Elapsed}s)  $SessionID"

  if ($StopOnError -and $BatchFailed) {
    Write-Host ""
    Write-Warning "-StopOnError set - aborting batch after first failure."
    break
  }

  Write-Host ""
}

$TotalElapsed = [math]::Round(((Get-Date) - $StartTime).TotalSeconds, 1)

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "APPEND BATCH COMPLETE" -ForegroundColor Cyan
Write-Host "  Requested : $($RequestedSessions.Count)"
Write-Host "  Logged    : $AlreadyLogged" -ForegroundColor DarkYellow
Write-Host "  Processed : $Total"
Write-Host "  Passed    : $Passed" -ForegroundColor Green

if ($Failed -gt 0) {
  Write-Host "  Failed    : $Failed (see log for details)" -ForegroundColor Red
} else {
  Write-Host "  Failed    : 0" -ForegroundColor Green
}

Write-Host "  Total time: ${TotalElapsed}s"
Write-Host ""

Add-Content -Path $LogFile -Value ""
Add-Content -Path $LogFile -Value "========================================================="
Add-Content -Path $LogFile -Value "=== SUMMARY ==="
Add-Content -Path $LogFile -Value "========================================================="
$Results | Format-Table -AutoSize | Out-String | Add-Content -Path $LogFile
Add-Content -Path $LogFile -Value "Requested: $($RequestedSessions.Count)  LoggedBeforeRun: $AlreadyLogged  Processed: $Total  Passed: $Passed  Failed: $Failed  Elapsed: ${TotalElapsed}s"
Add-Content -Path $LogFile -Value "=== Append batch run ended: $(Get-Date) ==="

exit $Failed
