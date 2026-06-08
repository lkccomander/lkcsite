param(
  [string]$SessionsFile = (Join-Path (Join-Path $PSScriptRoot "..\PATBv5") "sessions.txt"),
  [switch]$StopOnError,
  [switch]$IncludeAlreadyAnalyzed
)

$EvaluatorScript = Join-Path $PSScriptRoot "evaluator.ps1"
$LogFile = Join-Path $PSScriptRoot "batch_evaluator_results.log"
$HistoryFile = Join-Path $PSScriptRoot "evaluator_history.json"

if (-not (Test-Path $EvaluatorScript)) {
  Write-Error "evaluator.ps1 not found at: $EvaluatorScript"
  exit 1
}

if (-not (Test-Path $SessionsFile)) {
  Write-Error "sessions file not found at: $SessionsFile"
  exit 1
}

$Sessions = Get-Content $SessionsFile | Where-Object { $_.Trim() -ne "" }
if ($Sessions.Count -eq 0) {
  Write-Error "Sessions file is empty."
  exit 1
}

$AnalyzedSessionIds = @{}
if ((-not $IncludeAlreadyAnalyzed) -and (Test-Path $HistoryFile)) {
  try {
    $History = Get-Content $HistoryFile -Raw | ConvertFrom-Json
    foreach ($Entry in @($History)) {
      if ($Entry.sessionId) {
        $AnalyzedSessionIds[[string]$Entry.sessionId] = $true
      }
    }
  } catch {
    Write-Warning "Could not parse evaluator_history.json. Continuing without skip cache."
  }
}

$Skipped = 0
$Total = $Sessions.Count
$Passed = 0
$Failed = 0
$Results = @()

$StartTime = Get-Date
"=== Evaluator batch started: $StartTime ===" | Tee-Object -FilePath $LogFile

Write-Host ""
Write-Host "=== EVALUATOR BATCH: $Total sessions ===" -ForegroundColor Cyan
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
    Write-Host "[SKIP] Already evaluated according to evaluator_history.json" -ForegroundColor DarkYellow
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
    "$([datetime]::Now.ToString('HH:mm:ss'))  [$Index/$Total]  SKIP  (0s)  $SessionID" | Add-Content -Path $LogFile
    continue
  }

  Write-Host "---------------------------------------------------------" -ForegroundColor DarkGray
  Write-Host "[$Index/$Total] Session: $SessionID" -ForegroundColor Yellow
  Write-Host ""

  $SessionStart = Get-Date
  $EvaluatorOutput = & pwsh -NoProfile -File $EvaluatorScript -SessionID $SessionID *>&1
  $ExitCode = $LASTEXITCODE

  $EvaluatorOutput | ForEach-Object { Write-Host $_ }

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

  "" | Add-Content -Path $LogFile
  "---------------------------------------------------------" | Add-Content -Path $LogFile
  "[$Index/$Total] Session: $SessionID" | Add-Content -Path $LogFile
  "---------------------------------------------------------" | Add-Content -Path $LogFile
  $EvaluatorOutput | ForEach-Object { $_ | Add-Content -Path $LogFile }
  "$([datetime]::Now.ToString('HH:mm:ss'))  [$Index/$Total]  $Status  (${Elapsed}s)  $SessionID" | Add-Content -Path $LogFile

  if ($StopOnError -and $ExitCode -ne 0) {
    Write-Host ""
    Write-Warning "-StopOnError set - aborting batch after first failure."
    break
  }

  Write-Host ""
}

$TotalElapsed = [math]::Round(((Get-Date) - $StartTime).TotalSeconds, 1)

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "EVALUATOR BATCH COMPLETE" -ForegroundColor Cyan
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
"=== Evaluator batch ended: $(Get-Date) ===" | Add-Content $LogFile

exit $Failed
