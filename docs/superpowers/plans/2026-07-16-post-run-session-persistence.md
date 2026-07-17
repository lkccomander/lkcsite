# Post-run Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PATBv5/run_bot.ps1` persist one complete, accurate, idempotent `strategy_performance` row after each PAPER or LIVE session, then repair the two confirmed incomplete rows.

**Architecture:** A new PowerShell helper selects the session created after the launcher start boundary and streams its complete JSONL into a normalized summary. The launcher performs no pre-run insert; its `finally` block persists only a complete summary using an upsert protected by a partial unique index. Versioned SQL files add the index and repair the two known rows transactionally.

**Tech Stack:** Windows PowerShell 5.1, Node.js/npm, JSONL telemetry, PostgreSQL 18/psql, TypeScript build and existing npm test suite.

## Global Constraints

- LIVE rows use `session_type=LIVE_TRADING`; PAPER rows use `session_type=PAPER_TESTING`.
- Missing balances are never converted to zero.
- Database persistence happens before optional validation, analysis, or Samba upload.
- PostgreSQL and Samba credentials must not appear as literals in tracked scripts.
- The launcher must not start the bot or submit a LIVE order during verification.
- Runtime connection settings remain in ignored local files or process environment variables.
- Existing generated evaluation metadata remains outside focused commits.

---

## File Map

- Create `PATBv5/scripts/get_session_summary.ps1`: select and summarize one post-start telemetry session.
- Create `PATBv5/scripts/check_run_bot_session_summary.ps1`: isolated PowerShell regression harness.
- Modify `PATBv5/run_bot.ps1`: post-run-only persistence and secret-safe orchestration.
- Delete `PATBv5/scripts/get_session_balances.ps1`: obsolete tail-only helper.
- Modify `PATBv5/package.json`: add `test:run-bot-launcher` and include it in `test:all`.
- Modify `PATBv5/.env.example`: document optional Samba variables without secrets.
- Create `PATBv5/polydb/postgres/migrations/20260716_strategy_performance_session_unique.sql`: partial unique index.
- Create `PATBv5/polydb/postgres/migrations/20260716_repair_strategy_performance_sessions.sql`: guarded repair of two known rows.

---

### Task 1: Deterministic session summary helper

**Files:**
- Create: `PATBv5/scripts/get_session_summary.ps1`
- Create: `PATBv5/scripts/check_run_bot_session_summary.ps1`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: parameters `SessionsDirectory: string`, `BotId: string`, `StartedAfterUtc: ISO-8601 datetime`, and optional `OriginHost: string`.
- Produces: compact JSON with `sessionId`, `sessionFile`, `mode`, `sessionType`, `initialBalance`, `finalBalance`, `startedAt`, `finishedAt`, `shutdownReason`, `complete`, and `malformedLineCount`.
- Exit code `0`: a candidate was summarized, including an incomplete summary; exit code `1`: no matching session exists or arguments are invalid.

- [ ] **Step 1: Write the failing regression harness**

Create `PATBv5/scripts/check_run_bot_session_summary.ps1` with an assertion helper and four isolated fixtures:

```powershell
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
    Assert-Equal $incomplete.initialBalance $null "missing balance must remain null"
    Write-Host "run_bot session summary tests passed"
}
finally {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
```

- [ ] **Step 2: Run the harness and verify it fails**

Run:

```powershell
powershell -NoProfile -File scripts/check_run_bot_session_summary.ps1
```

Working directory: `PATBv5`

Expected: FAIL because `scripts/get_session_summary.ps1` does not exist.

- [ ] **Step 3: Implement the summary helper**

Create `PATBv5/scripts/get_session_summary.ps1`. Use `StreamReader` both for candidate envelopes and the complete selected file. The core implementation must follow these exact mappings:

```powershell
param(
    [Parameter(Mandatory = $true)][string]$SessionsDirectory,
    [Parameter(Mandatory = $true)][string]$BotId,
    [Parameter(Mandatory = $true)][datetime]$StartedAfterUtc,
    [string]$OriginHost = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"

function Read-Envelope([string]$Path) {
    $reader = [System.IO.File]::OpenText($Path)
    try {
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try { $event = $line | ConvertFrom-Json } catch { continue }
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
    } finally { $reader.Dispose() }
    return $null
}

$boundary = $StartedAfterUtc.ToUniversalTime()
$candidates = foreach ($file in Get-ChildItem -LiteralPath $SessionsDirectory -Filter "*.jsonl" -File) {
    $envelope = Read-Envelope $file.FullName
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
$initial = $null
$final = $null
$finishedAt = $null
$shutdownReason = $null
$malformed = 0
$reader = [System.IO.File]::OpenText($selected.Path)
try {
    while (-not $reader.EndOfStream) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $event = $line | ConvertFrom-Json } catch { $malformed += 1; continue }
        if ($event.botId -ne $BotId -or $event.sessionId -ne $selected.SessionId) { continue }
        if ($event.type -eq "bot.startup") {
            $mode = [string]$event.payload.mode
            if ($mode -eq "PAPER" -and $null -ne $event.payload.paperStartingUsd) {
                $initial = [decimal]$event.payload.paperStartingUsd
            }
        }
        if ($event.type -eq "bot.shutdown" -and $mode -eq "PAPER") {
            if ($null -ne $event.payload.endingBalance) { $final = [decimal]$event.payload.endingBalance }
            $finishedAt = ([datetime]$event.timestamp).ToUniversalTime().ToString("o")
            $shutdownReason = [string]$event.payload.reason
        }
        if ($event.type -eq "live_balance.checkpoint") {
            $reason = [string]$event.payload.reason
            if ($reason -eq "startup_pre_market" -and $null -ne $event.payload.collateralBalanceUsd) {
                $initial = [decimal]$event.payload.collateralBalanceUsd
            }
            if ($reason -like "shutdown_*" -and $null -ne $event.payload.collateralBalanceUsd) {
                $final = [decimal]$event.payload.collateralBalanceUsd
                $finishedAt = ([datetime]$event.timestamp).ToUniversalTime().ToString("o")
                $shutdownReason = $reason.Substring("shutdown_".Length)
            }
        }
    }
} finally { $reader.Dispose() }

$sessionType = if ($mode -eq "PAPER") { "PAPER_TESTING" } elseif ($mode -eq "LIVE") { "LIVE_TRADING" } else { $null }
$complete = $null -ne $sessionType -and $null -ne $initial -and $null -ne $final -and $null -ne $finishedAt
[PSCustomObject]@{
    sessionId = $selected.SessionId
    sessionFile = $selected.Path
    mode = $mode
    sessionType = $sessionType
    initialBalance = $initial
    finalBalance = $final
    startedAt = $selected.StartedAt.ToString("o")
    finishedAt = $finishedAt
    shutdownReason = $shutdownReason
    complete = $complete
    malformedLineCount = $malformed
} | ConvertTo-Json -Compress
```

- [ ] **Step 4: Run the harness and verify it passes**

Run: `powershell -NoProfile -File scripts/check_run_bot_session_summary.ps1`

Expected: `run_bot session summary tests passed` and exit code `0`.

- [ ] **Step 5: Add the harness to npm scripts**

Add to `PATBv5/package.json`:

```json
"test:run-bot-launcher": "powershell -NoProfile -File scripts/check_run_bot_session_summary.ps1"
```

Insert `npm run test:run-bot-launcher` into `test:all` immediately after `test:isolated-runner`.

- [ ] **Step 6: Commit the helper and tests**

```powershell
git add PATBv5/scripts/get_session_summary.ps1 PATBv5/scripts/check_run_bot_session_summary.ps1 PATBv5/package.json
git commit -m "test: cover post-run session summaries"
```

---

### Task 2: Post-run-only launcher persistence

**Files:**
- Modify: `PATBv5/run_bot.ps1`
- Delete: `PATBv5/scripts/get_session_balances.ps1`
- Modify: `PATBv5/.env.example`
- Test: `PATBv5/scripts/check_run_bot_session_summary.ps1`

**Interfaces:**
- Consumes the JSON contract from `get_session_summary.ps1`.
- Reads PostgreSQL settings from `polydb/postgres/.env`, with process environment taking precedence.
- Reads optional `TELEMETRY_SHARE_PATH`, `TELEMETRY_SHARE_USER`, and `TELEMETRY_SHARE_PASSWORD` from process environment.
- Produces one upserted `public.strategy_performance` row only for a complete summary.

- [ ] **Step 1: Extend the harness with launcher safety assertions**

Append these assertions to `check_run_bot_session_summary.ps1` before the success message:

```powershell
$launcher = Get-Content (Join-Path $ScriptDir "..\run_bot.ps1") -Raw
if ($launcher -notmatch 'Set-Location\s+\$ScriptDir') { throw "launcher must fix its working directory" }
if ($launcher -match '\$PgPassword\s*=\s*"') { throw "launcher must not contain a PostgreSQL password literal" }
if ($launcher -match 'net\s+use.+/USER:\S+\s+\S+') { throw "launcher must not contain Samba credentials" }
if ($launcher -match 'VALUES\s*\([^\)]*0,\s*NULL,\s*NULL') { throw "launcher must not pre-insert an incomplete row" }
if ($launcher -notmatch 'get_session_summary\.ps1') { throw "launcher must use the complete session summary" }
if ($launcher -notmatch 'ON CONFLICT\s*\(session_id\)') { throw "launcher persistence must be idempotent" }
```

- [ ] **Step 2: Run the harness and verify the launcher assertions fail**

Run: `npm run test:run-bot-launcher`

Expected: FAIL on the first missing launcher safety property.

- [ ] **Step 3: Add dotenv loading and fixed working directory**

At the top of `run_bot.ps1`, add `Set-Location $ScriptDir` after path resolution. Replace hard-coded PostgreSQL values with a loader that only sets variables not already provided by the process environment:

```powershell
function Import-DotEnv([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -notmatch '^\s*([^#][^=]*)=(.*)$') { continue }
        $name = $matches[1].Trim()
        $value = $matches[2].Trim().Trim('"').Trim("'")
        if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

$PostgresEnvPath = Join-Path $RepoRoot "polydb\postgres\.env"
Import-DotEnv (Join-Path $ScriptDir ".env")
Import-DotEnv $PostgresEnvPath
$PgHost = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { "localhost" }
$PgPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { "5432" }
$PgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "rabbithat" }
$PgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }
```

`Invoke-PsqlScalar` must copy the process environment, use `POSTGRES_PASSWORD` as `PGPASSWORD` only while invoking `psql`, and remove `PGPASSWORD` in `finally`. It must never print either secret.

- [ ] **Step 4: Replace pre-run insert with finalization and upsert**

Capture the boundary immediately before the bot starts:

```powershell
$RunStartedAfterUtc = [datetime]::UtcNow
$BotExitCode = 1
$PersistenceSucceeded = $false
$SessionSummary = $null

try {
    & npm start
    $BotExitCode = $LASTEXITCODE
}
finally {
    try {
        $summaryJson = & powershell -NoProfile -File (Join-Path $ScriptDir "scripts\get_session_summary.ps1") `
            -SessionsDirectory (Join-Path $RepoRoot "polydb\telemetry\sessions") `
            -BotId $BotId `
            -StartedAfterUtc $RunStartedAfterUtc.ToString("o") `
            -OriginHost $env:COMPUTERNAME
        if ($LASTEXITCODE -ne 0) { throw "Session summary helper exited with $LASTEXITCODE." }
        $SessionSummary = $summaryJson | ConvertFrom-Json
        if (-not $SessionSummary.complete) { throw "Session summary is incomplete; database row was not written." }

        $insertSql = @"
INSERT INTO public.strategy_performance
    (strategy_id, initial_balance, final_balance, session_id, session_type, strat_timestamp, finish_timestamp)
VALUES
    ('$StrategyId'::uuid, $($SessionSummary.initialBalance), $($SessionSummary.finalBalance),
     '$($SessionSummary.sessionId)', '$($SessionSummary.sessionType)',
     '$($SessionSummary.startedAt)'::timestamptz, '$($SessionSummary.finishedAt)'::timestamptz)
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
        $insertedId = Invoke-PsqlScalar -Sql $insertSql
        if (-not $insertedId) { throw "strategy_performance upsert returned no id." }
        $PersistenceSucceeded = $true
    }
    catch {
        Write-Host "SESSION PERSISTENCE FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}
```

Before interpolation, validate:

```powershell
$parsedSessionId = [guid]::Empty
if (-not [guid]::TryParse([string]$SessionSummary.sessionId, [ref]$parsedSessionId)) { throw "Invalid session UUID." }
if ([string]$SessionSummary.sessionType -notin @("PAPER_TESTING", "LIVE_TRADING")) { throw "Invalid session type." }
foreach ($value in @($SessionSummary.initialBalance, $SessionSummary.finalBalance)) {
    if ($null -eq $value -or [decimal]$value -lt 0) { throw "Invalid balance." }
}
```

Use invariant-culture decimal formatting before SQL interpolation so Guatemalan locale settings cannot produce commas.

- [ ] **Step 5: Make review and upload non-destructive**

Use `$SessionSummary.sessionId` and `$SessionSummary.sessionFile` for validation, analysis, and upload. Check the exit code of validation and analysis and report failures without changing the database row.

Replace the hard-coded Samba block with:

```powershell
if ($env:TELEMETRY_SHARE_PATH -and $env:TELEMETRY_SHARE_USER -and $env:TELEMETRY_SHARE_PASSWORD) {
    & powershell -NoProfile -File (Join-Path $ScriptDir "scripts\upload_session_to_samba.ps1") `
        -SessionFile $SessionSummary.sessionFile `
        -SharePath $env:TELEMETRY_SHARE_PATH `
        -User $env:TELEMETRY_SHARE_USER `
        -Password $env:TELEMETRY_SHARE_PASSWORD
} else {
    Write-Warning "Samba upload skipped: TELEMETRY_SHARE_PATH/USER/PASSWORD are not all configured."
}
```

If `$BotExitCode -eq 0` and `$PersistenceSucceeded` is false, return exit code `1`; otherwise preserve `$BotExitCode`.

- [ ] **Step 6: Document optional upload variables**

Append to `PATBv5/.env.example` without values:

```dotenv
TELEMETRY_SHARE_PATH=
TELEMETRY_SHARE_USER=
TELEMETRY_SHARE_PASSWORD=
```

- [ ] **Step 7: Remove the obsolete helper and run validation**

Delete `PATBv5/scripts/get_session_balances.ps1` after confirming `rg -n "get_session_balances" PATBv5` returns no remaining reference.

Run:

```powershell
npm run test:run-bot-launcher
$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "run_bot.ps1"), [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { $errors; exit 1 }
```

Expected: harness passes, parser returns no errors, and the bot is never started.

- [ ] **Step 8: Commit the launcher fix**

```powershell
git add PATBv5/run_bot.ps1 PATBv5/scripts/check_run_bot_session_summary.ps1 PATBv5/.env.example
git commit -m "fix: persist completed bot sessions"
```

---

### Task 3: Database idempotency migration

**Files:**
- Create: `PATBv5/polydb/postgres/migrations/20260716_strategy_performance_session_unique.sql`

**Interfaces:**
- Consumes existing `public.strategy_performance(session_id text)`.
- Produces partial unique index `strategy_performance_session_id_unique`.

- [ ] **Step 1: Write the migration**

```sql
\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.strategy_performance') IS NULL THEN
        RAISE EXCEPTION 'public.strategy_performance does not exist';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.strategy_performance
        WHERE session_id IS NOT NULL
        GROUP BY session_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate non-null strategy_performance.session_id values exist';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS strategy_performance_session_id_unique
ON public.strategy_performance (session_id)
WHERE session_id IS NOT NULL;
```

- [ ] **Step 2: Dry-run the migration and upsert in a rollback transaction**

Load connection variables from `polydb/postgres/.env` without printing secrets. Execute one `psql` process with:

```powershell
psql -w -X -v ON_ERROR_STOP=1 `
  -c "BEGIN" `
  -f "PATBv5/polydb/postgres/migrations/20260716_strategy_performance_session_unique.sql" `
  -c "INSERT INTO public.strategy_performance (strategy_id,initial_balance,final_balance,session_id,session_type,strat_timestamp,finish_timestamp) VALUES ('16041373-deb2-4183-9dda-5d5ff6dc5fff',1,1,'00000000-0000-0000-0000-000000000001','PAPER_TESTING',now(),now()) ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET final_balance=EXCLUDED.final_balance" `
  -c "ROLLBACK"
```

Expected: all statements succeed and the test session ID is absent afterward.

- [ ] **Step 3: Apply and verify the index**

Run the migration with `psql -w -X -v ON_ERROR_STOP=1 -1 -f PATBv5/polydb/postgres/migrations/20260716_strategy_performance_session_unique.sql`, then query `pg_indexes` and assert exactly one matching index whose definition contains `UNIQUE` and `WHERE (session_id IS NOT NULL)`.

- [ ] **Step 4: Commit the integrity migration**

```powershell
git add PATBv5/polydb/postgres/migrations/20260716_strategy_performance_session_unique.sql
git commit -m "db: enforce unique performance sessions"
```

---

### Task 4: Guarded repair of the two incomplete rows

**Files:**
- Create: `PATBv5/polydb/postgres/migrations/20260716_repair_strategy_performance_sessions.sql`

**Interfaces:**
- Repairs only row IDs `e782c16a-f4b0-4222-824e-3380f664d8ed` and `09039abf-cd45-4e1a-b128-03d92587cee5`.
- Aborts if either row is no longer incomplete or either session ID is already attached elsewhere.

- [ ] **Step 1: Verify the new helper reproduces the two known summaries**

Run `get_session_summary.ps1` against a temporary directory containing only each real session file, or use a start boundary immediately before each session. Assert these exact results:

```text
bea7bec8-a30e-445b-8239-ebd17b215e24
LIVE_TRADING
712.671433 -> 712.671433
2026-07-16T22:01:09.041Z -> 2026-07-16T22:14:47.999Z

48423b4d-a29e-4647-a24f-925a3fc1145a
PAPER_TESTING
210.48 -> 209.65
2026-07-16T22:19:13.685Z -> 2026-07-16T22:46:19.403Z
```

- [ ] **Step 2: Write the guarded repair migration**

```sql
\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.strategy_performance
        WHERE id = 'e782c16a-f4b0-4222-824e-3380f664d8ed'::uuid
          AND session_id IS NULL AND final_balance IS NULL AND finish_timestamp IS NULL
    ) THEN
        RAISE EXCEPTION 'LIVE target row is not in the expected incomplete state';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.strategy_performance
        WHERE id = '09039abf-cd45-4e1a-b128-03d92587cee5'::uuid
          AND session_id IS NULL AND final_balance IS NULL AND finish_timestamp IS NULL
    ) THEN
        RAISE EXCEPTION 'PAPER target row is not in the expected incomplete state';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.strategy_performance
        WHERE session_id IN (
            'bea7bec8-a30e-445b-8239-ebd17b215e24',
            '48423b4d-a29e-4647-a24f-925a3fc1145a'
        )
    ) THEN
        RAISE EXCEPTION 'one of the repair session IDs is already linked';
    END IF;
END $$;

UPDATE public.strategy_performance
SET session_id = 'bea7bec8-a30e-445b-8239-ebd17b215e24',
    session_type = 'LIVE_TRADING',
    initial_balance = 712.671433,
    final_balance = 712.671433,
    strat_timestamp = '2026-07-16T22:01:09.041Z'::timestamptz,
    finish_timestamp = '2026-07-16T22:14:47.999Z'::timestamptz
WHERE id = 'e782c16a-f4b0-4222-824e-3380f664d8ed'::uuid;

UPDATE public.strategy_performance
SET session_id = '48423b4d-a29e-4647-a24f-925a3fc1145a',
    session_type = 'PAPER_TESTING',
    initial_balance = 210.48,
    final_balance = 209.65,
    strat_timestamp = '2026-07-16T22:19:13.685Z'::timestamptz,
    finish_timestamp = '2026-07-16T22:46:19.403Z'::timestamptz
WHERE id = '09039abf-cd45-4e1a-b128-03d92587cee5'::uuid;

DO $$
BEGIN
    IF (SELECT count(*) FROM public.strategy_performance WHERE session_id IN (
        'bea7bec8-a30e-445b-8239-ebd17b215e24',
        '48423b4d-a29e-4647-a24f-925a3fc1145a'
    )) <> 2 THEN
        RAISE EXCEPTION 'repair verification did not find exactly two rows';
    END IF;
END $$;
```

- [ ] **Step 3: Dry-run and inspect the repair**

Execute `BEGIN`, the repair migration, a `SELECT` of both rows, and `ROLLBACK` in the same `psql` process. Expected rows must match the exact values above. Query again after rollback and confirm both rows remain incomplete.

- [ ] **Step 4: Apply the repair transactionally**

Run `psql -w -X -v ON_ERROR_STOP=1 -1 -f PATBv5/polydb/postgres/migrations/20260716_repair_strategy_performance_sessions.sql`.

- [ ] **Step 5: Verify final database health**

Run read-only queries asserting:

```sql
SELECT id, session_id, session_type, initial_balance, final_balance,
       strat_timestamp, finish_timestamp
FROM public.strategy_performance
ORDER BY strat_timestamp;

SELECT session_id, count(*)
FROM public.strategy_performance
WHERE session_id IS NOT NULL
GROUP BY session_id
HAVING count(*) > 1;
```

Expected: two complete rows and zero duplicate session IDs.

- [ ] **Step 6: Commit the repair migration**

```powershell
git add PATBv5/polydb/postgres/migrations/20260716_repair_strategy_performance_sessions.sql
git commit -m "db: repair incomplete performance sessions"
```

---

### Task 5: Final regression and focused handoff

**Files:**
- Verify all files from Tasks 1-4.

**Interfaces:**
- Confirms the launcher is safe to use without starting it.

- [ ] **Step 1: Run focused checks**

```powershell
npm run test:run-bot-launcher
npm run build
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 2: Run the full suite**

Run: `npm run test:all`

Expected: exit code `0`.

- [ ] **Step 3: Verify secrets and obsolete references are absent**

```powershell
rg -n '\$PgPassword\s*=\s*"|net\s+use.+/USER:\S+\s+\S+|get_session_balances' PATBv5/run_bot.ps1 PATBv5/scripts PATBv5/.env.example
```

Expected: no matches.

- [ ] **Step 4: Verify focused Git status**

Confirm only pre-existing generated evaluation files remain unstaged. Do not stage or commit:

```text
PATBv5/polydb/evaluation/repos/lkcsite-master.json
PATBv5/polydb/evaluation/bot_builds/bot_v5_build_2026_07_16_*.json
PATBv5/polydb/evaluation/strategy_versions/trade_5x_v012.json
```

- [ ] **Step 5: Report readiness**

Report the launcher test result, full-suite result, applied index, repaired row values, commits created, and the remaining local environment variables needed for optional Samba upload. Explicitly state that no bot process or LIVE order was started during implementation.
