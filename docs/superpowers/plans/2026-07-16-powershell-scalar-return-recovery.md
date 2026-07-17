# PowerShell Scalar Return and Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make post-run persistence report success in Windows PowerShell and recover the validation, analysis, and Samba upload skipped for session `fd6c1181-3793-479e-afbc-c00ec94ad1ad`.

**Architecture:** Keep the existing launcher and helper boundaries. Add one static compatibility regression to the launcher harness, replace the unsupported `return if` statement with explicit PowerShell control flow, then invoke existing post-session commands against the already-persisted telemetry session.

**Tech Stack:** Windows PowerShell 5.1, npm scripts, PostgreSQL `psql`, JSONL telemetry, SMB/Samba.

## Global Constraints

- Do not launch the bot or place orders.
- Do not insert or repair the existing database row.
- Do not print PostgreSQL or Samba credentials.
- Do not restructure the launcher or add a recovery mode.
- Preserve unrelated generated evaluation files in the working tree.

---

### Task 1: Add the Windows PowerShell compatibility regression

**Files:**
- Modify: `PATBv5/scripts/check_run_bot_session_summary.ps1`
- Test: `PATBv5/scripts/check_run_bot_session_summary.ps1`

**Interfaces:**
- Consumes: the raw text of `PATBv5/run_bot.ps1` in `$launcher`
- Produces: a failing assertion whenever the launcher contains `return if (`

- [ ] **Step 1: Add the failing launcher assertion**

```powershell
if ($launcher -match 'return\s+if\s*\(') {
    throw "launcher must not use return if; Windows PowerShell treats if as a command"
}
```

- [ ] **Step 2: Run the focused test and verify the regression fails**

Run from `PATBv5`:

```powershell
npm run test:run-bot-launcher
```

Expected: exit code `1` with `launcher must not use return if`.

### Task 2: Correct scalar return control flow

**Files:**
- Modify: `PATBv5/run_bot.ps1`
- Test: `PATBv5/scripts/check_run_bot_session_summary.ps1`

**Interfaces:**
- Consumes: the first non-empty output line from `psql` in `$value`
- Produces: trimmed scalar text when present or `$null` when absent

- [ ] **Step 1: Replace the unsupported return statement**

Replace:

```powershell
return if ($value) { $value.Trim() } else { $null }
```

with:

```powershell
if ($value) {
    return $value.Trim()
}
return $null
```

- [ ] **Step 2: Run the focused launcher test**

Run from `PATBv5`:

```powershell
npm run test:run-bot-launcher
```

Expected: exit code `0` with `run_bot session summary tests passed`.

- [ ] **Step 3: Parse the launcher with Windows PowerShell**

```powershell
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path '.\run_bot.ps1'),
    [ref]$tokens,
    [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) { throw ($errors -join [Environment]::NewLine) }
```

Expected: no parser errors.

- [ ] **Step 4: Commit the focused code change**

```powershell
git add -- PATBv5/run_bot.ps1 PATBv5/scripts/check_run_bot_session_summary.ps1
git commit -m "fix: return postgres scalar in powershell"
```

### Task 3: Recover skipped post-session actions

**Files:**
- Read: `PATBv5/.env`
- Read: `PATBv5/scripts/upload_session_to_samba.ps1`
- Input: `polydb/telemetry/sessions/2026-07-17T00-52-53-331Z__fd6c1181-3793-479e-afbc-c00ec94ad1ad.jsonl`

**Interfaces:**
- Consumes: bot ID `polymarket-bot-v5`, session ID `fd6c1181-3793-479e-afbc-c00ec94ad1ad`, and environment-provided Samba settings
- Produces: validation output, trade analysis output, and one copied telemetry file on the configured share

- [ ] **Step 1: Validate signals for the existing session**

```powershell
npm run validate:signals -- --bot-id polymarket-bot-v5 --session-id fd6c1181-3793-479e-afbc-c00ec94ad1ad
```

Expected: exit code `0` and a validation result for the requested session.

- [ ] **Step 2: Analyze trades for the existing session**

```powershell
npm run analyze:trades -- --bot-id polymarket-bot-v5 --session-id fd6c1181-3793-479e-afbc-c00ec94ad1ad
```

Expected: exit code `0` and analysis scoped to the requested session.

- [ ] **Step 3: Upload the existing telemetry file**

Load `TELEMETRY_SHARE_PATH`, `TELEMETRY_SHARE_USER`, and
`TELEMETRY_SHARE_PASSWORD` from `PATBv5/.env` into process environment without
echoing them, then run:

```powershell
powershell -NoProfile -File .\scripts\upload_session_to_samba.ps1 `
    -SessionFile 'C:\Projects\lkcsite\polydb\telemetry\sessions\2026-07-17T00-52-53-331Z__fd6c1181-3793-479e-afbc-c00ec94ad1ad.jsonl' `
    -SharePath $env:TELEMETRY_SHARE_PATH `
    -User $env:TELEMETRY_SHARE_USER `
    -Password $env:TELEMETRY_SHARE_PASSWORD
```

Expected: exit code `0` and upload confirmation without credential values.

- [ ] **Step 4: Verify database uniqueness and completeness**

Execute a read-only parameter-free query for session
`fd6c1181-3793-479e-afbc-c00ec94ad1ad`:

```sql
SELECT count(*) AS row_count,
       count(*) FILTER (
           WHERE initial_balance IS NOT NULL
             AND final_balance IS NOT NULL
             AND strat_timestamp IS NOT NULL
             AND finish_timestamp IS NOT NULL
       ) AS complete_count
FROM public.strategy_performance
WHERE session_id = 'fd6c1181-3793-479e-afbc-c00ec94ad1ad';
```

Expected: `row_count=1` and `complete_count=1`.
