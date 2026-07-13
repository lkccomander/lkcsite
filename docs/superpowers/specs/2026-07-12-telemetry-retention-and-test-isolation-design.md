# Telemetry Retention and Test Isolation Design

## Summary

PATBv5 currently appends every global telemetry event to a single `events.jsonl` file. That file has grown to approximately 18 GB and now fails to accept new writes on the current Windows environment. The test suite also writes into the production telemetry root, which makes tests noisy and accelerates growth of the shared log.

This design preserves the existing `events.jsonl` contract while adding bounded size-based rotation, a 5 GB managed-retention limit, safe migration of the existing file, and isolated telemetry storage for every test command.

## Goals

- Keep the active global telemetry path at `events.jsonl` so existing callers and reports continue to work.
- Rotate the active log before it exceeds 256 MB.
- Keep the active log plus automatically managed archives at or below 5 GB.
- Preserve the current 18 GB file as a legacy archive without deleting it automatically.
- Ensure concurrent in-process telemetry writes do not race with rotation or pruning.
- Prevent all PATBv5 test commands from writing to production telemetry.
- Verify rotation, retention, concurrency, failure recovery, and test isolation automatically.

## Non-goals

- Compressing archives.
- Changing session-file retention.
- Aggregating archived global logs transparently in reports.
- Deleting or truncating the current 18 GB file.
- Coordinating rotation across multiple bot processes that share one telemetry root. Each deployed bot instance should continue to use its own configured telemetry root.

## Architecture

The telemetry module remains the single global write boundary. It will own a small rotation manager and serialize each global write through one in-process promise queue.

The defaults are:

- `TELEMETRY_ROTATE_BYTES=268435456` (256 MB)
- `TELEMETRY_MAX_TOTAL_BYTES=5368709120` (5 GB)

Both values may be overridden through environment variables. Positive integer byte values are accepted. Invalid or non-positive values fall back to the defaults and produce one warning per process. The maximum-total value must be at least the rotation value; otherwise the default maximum-total value is used.

Managed archives use the exact form `events.<UTC timestamp>.jsonl`, with filename-unsafe timestamp punctuation replaced by hyphens. Legacy archives use `events.legacy-<UTC timestamp>.jsonl`. Only files matching the managed archive form participate in automatic pruning.

## Write and rotation flow

For every telemetry event:

1. Serialize the event before entering the write queue so its byte size is known.
2. Enter the telemetry write queue.
3. Ensure the telemetry root and session directory exist.
4. Read the active global log size. A missing active file has size zero.
5. If the active file alone already exceeds the maximum-total limit, stop with a migration-required error. Do not rename, append, or prune anything.
6. If active size plus serialized event size exceeds the rotation threshold, rename `events.jsonl` atomically to a managed timestamped archive.
7. Append the event to the active global file.
8. If a telemetry session exists, append the same event to its session file.
9. After a rotation, enumerate recognized managed archives and prune them oldest first until active size plus managed archive sizes is at or below the 5 GB limit.

Pruning never targets session files, unrelated files, or filenames containing the `legacy` marker.

## Concurrency and error handling

All writes in one process share a promise queue so file-size checks, rotation, append, and pruning cannot interleave. The queue must continue accepting later operations after a rejected operation.

Failure behavior is conservative:

- If size inspection fails for a reason other than a missing file, the write fails and no rotation or pruning occurs.
- If the active file already exceeds the maximum-total limit, the write fails with an explicit migration-required message and no file is renamed, appended, or deleted.
- If archive rename fails, the active file remains the source of truth and no pruning occurs.
- If the global append fails, the session append does not proceed for that event, preserving the existing ordering contract.
- If session append fails after the global append succeeds, the error is reported through the existing safe-write boundary.
- If pruning fails, the completed event write remains successful. A warning is logged and retention enforcement is retried after a later rotation.
- One failed operation cannot leave the queue permanently rejected.

The existing `writeTelemetryEventSafe` behavior remains the public failure boundary for callers that must not crash the bot.

## Existing-file migration

Migration is an explicit one-time filesystem operation, not an automatic startup behavior:

1. Stop processes that write to the telemetry root.
2. Record the current `events.jsonl` size and modification time.
3. Rename it in the same directory to `events.legacy-<UTC timestamp>.jsonl`.
4. Verify that the legacy archive exists and has the recorded size.
5. Start a telemetry-writing process or run a focused write probe.
6. Verify that a new `events.jsonl` is created and accepts valid JSONL.

The legacy archive is excluded from the 5 GB managed cap and is never automatically deleted. Its later archival or deletion requires a separate explicit operator decision.

## Test isolation

A central TypeScript test launcher will:

1. Create a unique directory under the operating-system temporary directory.
2. Spawn the requested test target with `TELEMETRY_ROOT` set to that directory.
3. Preserve the child process exit code and signal behavior.
4. Remove the temporary telemetry directory in a `finally` path after the child exits.

Every `npm run test:*` entry that can load production telemetry code will invoke the launcher. The aggregate `npm test` command continues to compose the individual scripts, so aggregate and targeted runs receive the same isolation behavior. Tests that already create more specific temporary fixtures remain valid within the isolated root.

## Verification

Focused automated coverage will use small environment-configured byte limits to verify:

- Rotation occurs before an append would exceed the active-file threshold.
- Managed archives are pruned oldest first until the total managed footprint is within the configured cap.
- Legacy archives and unrelated files are never pruned.
- Concurrent writes produce the expected count of newline-delimited, parseable JSON events.
- A simulated failed operation does not block a later queued write.
- Invalid retention configuration falls back to safe defaults.
- A targeted test command writes only inside its temporary telemetry root and cleans that root afterward.

Final verification consists of the focused telemetry tests, the complete PATBv5 test suite, the PATBv5 TypeScript production build, and the `newGui` production build.

## Rollout and operational notes

Implementation and automated verification happen before migrating the 18 GB file. Migration is performed only after confirming no bot process is actively writing. The rename stays on the same filesystem so it does not duplicate or rewrite 18 GB of data.

If the new code is started before migration, its oversized-file guard refuses global telemetry writes and preserves the existing file unchanged. This makes migration ordering safe against operator error.

The active global log continues to contain only recent telemetry after rotation. Historical cross-session analysis that needs older global events must explicitly select managed archives or session files; transparent multi-archive report aggregation is outside this change.
