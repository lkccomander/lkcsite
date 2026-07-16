# Post-run Session Persistence Design

## Goal

Make `PATBv5/run_bot.ps1` persist one complete, accurate `strategy_performance` row only after the bot session has ended. The launcher must support both PAPER and LIVE sessions, remain safe when the bot is stopped with `Ctrl+C`, avoid false zero balances, and repair the two incomplete rows created on 2026-07-16.

## Confirmed root causes

The current launcher inserts an incomplete row before starting the bot and relies on code after `npm start` to fill it. A `SIGINT` can stop the PowerShell pipeline before that back-fill runs, leaving an orphan row.

The balance helper reads only the last 100 KB of the global `events.jsonl`. It therefore misses `bot.startup` in normal-length PAPER sessions and does not understand LIVE balance checkpoints at all. The launcher converts a missing initial balance to zero, hard-codes every row as `PAPER_TESTING`, and never writes `finish_timestamp`.

The launcher also depends on its caller's current directory and embeds PostgreSQL and Samba credentials in source. The database has no unique index on `strategy_performance.session_id`, so an accidental replay can create duplicates.

## Selected architecture

Use post-run-only persistence. The launcher will not create a database row before `npm start`.

Immediately before starting the bot, the launcher records a UTC lower bound for the run. Session finalization runs from a `finally` block. It selects the session file whose first valid event matches the configured bot ID, current host, and a `sessionStartedAt` at or after the recorded lower bound. Among valid candidates it chooses the closest start time, preventing an older session from being linked merely because it was recently modified.

A focused session-summary helper streams the selected JSONL from beginning to end. It returns:

- `sessionId`
- `sessionFile`
- `mode`
- `sessionType`
- `initialBalance`
- `finalBalance`
- `startedAt`
- `finishedAt`
- `shutdownReason`
- `complete`

The launcher performs one idempotent insert only when the summary is complete and all required values are present. Missing or ambiguous data produces a clear warning and no database row. The telemetry file remains the recovery source.

## Mode and balance mapping

For PAPER sessions:

- `mode=PAPER`
- `session_type=PAPER_TESTING`
- Initial balance comes from `bot.startup.payload.paperStartingUsd`.
- Final balance and finish timestamp come from `bot.shutdown.payload.endingBalance` and its event timestamp.

For LIVE sessions:

- `mode=LIVE`
- `session_type=LIVE_TRADING`
- Initial balance comes from the first `live_balance.checkpoint` whose reason is `startup_pre_market`.
- Final balance and finish timestamp come from the last `live_balance.checkpoint` whose reason starts with `shutdown_`.
- Both values use `payload.collateralBalanceUsd`.

No missing balance is converted to zero. A summary is complete only when its mode, session ID, initial balance, final balance, start timestamp, and explicit shutdown timestamp are available.

## Launcher behavior

`run_bot.ps1` will set its working directory to its own directory before invoking `npm`, `npx`, or relative scripts. Paths to telemetry and helpers remain resolved from absolute paths.

PostgreSQL settings come from `polydb/postgres/.env` and supported process environment overrides. The launcher will not contain a password literal. Samba upload settings come from environment variables. If they are absent, upload is skipped with a warning without affecting database persistence or the launcher exit code.

The post-run order is:

1. Finalize and parse the exact session.
2. Persist the complete performance row.
3. Run signal validation.
4. Run trade analysis.
5. Upload the session file when Samba settings are configured.

Database persistence is independent of validation, analysis, and Samba. Failures in those optional post-run steps cannot undo or corrupt the completed row.

The launcher preserves the bot's exit code. A session-finalization failure is reported prominently, but does not replace a nonzero bot exit code. If the bot exited successfully and required persistence fails, the launcher returns a failure code.

## Database integrity

Add a versioned SQL migration that creates a partial unique index on non-null session IDs:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS strategy_performance_session_id_unique
ON public.strategy_performance (session_id)
WHERE session_id IS NOT NULL;
```

The launcher uses `INSERT ... ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE` so replaying a completed session repairs or refreshes the same logical row instead of creating another.

The migration is tested inside a transaction before being applied. Existing null `session_id` rows do not conflict with the partial index.

## Existing-row repair

Repair only these confirmed correlations inside one database transaction:

- Row `e782c16a-f4b0-4222-824e-3380f664d8ed`
  - Session `bea7bec8-a30e-445b-8239-ebd17b215e24`
  - Type `LIVE_TRADING`
  - Initial balance `712.671433`
  - Final balance `712.671433`
  - Start and finish timestamps are taken from the session JSONL.

- Row `09039abf-cd45-4e1a-b128-03d92587cee5`
  - Session `48423b4d-a29e-4647-a24f-925a3fc1145a`
  - Type `PAPER_TESTING`
  - Initial balance `210.48`
  - Final balance `209.65`
  - Start and finish timestamps are taken from the session JSONL.

Before commit, the transaction verifies that both target rows still have null session IDs, both session files produce complete summaries, the strategy ID remains `16041373-deb2-4183-9dda-5d5ff6dc5fff`, and no other row already uses either session ID. If any precondition fails, the repair rolls back.

## File boundaries

- `PATBv5/run_bot.ps1`: orchestration, process exit handling, database persistence, review flow, and optional upload.
- `PATBv5/scripts/get_session_summary.ps1`: deterministic session selection and streaming summary extraction.
- `PATBv5/scripts/get_session_balances.ps1`: removed after all launcher references move to the summary helper.
- `PATBv5/scripts/check_run_bot_session_summary.ps1`: isolated regression harness using temporary JSONL fixtures.
- `polydb/postgres/migrations/20260716_strategy_performance_session_unique.sql`: durable database integrity change.
- `PATBv5/package.json`: exposes the regression harness through `test:run-bot-launcher` and includes it in `test:all`.

## Error handling

Malformed JSONL lines are skipped, but the helper records their count. A file with no valid startup event, unsupported mode, missing balance, mismatched bot ID, mismatched host, or no explicit shutdown evidence is incomplete and cannot be persisted.

All database values are validated before SQL execution: UUIDs must parse, balances must be finite and nonnegative, timestamps must parse as UTC-capable timestamps, and session type must be exactly `PAPER_TESTING` or `LIVE_TRADING`.

The PostgreSQL password is placed in `PGPASSWORD` only for the child `psql` process and removed afterward. Diagnostic output never prints secrets.

## Verification

The regression harness covers:

- Complete PAPER summary extraction.
- Complete LIVE summary extraction.
- Long sessions where startup data is more than 100 KB from shutdown.
- Selection of the correct post-start session instead of an older or concurrent candidate.
- Rejection of incomplete sessions.
- Idempotent handling of malformed lines.

Verification also includes:

- PowerShell parser validation for the launcher and helpers.
- `npm run test:run-bot-launcher`.
- `npm run build`.
- Relevant existing tests and `npm run test:all` when practical.
- SQL migration and upsert verification inside a rolled-back transaction.
- Final read-only queries confirming two repaired rows, correct balances and types, populated finish timestamps, and no duplicate session IDs.

No verification step starts the trading bot or submits a LIVE order.
