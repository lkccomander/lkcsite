<#
.SYNOPSIS
    Launches PATBv5 and persists one complete post-run strategy performance row.

.DESCRIPTION
    Builds and runs the bot, derives the exact PAPER or LIVE session summary
    from its JSONL telemetry, then upserts the completed session into the local
    rabbitHat PostgreSQL database. Review and optional Samba upload run only
    after database persistence and cannot corrupt the stored session row.
#>

$ErrorActionPreference = "Stop"

# --- Paths and constants -----------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$SessionsDirectory = Join-Path $RepoRoot "polydb\telemetry\sessions"
$RuntimeEnvPath = Join-Path $ScriptDir ".env"
$RuntimeEnvScript = Join-Path $ScriptDir "scripts\runtime_env.ps1"
$PostgresEnvPath = Join-Path $RepoRoot "polydb\postgres\.env"
$BotId = "polymarket-bot-v5"
$StrategyId = "16041373-deb2-4183-9dda-5d5ff6dc5fff"
Set-Location $ScriptDir

# --- Helpers -----------------------------------------------------------------
. $RuntimeEnvScript
Import-DotEnv -Path $RuntimeEnvPath -OverrideNames @("PAPER_TRADING") -RequiredNames @("PAPER_TRADING")
Import-DotEnv -Path $PostgresEnvPath
$TradingMode = Resolve-TradingMode -Value $env:PAPER_TRADING -SourcePath $RuntimeEnvPath

$PgHost = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { "localhost" }
$PgPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { "5432" }
$PgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "rabbithat" }
$PgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }

$PsqlPath = $env:POSTGRES_PSQL_PATH
if (-not $PsqlPath) {
    $psqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($psqlCommand) {
        $PsqlPath = $psqlCommand.Source
    }
    else {
        $candidate = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
        if (Test-Path -LiteralPath $candidate) {
            $PsqlPath = $candidate
        }
        else {
            throw "psql.exe not found. Set POSTGRES_PSQL_PATH or add PostgreSQL\bin to PATH."
        }
    }
}

function Invoke-PsqlScalar {
    param([Parameter(Mandatory = $true)][string]$Sql)

    $previousPgPassword = $env:PGPASSWORD
    if ($env:POSTGRES_PASSWORD) {
        $env:PGPASSWORD = $env:POSTGRES_PASSWORD
    }
    try {
        $result = & $PsqlPath -w -X -h $PgHost -p $PgPort -U $PgUser -d $PgDb -v ON_ERROR_STOP=1 -t -A -c $Sql 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "psql failed with exit code $LASTEXITCODE."
        }
        $value = $result | Where-Object { $_ -is [string] -and -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
        if ($value) {
            return $value.Trim()
        }
        return $null
    }
    finally {
        if ($null -ne $previousPgPassword) {
            $env:PGPASSWORD = $previousPgPassword
        }
        else {
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        }
    }
}

function ConvertTo-SqlDecimal {
    param([Parameter(Mandatory = $true)]$Value)

    $number = [decimal]$Value
    if ($number -lt 0) { throw "Balance cannot be negative." }
    return $number.ToString("0.############################", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Assert-CompleteSessionSummary {
    param([Parameter(Mandatory = $true)]$Summary)

    if (-not $Summary.complete) { throw "Session summary is incomplete." }
    $parsedSessionId = [guid]::Empty
    if (-not [guid]::TryParse([string]$Summary.sessionId, [ref]$parsedSessionId)) {
        throw "Invalid session UUID."
    }
    if ([string]$Summary.sessionType -notin @("PAPER_TESTING", "LIVE_TRADING")) {
        throw "Invalid session type."
    }
    [void](ConvertTo-SqlDecimal $Summary.initialBalance)
    [void](ConvertTo-SqlDecimal $Summary.finalBalance)

    $startedAt = [datetimeoffset]::MinValue
    $finishedAt = [datetimeoffset]::MinValue
    if (-not [datetimeoffset]::TryParse([string]$Summary.startedAt, [ref]$startedAt)) {
        throw "Invalid session start timestamp."
    }
    if (-not [datetimeoffset]::TryParse([string]$Summary.finishedAt, [ref]$finishedAt)) {
        throw "Invalid session finish timestamp."
    }
    if ($finishedAt -lt $startedAt) { throw "Session finish timestamp precedes its start." }
    if (-not (Test-Path -LiteralPath ([string]$Summary.sessionFile) -PathType Leaf)) {
        throw "Session telemetry file does not exist."
    }
}

function Save-StrategyPerformance {
    param([Parameter(Mandatory = $true)]$Summary)

    Assert-CompleteSessionSummary $Summary
    $initialBalance = ConvertTo-SqlDecimal $Summary.initialBalance
    $finalBalance = ConvertTo-SqlDecimal $Summary.finalBalance
    $sessionId = [string]$Summary.sessionId
    $sessionType = [string]$Summary.sessionType
    $startedAt = ([datetimeoffset]$Summary.startedAt).ToUniversalTime().ToString("o")
    $finishedAt = ([datetimeoffset]$Summary.finishedAt).ToUniversalTime().ToString("o")

    $sql = @"
INSERT INTO public.strategy_performance
    (strategy_id, initial_balance, final_balance, session_id, session_type, strat_timestamp, finish_timestamp)
VALUES
    ('$StrategyId'::uuid, $initialBalance, $finalBalance, '$sessionId', '$sessionType',
     '$startedAt'::timestamptz, '$finishedAt'::timestamptz)
ON CONFLICT (session_id) WHERE session_id IS NOT NULL
DO UPDATE SET
    strategy_id = EXCLUDED.strategy_id,
    initial_balance = EXCLUDED.initial_balance,
    final_balance = EXCLUDED.final_balance,
    session_type = EXCLUDED.session_type,
    strat_timestamp = EXCLUDED.strat_timestamp,
    finish_timestamp = EXCLUDED.finish_timestamp
RETURNING id;
"@
    $rowId = Invoke-PsqlScalar -Sql $sql
    if (-not $rowId) { throw "strategy_performance upsert returned no id." }
    return $rowId
}

# --- Header ------------------------------------------------------------------
Write-Host "Trading mode: $TradingMode (source=$RuntimeEnvPath)"
Write-Host "Starting PATBv5 CLI bot with post-run persistence and review..."
Write-Host "Repo: $ScriptDir"
Write-Host "Bot ID: $BotId"
Write-Host ""

# --- UI choice ---------------------------------------------------------------
$LaunchedUi = $false
$choice = Read-Host "Enable embedded live-data UI for this bot run? [Y/N]"
if ($choice -match "^[Yy]") {
    $LaunchedUi = $true
    Write-Host "Building newGui assets for the embedded UI..."
    & npm run ui:build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "UI build failed with code $LASTEXITCODE."
        Read-Host "Press Enter to exit"
        exit $LASTEXITCODE
    }
    $env:UI_SERVER_ENABLED = "1"
    $env:UI_OPEN_BROWSER = "1"
}

# --- Build -------------------------------------------------------------------
Write-Host "Building PATBv5..."
& npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed with code $LASTEXITCODE."
    Read-Host "Press Enter to exit"
    exit $LASTEXITCODE
}

# --- Run and finalize --------------------------------------------------------
$RunStartedAfterUtc = [datetime]::UtcNow
$BotExitCode = 1
$PersistenceSucceeded = $false
$SessionSummary = $null

Write-Host "Build succeeded. Starting bot..."
if ($LaunchedUi) { Write-Host "Embedded UI enabled for this run." }
Write-Host "Running: npm start"
Write-Host ""

try {
    & npm start
    $BotExitCode = $LASTEXITCODE
}
finally {
    try {
        Write-Host "Finalizing the session from telemetry..."
        $summaryJson = & powershell -NoProfile -File (Join-Path $ScriptDir "scripts\get_session_summary.ps1") `
            -SessionsDirectory $SessionsDirectory `
            -BotId $BotId `
            -StartedAfterUtc $RunStartedAfterUtc.ToString("o") `
            -OriginHost $env:COMPUTERNAME
        if ($LASTEXITCODE -ne 0) {
            throw "Session summary helper exited with code $LASTEXITCODE."
        }
        $SessionSummary = $summaryJson | ConvertFrom-Json
        $rowId = Save-StrategyPerformance $SessionSummary
        $PersistenceSucceeded = $true
        Write-Host "strategy_performance row saved: id=$rowId session=$($SessionSummary.sessionId) type=$($SessionSummary.sessionType)"
    }
    catch {
        Write-Host "SESSION PERSISTENCE FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "PATBv5 CLI bot exited with code $BotExitCode."

# --- Review and optional upload ---------------------------------------------
if ($PersistenceSucceeded -and $SessionSummary) {
    $LatestSessionId = [string]$SessionSummary.sessionId
    Write-Host "Running: npm run validate:signals -- --bot-id $BotId --session-id $LatestSessionId"
    & npm run validate:signals -- --bot-id $BotId --session-id $LatestSessionId
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Signal validation failed with code $LASTEXITCODE."
    }

    Write-Host "Running: npm run analyze:trades -- --bot-id $BotId --session-id $LatestSessionId"
    & npm run analyze:trades -- --bot-id $BotId --session-id $LatestSessionId
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Trade analysis failed with code $LASTEXITCODE."
    }

    if ($env:TELEMETRY_SHARE_PATH -and $env:TELEMETRY_SHARE_USER -and $env:TELEMETRY_SHARE_PASSWORD) {
        & powershell -NoProfile -File (Join-Path $ScriptDir "scripts\upload_session_to_samba.ps1") `
            -SessionFile ([string]$SessionSummary.sessionFile) `
            -SharePath $env:TELEMETRY_SHARE_PATH `
            -User $env:TELEMETRY_SHARE_USER `
            -Password $env:TELEMETRY_SHARE_PASSWORD
    }
    else {
        Write-Warning "Samba upload skipped: TELEMETRY_SHARE_PATH/USER/PASSWORD are not all configured."
    }
}

$FinalExitCode = if ($BotExitCode -eq 0 -and -not $PersistenceSucceeded) { 1 } else { $BotExitCode }
Write-Host ""
Read-Host "Press Enter to exit"
exit $FinalExitCode
