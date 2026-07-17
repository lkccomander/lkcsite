# PowerShell Scalar Return and Session Recovery Design

## Context

`PATBv5/run_bot.ps1` completed session persistence for session
`fd6c1181-3793-479e-afbc-c00ec94ad1ad`, but then printed:

```text
SESSION PERSISTENCE FAILED: The term 'if' is not recognized...
```

The PostgreSQL upsert had already succeeded. The failure occurred afterward in
`Invoke-PsqlScalar`, where Windows PowerShell interpreted `return if (...)` as
an attempt to invoke a command named `if`. Because the launcher marked the
whole persistence phase as failed, it skipped signal validation, trade
analysis, and the Samba upload.

## Approved Approach

Apply the smallest compatibility fix in the existing launcher. Replace the
conditional expression following `return` with a normal PowerShell `if` block
and explicit returns. Do not restructure the launcher or add a recovery mode.

Add a focused regression assertion to the existing launcher harness so
`return if (` cannot be reintroduced. The test must fail against the current
launcher and pass after the fix.

## Data and Recovery Flow

The affected database row is already complete and remains unchanged. Recovery
will operate on the existing telemetry file:

```text
C:\Projects\lkcsite\polydb\telemetry\sessions\2026-07-17T00-52-53-331Z__fd6c1181-3793-479e-afbc-c00ec94ad1ad.jsonl
```

After the code fix passes its focused checks, run these post-session actions
for the existing session ID:

1. `validate:signals`
2. `analyze:trades`
3. Upload the telemetry file to the configured Samba share

The recovery must not launch the trading bot, place orders, or manually insert
another performance row. Samba credentials must be loaded from environment
configuration without printing their values.

## Error Handling

The launcher continues using its existing `try`/`catch` boundary. A scalar
query returns trimmed text when PostgreSQL emits a value and `$null` when it
does not. A real PostgreSQL failure still throws with the captured command
output. Recovery commands are reported independently so validation or network
failures cannot be confused with database persistence.

## Verification

- Confirm the new regression fails before the launcher change.
- Confirm the focused launcher test passes after the change.
- Parse `run_bot.ps1` with Windows PowerShell to catch syntax errors.
- Run signal validation and trade analysis for the affected session.
- Confirm the Samba upload succeeds using the configured share.
- Re-query the database to confirm exactly one complete row remains for the
  affected session ID.

## Scope

Only `PATBv5/run_bot.ps1`, its existing launcher harness, and the generated
validation/analysis/Samba outputs are in scope. No database repair, schema
change, bot execution, trading behavior change, or unrelated refactor is
included.
