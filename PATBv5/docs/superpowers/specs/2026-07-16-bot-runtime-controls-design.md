# CODEX Bot Runtime Controls Design

**Date:** 2026-07-16  
**Status:** Approved  
**Related design:** `2026-07-16-codex-live-terminal-design.md`

## Context

The current PATBv5 live UI is embedded in the bot process. `src/index.ts` starts the UI server only when `UI_SERVER_ENABLED` is enabled, so stopping the bot also stops the page that would need to start it again. The current `run_bot.ps1` wrapper is also responsible for important post-run work: it resolves the authoritative trading mode, launches the bot, derives the completed telemetry session, persists `strategy_performance`, runs validation and analysis, and optionally uploads the session.

The CODEX view needs local controls that can start either a PAPER or LIVE run, stop the active run safely, and remain available while the bot is stopped. LIVE starts must be visually unmistakable, but the user explicitly chose not to require a typed confirmation or automatic `check:live-readiness` execution.

## Goals

- Keep CODEX available independently of the bot lifecycle.
- Start exactly one PAPER or LIVE bot instance from CODEX.
- Select the mode for that run without editing `.env`.
- Preserve `.env` as the authority for ordinary manual `run_bot.ps1` launches.
- Stop through the existing graceful shutdown and session-persistence path.
- Make process state, finalization, failures, and forced termination visible.
- Restrict all runtime-control capabilities to the same computer.
- Recover accurate state after the controller restarts.
- Audit every operator control action.

## Non-goals

- Remote or LAN runtime control.
- Multiple simultaneous bot instances.
- Installing a Windows service or scheduled task.
- Editing `PAPER_TRADING` in `.env`.
- Automatically running live-readiness checks.
- Requiring an extra LIVE confirmation phrase or dialog.
- Replacing the report server or its report-generation controls.

## Chosen Architecture

Use a separate Node/TypeScript controller as the long-lived owner of the CODEX UI and runtime-control API. The controller listens only on `127.0.0.1`, serves the built React application, and launches `run_bot.ps1` as a managed child process.

The main components are:

1. **`codex_machine.ps1`** — convenience launcher in the PATBv5 root. It builds the TypeScript and React assets, starts the controller, and opens `/terminal-v5/codex`.
2. **CODEX controller** — an independent Node process that serves the UI, exposes the local control API, owns the run state machine, launches the PowerShell wrapper, captures logs, and performs recovery.
3. **`run_bot.ps1` controlled mode** — optional non-interactive parameters let the controller choose PAPER or LIVE for one run, skip redundant builds, disable the embedded UI, and attach a unique run ID. Existing manual behavior remains unchanged when these parameters are absent.
4. **Bot runtime-control channel** — small run-scoped state, heartbeat, and stop-request files allow the independent controller and bot to coordinate without relying on fragile Windows console signals.
5. **CODEX controls** — React controls render the authoritative controller state and expose only valid actions for that state.

The embedded UI path remains available for backward compatibility, but controlled runs disable it so there is only one UI server and one control authority.

## Runtime Files and Identity

Runtime-only files live under an ignored directory such as `polydb/runtime/control/`:

- `controller.lock` — prevents two controllers from owning the same workspace.
- `active-run.json` — controller-owned record containing run ID, requested mode, wrapper PID, process start time, timestamps, and current state.
- `bot-heartbeat.json` — bot-owned record containing run ID, bot PID, mode, session ID, status, and last update time.
- `stop-request.json` — controller request targeted to an exact run ID.
- `control-audit.jsonl` — append-only operator-action and lifecycle audit log.

Every controlled launch receives a UUID run ID. Stop requests must match the active run ID; stale requests cannot stop a later run. PID checks also compare the recorded process start time to reduce PID-reuse errors.

The heartbeat updates approximately once per second. The stop-request watcher runs independently of the trading loop so a shutdown request is observed promptly even while the market loop is waiting.

## Trading-mode Authority

Mode precedence is intentionally explicit:

1. A normal manual `run_bot.ps1` invocation has no `-Mode` argument. It continues to require `PAPER_TRADING` in `.env`, imports that value authoritatively, and resolves PAPER or LIVE exactly as it does now.
2. A controlled invocation supplies `-Mode PAPER` or `-Mode LIVE`. After validating `.env`, the wrapper applies the requested mode only to that child process and records the source as `CONTROL OVERRIDE`.
3. The controller never rewrites `.env` and never infers LIVE from a missing or falsey status field.
4. The bot's `bot.startup` event and heartbeat both publish the explicit runtime mode and run ID.

The proposed controlled invocation is equivalent to:

```powershell
.\run_bot.ps1 -Mode PAPER -RunId <uuid> -NonInteractive -SkipBuild -DisableEmbeddedUi
```

or the same command with `-Mode LIVE`.

## Controller State Machine

| State | Meaning | Available action |
| --- | --- | --- |
| `STOPPED` | No bot or finalizer is active | Start PAPER or LIVE |
| `STARTING` | Wrapper launched; waiting for matching bot heartbeat | None |
| `PAPER` | Active PAPER session confirmed | Stop |
| `LIVE` | Active LIVE session confirmed | Stop |
| `STOPPING` | Graceful stop requested; bot is closing | Force Stop after timeout |
| `FINALIZING` | Bot exited safely; wrapper is persisting and analyzing | None |
| `ERROR` | Launch, runtime, or persistence failed | Start when no process remains; retain error banner |

Transitions are serialized. An atomic run lock is acquired before spawning any process. A second START while any run or finalizer is active returns a conflict and never launches another child. Repeated STOP requests are idempotent.

## Start Flow

1. The UI sends a same-origin JSON POST with the requested PAPER or LIVE mode.
2. The controller verifies the CSRF token, local origin, current `STOPPED`/inactive state, and absence of a valid run lock.
3. It creates the run ID and `active-run.json` atomically, audits the request, and enters `STARTING`.
4. It launches the non-interactive wrapper with the temporary mode override and embedded UI disabled.
5. The bot publishes a heartbeat containing the matching run ID, explicit mode, PID, and telemetry session ID.
6. The controller changes to `PAPER` or `LIVE` only after that structured handshake.
7. A launch timeout, early process exit, or mode/run-ID mismatch moves the controller to `ERROR`, records diagnostics, and releases the run lock once no managed process remains.

`codex_machine.ps1` performs the build before starting the controller, so normal button starts use `-SkipBuild` and do not pay the build cost for every session.

## Graceful Stop and Finalization

1. STOP changes the state to `STOPPING`, writes an audited stop request for the exact active run ID, and disables repeated UI actions.
2. The bot consumes that request once and enters the same guarded shutdown path used by SIGINT/SIGTERM.
3. If a position is open, the bot attempts its current bounded manual exit.
4. LIVE writes its shutdown balance checkpoint; PAPER persists its ending balance and `bot.shutdown` event.
5. The bot marks the heartbeat as shutdown-complete and exits.
6. While `run_bot.ps1` derives and persists the session, validates signals, analyzes trades, and performs optional upload, the controller shows `FINALIZING`.
7. The controller shows `STOPPED` only after the wrapper exits successfully. A persistence/finalization failure is shown as `ERROR` and is never labeled a successful stop.

The bot shutdown handler must be re-entry safe so a file request and an operating-system signal cannot execute shutdown twice.

## Force Stop

If the bot has not completed graceful shutdown 30 seconds after STOP, CODEX exposes a separate `FORCE STOP` button. It is never invoked automatically.

Force Stop terminates the managed Windows process tree, records an `unclean` audit result, and presents a prominent warning that telemetry, open-position handling, or database persistence may be incomplete. It does not claim that the session finalized successfully. The control lock is released only after the process tree is confirmed absent.

The 30-second force timeout applies to `STOPPING`, not normal `FINALIZING`; post-run persistence and analysis must not be mistaken for a hung trading process.

## Local Control API

All routes are under the existing route base:

- `GET /terminal-v5/api/control/bootstrap` — current state plus a same-origin CSRF token.
- `GET /terminal-v5/api/control/status` — authoritative state without mutating anything.
- `POST /terminal-v5/api/control/start` — body `{ "mode": "PAPER" | "LIVE" }`.
- `POST /terminal-v5/api/control/stop` — requests graceful shutdown.
- `POST /terminal-v5/api/control/force-stop` — explicit process-tree termination after eligibility.

Security requirements:

- Listen on `127.0.0.1`, never an unspecified interface.
- Accept only `localhost`/`127.0.0.1` Host values for the actual bound port.
- Do not enable cross-origin access.
- Require same-origin `Origin` for mutations.
- Require `application/json` and a controller-generated CSRF token for POSTs.
- Reject invalid modes, stale run IDs, unavailable actions, and malformed bodies.
- Never expose secrets or the complete inherited environment in API responses or logs.

## CODEX User Interface

The controls belong in the CODEX masthead/status area so mode and runtime authority are visible before the activity feed:

- In `STOPPED`, show `START PAPER` and a visually distinct orange/red `START LIVE`.
- Per the approved requirement, LIVE starts immediately without a confirmation dialog or automatic readiness preflight.
- In `PAPER` or `LIVE`, replace both start buttons with `STOP`.
- In `STARTING`, `STOPPING`, and `FINALIZING`, disable conflicting actions and show the current operation.
- Expose `FORCE STOP` only after the graceful-stop timeout.
- Show run ID, telemetry session ID, wrapper/bot PID, start time, heartbeat freshness, and mode source `CONTROL OVERRIDE`.
- Keep the active mode unmistakable throughout the page; do not infer it from button state or color alone.
- Surface launch, runtime, persistence, and forced-stop errors in the activity/log area.

The controller retains a bounded stdout/stderr buffer for the active/latest run so CODEX can show useful diagnostics without unbounded memory growth.

## Restart Recovery

On controller startup:

1. Inspect the controller and active-run locks.
2. Validate recorded PIDs and process start times.
3. Read the matching bot heartbeat and its freshness.
4. If the bot is active, reconstruct `PAPER`, `LIVE`, or `STOPPING` and continue monitoring it.
5. If the bot has exited but the wrapper is still active, reconstruct `FINALIZING`.
6. Remove stale locks only after confirming the recorded processes are absent.
7. Preserve and display the last error or unclean-stop result.

Closing the browser never affects the controller or bot. If the controller itself exits, the bot continues. Restarting `codex_machine.ps1` reconnects using the runtime records rather than starting a duplicate bot.

## Error Handling

- Spawn failure: enter `ERROR`, release inactive locks, and return actionable diagnostics.
- Startup timeout: stop tracking the attempted run only after confirming its process is absent; otherwise retain a guarded error state.
- Heartbeat stale with a live PID: show degraded/unresponsive state and keep START disabled.
- Wrapper nonzero exit: distinguish bot runtime failure from post-run persistence failure when the wrapper output makes that distinction available.
- Control-file write failure: do not pretend STOP was delivered.
- Persistence failure: retain the session/run identifiers and provide the wrapper error; never report `STOPPED` success.
- Controller restart: recovery is conservative—uncertainty blocks a second START until the prior process is proven absent.

## Audit Events

`control-audit.jsonl` records at least:

- controller start/recovery/exit;
- start requested, accepted, rejected, launched, and confirmed;
- requested mode and authoritative source;
- graceful stop requested, observed, and completed;
- transition to finalization and its result;
- force-stop eligibility, request, and result;
- stale-lock decisions and recovery outcomes;
- errors with sanitized details.

Records include timestamps, run ID when applicable, session ID when known, and process identifiers. Secrets and private keys are prohibited.

## Testing Strategy

Automated tests must use fake child processes and temporary directories; they must never start real LIVE trading.

Coverage includes:

- state-machine transitions and invalid transitions;
- atomic single-instance behavior and concurrent START attempts;
- temporary PAPER/LIVE override without changing `.env`;
- unchanged manual launcher behavior with `.env` authority;
- structured startup handshake and mode/run-ID mismatch rejection;
- targeted, idempotent graceful STOP;
- shutdown re-entry protection;
- 30-second force-stop eligibility and explicit-only execution;
- distinction between `STOPPING` and `FINALIZING`;
- wrapper success and persistence-failure handling;
- recovery from controller restart, active bot, finalizer, stale heartbeat, and stale lock;
- loopback binding, Host/Origin checks, JSON enforcement, and CSRF rejection;
- CODEX button visibility, disabled states, status rendering, and error rendering;
- TypeScript and React production builds.

## Acceptance Criteria

- `codex_machine.ps1` opens a CODEX page that remains available with no bot running.
- PAPER and LIVE can each be launched from their button, one at a time.
- Controlled mode selection does not edit `.env`.
- Manual `run_bot.ps1` still takes its mode from `.env`.
- The UI does not mark a run active until mode and run ID are confirmed by the bot.
- STOP completes the existing shutdown and `run_bot.ps1` persistence workflow before showing success.
- Force Stop is hidden for 30 seconds, requires an explicit click, and marks the run unclean.
- A controller restart does not launch a duplicate bot and recovers the active state.
- Control endpoints cannot be reached through a non-loopback bind or accepted cross-origin mutation.
- Tests exercise only simulated processes and cannot place real orders.
