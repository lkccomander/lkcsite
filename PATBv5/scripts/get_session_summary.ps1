param(
    [Parameter(Mandatory = $true)]
    [string]$SessionsDirectory,
    [Parameter(Mandatory = $true)]
    [string]$BotId,
    [Parameter(Mandatory = $true)]
    [datetime]$StartedAfterUtc,
    [string]$OriginHost = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"

function Read-Envelope {
    param([Parameter(Mandatory = $true)][string]$Path)

    $reader = [System.IO.File]::OpenText($Path)
    try {
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $event = $line | ConvertFrom-Json
            }
            catch {
                continue
            }
            if ($event.sessionId -and $event.sessionStartedAt -and $event.botId) {
                return [PSCustomObject]@{
                    Path = $Path
                    BotId = [string]$event.botId
                    OriginHost = [string]$event.originHost
                    SessionId = [string]$event.sessionId
                    StartedAt = ([datetime]$event.sessionStartedAt).ToUniversalTime()
                }
            }
        }
    }
    finally {
        $reader.Dispose()
    }
    return $null
}

if (-not (Test-Path -LiteralPath $SessionsDirectory -PathType Container)) {
    Write-Error "Sessions directory does not exist: $SessionsDirectory"
    exit 1
}

$boundary = $StartedAfterUtc.ToUniversalTime()
$candidates = foreach ($file in Get-ChildItem -LiteralPath $SessionsDirectory -Filter "*.jsonl" -File) {
    $envelope = Read-Envelope -Path $file.FullName
    if (-not $envelope) { continue }
    if ($envelope.BotId -ne $BotId) { continue }
    if ($OriginHost -and $envelope.OriginHost -ne $OriginHost) { continue }
    if ($envelope.StartedAt -lt $boundary) { continue }
    $envelope
}

$selected = $candidates | Sort-Object StartedAt | Select-Object -First 1
if (-not $selected) {
    Write-Error "No matching session started at or after $($boundary.ToString('o'))."
    exit 1
}

$mode = $null
$initialBalance = $null
$finalBalance = $null
$finishedAt = $null
$shutdownReason = $null
$malformedLineCount = 0
$reader = [System.IO.File]::OpenText($selected.Path)
try {
    while (-not $reader.EndOfStream) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $event = $line | ConvertFrom-Json
        }
        catch {
            $malformedLineCount += 1
            continue
        }
        if ($event.botId -ne $BotId -or $event.sessionId -ne $selected.SessionId) { continue }

        if ($event.type -eq "bot.startup") {
            $mode = [string]$event.payload.mode
            if ($mode -eq "PAPER" -and $null -ne $event.payload.paperStartingUsd) {
                $initialBalance = [decimal]$event.payload.paperStartingUsd
            }
        }

        if ($event.type -eq "bot.shutdown" -and $mode -eq "PAPER") {
            if ($null -ne $event.payload.endingBalance) {
                $finalBalance = [decimal]$event.payload.endingBalance
            }
            $finishedAt = ([datetime]$event.timestamp).ToUniversalTime().ToString("o")
            $shutdownReason = [string]$event.payload.reason
        }

        if ($event.type -eq "live_balance.checkpoint") {
            $reason = [string]$event.payload.reason
            if ($reason -eq "startup_pre_market" -and $null -ne $event.payload.collateralBalanceUsd) {
                $initialBalance = [decimal]$event.payload.collateralBalanceUsd
            }
            if ($reason -like "shutdown_*" -and $null -ne $event.payload.collateralBalanceUsd) {
                $finalBalance = [decimal]$event.payload.collateralBalanceUsd
                $finishedAt = ([datetime]$event.timestamp).ToUniversalTime().ToString("o")
                $shutdownReason = $reason.Substring("shutdown_".Length)
            }
        }
    }
}
finally {
    $reader.Dispose()
}

$sessionType = if ($mode -eq "PAPER") {
    "PAPER_TESTING"
}
elseif ($mode -eq "LIVE") {
    "LIVE_TRADING"
}
else {
    $null
}
$complete = $null -ne $sessionType `
    -and $null -ne $initialBalance `
    -and $null -ne $finalBalance `
    -and $null -ne $finishedAt

[PSCustomObject]@{
    sessionId = $selected.SessionId
    sessionFile = $selected.Path
    mode = $mode
    sessionType = $sessionType
    initialBalance = $initialBalance
    finalBalance = $finalBalance
    startedAt = $selected.StartedAt.ToString("o")
    finishedAt = $finishedAt
    shutdownReason = $shutdownReason
    complete = $complete
    malformedLineCount = $malformedLineCount
} | ConvertTo-Json -Compress
