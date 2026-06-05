# run_batch_checker.ps1
# Batch execution of checker_old.ps1 for every session ID listed in sessions.txt
#
# Usage (from project root or scripts folder):
#   .\run_batch_checker.ps1
#   .\run_batch_checker.ps1 -SessionsFile "path\to\sessions.txt"
#   .\run_batch_checker.ps1 -StopOnError
#
# Full checker output (all 4 commands) is captured and appended to
# batch_checker_results.log alongside the per-session pass/fail summary.

param(
  [string]$SessionsFile = (Join-Path $PSScriptRoot "sessions.txt"),
  [switch]$StopOnError,
  [switch]$IncludeAlreadyAnalyzed
)

$CheckerScript = Join-Path $PSScriptRoot "checker.ps1"
$LogFile       = Join-Path $PSScriptRoot "batch_checker_results.log"
$CheckerHistoryFile = Join-Path $PSScriptRoot "checker_history.json"

# --- Guards ---
if (-not (Test-Path $CheckerScript)) {
  Write-Error "checker_old.ps1 not found at: $CheckerScript"
  exit 1
}

if (-not (Test-Path $SessionsFile)) {
  Write-Error "sessions.txt not found at: $SessionsFile"
  exit 1
}

$Sessions = Get-Content $SessionsFile | Where-Object { $_.Trim() -ne "" }

if ($Sessions.Count -eq 0) {
  Write-Error "sessions.txt is empty."
  exit 1
}

$AnalyzedSessionIds = @{}
if ((-not $IncludeAlreadyAnalyzed) -and (Test-Path $CheckerHistoryFile)) {
  try {
    $History = Get-Content $CheckerHistoryFile -Raw | ConvertFrom-Json
    foreach ($Entry in @($History)) {
      if ($Entry.sessionId) {
        $AnalyzedSessionIds[[string]$Entry.sessionId] = $true
      }
    }
  } catch {
    Write-Warning "Could not parse checker_history.json. Continuing without skip cache."
  }
}

$Skipped = 0

# --- Batch loop ---
$Total   = $Sessions.Count
$Passed  = 0
$Failed  = 0
$Results = @()

$StartTime = Get-Date
"=== Batch run started: $StartTime ===" | Tee-Object -FilePath $LogFile

Write-Host ""
Write-Host "=== BATCH CHECKER: $Total sessions ===" -ForegroundColor Cyan
Write-Host "Log file: $LogFile"
Write-Host ""

$Index = 0
foreach ($SessionID in $Sessions) {
  $Index++
  $SessionID = $SessionID.Trim()

  if ((-not $IncludeAlreadyAnalyzed) -and $AnalyzedSessionIds.ContainsKey($SessionID)) {
    $Skipped++
    Write-Host "---------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "[$Index/$Total] Session: $SessionID" -ForegroundColor Yellow
    Write-Host "[SKIP] Already analyzed according to checker_history.json" -ForegroundColor DarkYellow
    Write-Host ""

    $Results += [PSCustomObject]@{
      Index     = $Index
      SessionID = $SessionID
      Status    = "SKIP"
      Elapsed   = 0
    }

    "" | Add-Content -Path $LogFile
    "---------------------------------------------------------" | Add-Content -Path $LogFile
    "[$Index/$Total] Session: $SessionID" | Add-Content -Path $LogFile
    "---------------------------------------------------------" | Add-Content -Path $LogFile
    "$([datetime]::Now.ToString('HH:mm:ss'))  [$Index/$Total]  SKIP  (0s)  $SessionID" |
      Add-Content -Path $LogFile

    continue
  }

  Write-Host "---------------------------------------------------------" -ForegroundColor DarkGray
  Write-Host "[$Index/$Total] Session: $SessionID" -ForegroundColor Yellow
  Write-Host ""

  $SessionStart = Get-Date

  # Capture all output streams (stdout + stderr) while still printing to console
  $CheckerOutput = & pwsh -NoProfile -File $CheckerScript -SessionID $SessionID *>&1
  $ExitCode = $LASTEXITCODE

  # Print captured output to console
  $CheckerOutput | ForEach-Object { Write-Host $_ }

  $Elapsed = [math]::Round(((Get-Date) - $SessionStart).TotalSeconds, 1)

  if ($ExitCode -eq 0) {
    $Status = "PASS"
    $Passed++
    Write-Host "[$Index/$Total] PASS  (${Elapsed}s)" -ForegroundColor Green
  } else {
    $Status = "FAIL (exit $ExitCode)"
    $Failed++
    Write-Host "[$Index/$Total] FAIL  exit=$ExitCode  (${Elapsed}s)" -ForegroundColor Red
  }

  $Results += [PSCustomObject]@{
    Index     = $Index
    SessionID = $SessionID
    Status    = $Status
    Elapsed   = $Elapsed
  }

  # Append session header + full checker output + result line to log
  "" | Add-Content -Path $LogFile
  "---------------------------------------------------------" | Add-Content -Path $LogFile
  "[$Index/$Total] Session: $SessionID" | Add-Content -Path $LogFile
  "---------------------------------------------------------" | Add-Content -Path $LogFile
  $CheckerOutput | ForEach-Object { $_ | Add-Content -Path $LogFile }
  "$([datetime]::Now.ToString('HH:mm:ss'))  [$Index/$Total]  $Status  (${Elapsed}s)  $SessionID" |
    Add-Content -Path $LogFile

  if ($StopOnError -and $ExitCode -ne 0) {
    Write-Host ""
    Write-Warning "-StopOnError set - aborting batch after first failure."
    break
  }

  Write-Host ""
}

# --- Summary ---
$TotalElapsed = [math]::Round(((Get-Date) - $StartTime).TotalSeconds, 1)

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "BATCH COMPLETE" -ForegroundColor Cyan
Write-Host "  Sessions : $Total"
Write-Host "  Passed   : $Passed" -ForegroundColor Green
Write-Host "  Skipped  : $Skipped" -ForegroundColor DarkYellow

if ($Failed -gt 0) {
  Write-Host "  Failed   : $Failed (see log for details)" -ForegroundColor Red
} else {
  Write-Host "  Failed   : 0" -ForegroundColor Green
}

Write-Host "  Total time: ${TotalElapsed}s"
Write-Host ""

"" | Add-Content $LogFile
"=========================================================" | Add-Content $LogFile
"=== SUMMARY ===" | Add-Content $LogFile
"=========================================================" | Add-Content $LogFile
$Results | Format-Table -AutoSize | Out-String | Add-Content $LogFile
"Total: $Total  Passed: $Passed  Failed: $Failed  Skipped: $Skipped  Elapsed: ${TotalElapsed}s" | Add-Content $LogFile
"=== Batch run ended: $(Get-Date) ===" | Add-Content $LogFile

exit $Failed
