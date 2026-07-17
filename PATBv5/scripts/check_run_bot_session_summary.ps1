$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SummaryScript = Join-Path $ScriptDir "get_session_summary.ps1"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("patbv5-session-summary-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $TempRoot | Out-Null

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) {
        throw "$Message | expected=$Expected actual=$Actual"
    }
}

function Add-Event([string]$Path, [hashtable]$Event) {
    Add-Content -LiteralPath $Path -Value ($Event | ConvertTo-Json -Compress -Depth 12) -Encoding UTF8
}

function Invoke-Summary([datetime]$StartedAfterUtc, [string]$OriginHost = "test-host") {
    $json = & powershell -NoProfile -File $SummaryScript `
        -SessionsDirectory $TempRoot `
        -BotId "polymarket-bot-v5" `
        -StartedAfterUtc $StartedAfterUtc.ToString("o") `
        -OriginHost $OriginHost
    if ($LASTEXITCODE -ne 0) { throw "summary helper failed with $LASTEXITCODE" }
    return $json | ConvertFrom-Json
}

try {
    $paperPath = Join-Path $TempRoot "paper.jsonl"
    Add-Event $paperPath @{ type="bot.startup"; payload=@{mode="PAPER";paperStartingUsd=210.48}; timestamp="2026-07-16T22:19:13.700Z"; botId="polymarket-bot-v5"; originHost="test-host"; sessionId="paper-session"; sessionStartedAt="2026-07-16T22:19:13.685Z" }
    Add-Content -LiteralPath $paperPath -Value ('{"type":"padding","payload":{"value":"' + ('x' * 120000) + '"}}') -Encoding UTF8
    Add-Event $paperPath @{ type="bot.shutdown"; payload=@{reason="SIGINT";endingBalance=209.65}; timestamp="2026-07-16T22:46:19.403Z"; botId="polymarket-bot-v5"; originHost="test-host"; sessionId="paper-session"; sessionStartedAt="2026-07-16T22:19:13.685Z" }
    $paper = Invoke-Summary ([datetime]"2026-07-16T22:19:00Z")
    Assert-Equal $paper.complete $true "PAPER summary must be complete"
    Assert-Equal $paper.sessionType "PAPER_TESTING" "PAPER type"
    Assert-Equal $paper.initialBalance 210.48 "PAPER initial balance"
    Assert-Equal $paper.finalBalance 209.65 "PAPER final balance"

    $livePath = Join-Path $TempRoot "live.jsonl"
    Add-Event $livePath @{ type="bot.startup"; payload=@{mode="LIVE"}; timestamp="2026-07-16T23:00:00.100Z"; botId="polymarket-bot-v5"; originHost="test-host"; sessionId="live-session"; sessionStartedAt="2026-07-16T23:00:00.000Z" }
    Add-Event $livePath @{ type="live_balance.checkpoint"; payload=@{reason="startup_pre_market";collateralBalanceUsd=712.671433}; timestamp="2026-07-16T23:00:01.000Z"; botId="polymarket-bot-v5"; originHost="test-host"; sessionId="live-session"; sessionStartedAt="2026-07-16T23:00:00.000Z" }
    Add-Event $livePath @{ type="live_balance.checkpoint"; payload=@{reason="shutdown_SIGINT";collateralBalanceUsd=713.25}; timestamp="2026-07-16T23:10:00.000Z"; botId="polymarket-bot-v5"; originHost="test-host"; sessionId="live-session"; sessionStartedAt="2026-07-16T23:00:00.000Z" }
    $live = Invoke-Summary ([datetime]"2026-07-16T22:59:59Z")
    Assert-Equal $live.complete $true "LIVE summary must be complete"
    Assert-Equal $live.sessionType "LIVE_TRADING" "LIVE type"
    Assert-Equal $live.initialBalance 712.671433 "LIVE initial balance"
    Assert-Equal $live.finalBalance 713.25 "LIVE final balance"

    $oldPath = Join-Path $TempRoot "old.jsonl"
    Add-Event $oldPath @{ type="bot.startup"; payload=@{mode="PAPER";paperStartingUsd=1}; timestamp="2026-07-16T21:00:00Z"; botId="polymarket-bot-v5"; originHost="test-host"; sessionId="old-session"; sessionStartedAt="2026-07-16T21:00:00Z" }
    $selected = Invoke-Summary ([datetime]"2026-07-16T22:59:59Z")
    Assert-Equal $selected.sessionId "live-session" "must reject pre-boundary session"

    $incompletePath = Join-Path $TempRoot "incomplete.jsonl"
    Add-Event $incompletePath @{ type="bot.startup"; payload=@{mode="LIVE"}; timestamp="2026-07-17T00:00:00Z"; botId="polymarket-bot-v5"; originHost="test-host"; sessionId="incomplete-session"; sessionStartedAt="2026-07-17T00:00:00Z" }
    $incomplete = Invoke-Summary ([datetime]"2026-07-16T23:59:59Z")
    Assert-Equal $incomplete.complete $false "missing shutdown must remain incomplete"
    if ($null -ne $incomplete.initialBalance) { throw "missing balance must remain null" }

    $launcher = Get-Content (Join-Path $ScriptDir "..\run_bot.ps1") -Raw
    if ($launcher -notmatch 'Set-Location\s+\$ScriptDir') { throw "launcher must fix its working directory" }
    if ($launcher -match '\$PgPassword\s*=\s*"') { throw "launcher must not contain a PostgreSQL password literal" }
    if ($launcher -match 'net\s+use.+/USER:\S+\s+\S+') { throw "launcher must not contain Samba credentials" }
    if ($launcher -match 'VALUES\s*\([^\)]*0,\s*NULL,\s*NULL') { throw "launcher must not pre-insert an incomplete row" }
    if ($launcher -notmatch 'get_session_summary\.ps1') { throw "launcher must use the complete session summary" }
    if ($launcher -notmatch 'ON CONFLICT\s*\(session_id\)') { throw "launcher persistence must be idempotent" }
    if ($launcher -match 'return\s+if\s*\(') {
        throw "launcher must not use return if; Windows PowerShell treats if as a command"
    }

    $legacyLauncher = Get-Content (Join-Path $ScriptDir "..\launch_patbv5_cli_and_review.bat") -Raw
    if ($legacyLauncher -match 'net\s+use.+/USER:(?!["%])\S+\s+\S+') { throw "legacy launcher must not contain Samba credentials" }
    Write-Host "run_bot session summary tests passed"
}
finally {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
