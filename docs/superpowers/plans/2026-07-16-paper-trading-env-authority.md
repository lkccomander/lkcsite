# PAPER_TRADING `.env` Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PATBv5/.env` the tested, authoritative source of `PAPER_TRADING` whenever `PATBv5/run_bot.ps1` launches the bot.

**Architecture:** Extract launcher environment loading and mode validation into a dot-sourced PowerShell helper. Test the helper with temporary `.env` files, then integrate it into `run_bot.ps1` so only `PAPER_TRADING` overrides an inherited process value while all other settings retain their current precedence.

**Tech Stack:** Windows PowerShell 5.1, npm launcher harness, dotenv-compatible key/value files.

## Global Constraints

- `PATBv5/.env` is authoritative for `PAPER_TRADING` only when using `run_bot.ps1`.
- Do not change Node's global `dotenv` precedence.
- Do not change the Python GUI mode selector.
- Do not change credential, PostgreSQL, telemetry, Samba, or trading-decision behavior.
- Fail before `npm run build` and `npm start` when `PAPER_TRADING` is missing, duplicated, or invalid.
- Do not start the bot or place PAPER or LIVE orders during verification.
- Preserve unrelated generated evaluation files in the working tree.

---

### Task 1: Build and test the launcher environment helper

**Files:**
- Create: `PATBv5/scripts/runtime_env.ps1`
- Modify: `PATBv5/scripts/check_run_bot_session_summary.ps1`
- Test: `PATBv5/scripts/check_run_bot_session_summary.ps1`

**Interfaces:**
- Produces: `Import-DotEnv -Path <string> [-OverrideNames <string[]>] [-RequiredNames <string[]>]`
- Produces: `Resolve-TradingMode -Value <string> -SourcePath <string>` returning `PAPER` or `LIVE`
- Consumes: dotenv-compatible lines in temporary and real `.env` files

- [ ] **Step 1: Add failing helper tests to the launcher harness**

At the top of `check_run_bot_session_summary.ps1`, dot-source the helper and
capture the process values that the tests will temporarily replace:

```powershell
$RuntimeEnvScript = Join-Path $ScriptDir "runtime_env.ps1"
. $RuntimeEnvScript
$OriginalPaperTrading = [Environment]::GetEnvironmentVariable("PAPER_TRADING", "Process")
$OriginalUnrelatedSetting = [Environment]::GetEnvironmentVariable("PATBV5_TEST_UNRELATED", "Process")
```

Add this assertion helper after `Assert-Equal`:

```powershell
function Assert-Throws([scriptblock]$Action, [string]$Pattern, [string]$Message) {
    $threw = $false
    try {
        & $Action
    }
    catch {
        $threw = $true
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "$Message | unexpected error=$($_.Exception.Message)"
        }
    }
    if (-not $threw) { throw "$Message | expected an exception" }
}
```

Add these cases near the beginning of the existing `try` block:

```powershell
$authorityEnv = Join-Path $TempRoot "authority.env"
Set-Content -LiteralPath $authorityEnv -Value @(
    "PAPER_TRADING=false"
    "PATBV5_TEST_UNRELATED=file"
) -Encoding UTF8
$env:PAPER_TRADING = "true"
$env:PATBV5_TEST_UNRELATED = "process"
Import-DotEnv -Path $authorityEnv -OverrideNames @("PAPER_TRADING") -RequiredNames @("PAPER_TRADING")
Assert-Equal $env:PAPER_TRADING "false" "file PAPER_TRADING must override inherited true"
Assert-Equal (Resolve-TradingMode -Value $env:PAPER_TRADING -SourcePath $authorityEnv) "LIVE" "false must resolve to LIVE"
Assert-Equal $env:PATBV5_TEST_UNRELATED "process" "non-overridden process values must retain precedence"

Set-Content -LiteralPath $authorityEnv -Value "PAPER_TRADING=true" -Encoding UTF8
$env:PAPER_TRADING = "false"
Import-DotEnv -Path $authorityEnv -OverrideNames @("PAPER_TRADING") -RequiredNames @("PAPER_TRADING")
Assert-Equal $env:PAPER_TRADING "true" "file PAPER_TRADING must override inherited false"
Assert-Equal (Resolve-TradingMode -Value $env:PAPER_TRADING -SourcePath $authorityEnv) "PAPER" "true must resolve to PAPER"

$missingFile = Join-Path $TempRoot "missing.env"
Assert-Throws { Import-DotEnv -Path $missingFile -RequiredNames @("PAPER_TRADING") } "Required environment file" "missing .env must fail"

$missingKeyEnv = Join-Path $TempRoot "missing-key.env"
Set-Content -LiteralPath $missingKeyEnv -Value "OTHER=value" -Encoding UTF8
Assert-Throws { Import-DotEnv -Path $missingKeyEnv -RequiredNames @("PAPER_TRADING") } "Required environment variable 'PAPER_TRADING'" "missing PAPER_TRADING must fail"

$duplicateEnv = Join-Path $TempRoot "duplicate.env"
Set-Content -LiteralPath $duplicateEnv -Value @("PAPER_TRADING=true", "PAPER_TRADING=false") -Encoding UTF8
Assert-Throws { Import-DotEnv -Path $duplicateEnv -OverrideNames @("PAPER_TRADING") -RequiredNames @("PAPER_TRADING") } "Duplicate environment variable 'PAPER_TRADING'" "duplicate PAPER_TRADING must fail"

$invalidEnv = Join-Path $TempRoot "invalid.env"
Set-Content -LiteralPath $invalidEnv -Value "PAPER_TRADING=maybe" -Encoding UTF8
Import-DotEnv -Path $invalidEnv -OverrideNames @("PAPER_TRADING") -RequiredNames @("PAPER_TRADING")
Assert-Throws { Resolve-TradingMode -Value $env:PAPER_TRADING -SourcePath $invalidEnv } "Invalid PAPER_TRADING" "invalid PAPER_TRADING must fail"
```

Restore both process values in the existing `finally` block before removing the
temporary directory:

```powershell
if ($null -eq $OriginalPaperTrading) {
    Remove-Item Env:PAPER_TRADING -ErrorAction SilentlyContinue
}
else {
    $env:PAPER_TRADING = $OriginalPaperTrading
}
if ($null -eq $OriginalUnrelatedSetting) {
    Remove-Item Env:PATBV5_TEST_UNRELATED -ErrorAction SilentlyContinue
}
else {
    $env:PATBV5_TEST_UNRELATED = $OriginalUnrelatedSetting
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `PATBv5`:

```powershell
npm run test:run-bot-launcher
```

Expected: exit code `1` because `scripts/runtime_env.ps1` does not exist.

- [ ] **Step 3: Implement the helper**

Create `PATBv5/scripts/runtime_env.ps1`:

```powershell
function Import-DotEnv {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string[]]$OverrideNames = @(),
        [string[]]$RequiredNames = @()
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        if ($RequiredNames.Count -gt 0) {
            throw "Required environment file not found: $Path"
        }
        return
    }

    $values = @{}
    $counts = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -notmatch '^\s*([^#][^=]*)=(.*)$') { continue }
        $name = $matches[1].Trim()
        $value = $matches[2].Trim().Trim('"').Trim("'")
        if (-not $counts.ContainsKey($name)) { $counts[$name] = 0 }
        $counts[$name]++
        if (-not $values.ContainsKey($name)) { $values[$name] = $value }
    }

    foreach ($requiredName in $RequiredNames) {
        if (-not $values.ContainsKey($requiredName)) {
            throw "Required environment variable '$requiredName' is missing from $Path"
        }
    }
    foreach ($overrideName in $OverrideNames) {
        if ($counts.ContainsKey($overrideName) -and $counts[$overrideName] -gt 1) {
            throw "Duplicate environment variable '$overrideName' in $Path"
        }
    }

    foreach ($name in $values.Keys) {
        $existingValue = [Environment]::GetEnvironmentVariable($name, "Process")
        if (($OverrideNames -contains $name) -or -not $existingValue) {
            [Environment]::SetEnvironmentVariable($name, $values[$name], "Process")
        }
    }
}

function Resolve-TradingMode {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value,
        [Parameter(Mandatory = $true)][string]$SourcePath
    )

    $normalized = $Value.Trim().ToLowerInvariant()
    if (@("1", "true", "yes", "on") -contains $normalized) { return "PAPER" }
    if (@("0", "false", "no", "off") -contains $normalized) { return "LIVE" }
    throw "Invalid PAPER_TRADING value in $SourcePath. Use true/false, 1/0, yes/no, or on/off."
}
```

- [ ] **Step 4: Run the focused test and verify the helper passes**

```powershell
npm run test:run-bot-launcher
```

Expected: exit code `0` with `run_bot session summary tests passed`.

- [ ] **Step 5: Commit the tested helper**

```powershell
git add -- PATBv5/scripts/runtime_env.ps1 PATBv5/scripts/check_run_bot_session_summary.ps1
git commit -m "test: cover launcher env authority"
```

### Task 2: Make `run_bot.ps1` enforce file authority

**Files:**
- Modify: `PATBv5/run_bot.ps1`
- Modify: `PATBv5/scripts/check_run_bot_session_summary.ps1`
- Test: `PATBv5/scripts/check_run_bot_session_summary.ps1`

**Interfaces:**
- Consumes: `Import-DotEnv` and `Resolve-TradingMode` from Task 1
- Produces: `$env:PAPER_TRADING` copied from `PATBv5/.env` and a visible `Trading mode: <PAPER|LIVE>` line before build

- [ ] **Step 1: Add failing launcher integration assertions**

After loading `$launcher` in the harness, add:

```powershell
if ($launcher -notmatch 'runtime_env\.ps1') { throw "launcher must use the tested runtime env helper" }
if ($launcher -notmatch 'OverrideNames\s+@\("PAPER_TRADING"\)') { throw "launcher must make file PAPER_TRADING authoritative" }
if ($launcher -notmatch 'RequiredNames\s+@\("PAPER_TRADING"\)') { throw "launcher must require PAPER_TRADING in .env" }
if ($launcher -notmatch 'Resolve-TradingMode') { throw "launcher must validate and display its effective trading mode" }
```

- [ ] **Step 2: Run the focused test and verify integration fails**

```powershell
npm run test:run-bot-launcher
```

Expected: exit code `1` with `launcher must use the tested runtime env helper`.

- [ ] **Step 3: Replace the inline loader with the helper**

In the launcher paths section add:

```powershell
$RuntimeEnvPath = Join-Path $ScriptDir ".env"
$RuntimeEnvScript = Join-Path $ScriptDir "scripts\runtime_env.ps1"
```

Remove the inline `Import-DotEnv` function and replace its current calls with:

```powershell
. $RuntimeEnvScript
Import-DotEnv -Path $RuntimeEnvPath -OverrideNames @("PAPER_TRADING") -RequiredNames @("PAPER_TRADING")
Import-DotEnv -Path $PostgresEnvPath
$TradingMode = Resolve-TradingMode -Value $env:PAPER_TRADING -SourcePath $RuntimeEnvPath
```

Add this header line before the first UI prompt and before the build:

```powershell
Write-Host "Trading mode: $TradingMode (source=$RuntimeEnvPath)"
```

- [ ] **Step 4: Run the focused test and parser checks**

```powershell
npm run test:run-bot-launcher
```

Expected: exit code `0` with `run_bot session summary tests passed`.

Parse both PowerShell files without executing them:

```powershell
$files = @('.\run_bot.ps1', '.\scripts\runtime_env.ps1')
foreach ($file in $files) {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path $file),
        [ref]$tokens,
        [ref]$errors
    ) | Out-Null
    if ($errors.Count -gt 0) { throw "$file parser errors: $($errors -join '; ')" }
}
```

Expected: no parser errors.

- [ ] **Step 5: Commit launcher integration**

```powershell
git add -- PATBv5/run_bot.ps1 PATBv5/scripts/check_run_bot_session_summary.ps1
git commit -m "fix: honor paper trading env in launcher"
```

### Task 3: Final verification without launching the bot

**Files:**
- Verify: `PATBv5/run_bot.ps1`
- Verify: `PATBv5/scripts/runtime_env.ps1`
- Verify: `PATBv5/scripts/check_run_bot_session_summary.ps1`

**Interfaces:**
- Consumes: the completed helper and launcher integration
- Produces: evidence that inherited values are overridden only for `PAPER_TRADING`, invalid configuration fails, and no unrelated files were staged

- [ ] **Step 1: Re-run the focused regression suite**

```powershell
npm run test:run-bot-launcher
```

Expected: exit code `0`.

- [ ] **Step 2: Confirm the real file resolves to LIVE without starting the bot**

Run from `PATBv5`:

```powershell
. .\scripts\runtime_env.ps1
$env:PAPER_TRADING = "true"
Import-DotEnv -Path .\.env -OverrideNames @("PAPER_TRADING") -RequiredNames @("PAPER_TRADING")
$mode = Resolve-TradingMode -Value $env:PAPER_TRADING -SourcePath (Resolve-Path .\.env)
if ($env:PAPER_TRADING -ne "false" -or $mode -ne "LIVE") {
    throw "Expected PATBv5/.env to force PAPER_TRADING=false and LIVE."
}
Write-Host "PAPER_TRADING authority check passed: value=false mode=LIVE"
```

Expected: `PAPER_TRADING authority check passed: value=false mode=LIVE`.

- [ ] **Step 3: Inspect the final diff and working tree**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only pre-existing generated evaluation files
remain outside the committed launcher changes.

- [ ] **Step 4: Update Graphify after implementation**

```powershell
graphify . --backend nvidia --update
graphify cluster-only C:\Projects\lkcsite
```

Expected: `graphify-out/graph.json` and `GRAPH_REPORT.md` include the new helper
and launcher relationships. Do not commit ignored Graphify outputs unless the
repository's tracking policy changes.
