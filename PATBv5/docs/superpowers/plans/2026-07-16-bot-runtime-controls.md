# CODEX Bot Runtime Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add loopback-only CODEX controls that start exactly one PAPER or LIVE PATBv5 run, stop it through the existing graceful persistence path, and remain available while the bot is stopped.

**Architecture:** A separate Node/TypeScript controller serves the CODEX UI and owns a file-backed runtime state machine. It launches `run_bot.ps1` in an explicit non-interactive controlled mode, coordinates graceful stop with a run-scoped heartbeat/request channel, and exposes a same-origin CSRF-protected API to the React controls.

**Tech Stack:** Windows PowerShell 5.1+, Node.js 20+, TypeScript/CommonJS backend, native Node HTTP and child-process APIs, React 18/Vite 5 frontend, JSON/JSONL runtime records, existing standalone `tsx` and PowerShell test harnesses.

## Global Constraints

- Prerequisite: complete `docs/superpowers/plans/2026-07-16-codex-live-terminal.md` before this plan; it creates the CODEX page and components extended here.
- The controller listens on `127.0.0.1` only; runtime control is never exposed to the LAN.
- Exactly one bot/finalizer may be active at a time.
- Controlled PAPER/LIVE selection is temporary and never edits `.env`.
- Manual `run_bot.ps1` launches continue taking `PAPER_TRADING` authoritatively from `.env`.
- LIVE starts immediately when clicked: no typed confirmation and no automatic `check:live-readiness` run.
- STOP uses the current bounded position exit, balance/checkpoint, telemetry shutdown, PostgreSQL persistence, validation, analysis, and optional upload path.
- `FORCE STOP` appears only after 30,000 ms in `STOPPING`, is never automatic, and records an unclean result.
- `FINALIZING` is distinct from `STOPPING`; normal post-run work must not expose Force Stop.
- Runtime mode must be explicit (`CONTROL OVERRIDE` or `bot.startup`), never inferred as LIVE from missing data.
- Automated tests use fake processes and temporary directories and must never launch real trading.
- Existing unrelated worktree changes and generated evaluation artifacts are never staged by this plan.

## File Structure

### Shared runtime-control domain

- Create `src/control/contracts.ts`: stable runtime records, API state, and process-adapter interfaces.
- Create `src/control/runtimeStore.ts`: atomic JSON/JSONL persistence and exclusive locks.
- Create `src/control/botRuntimeControl.ts`: bot heartbeat and targeted stop-request watcher.
- Create `src/control/shutdownCoordinator.ts`: re-entry-safe shutdown coordinator.
- Create `src/control/runtimeController.ts`: controller state machine and recovery rules.
- Create `src/control/windowsProcessAdapter.ts`: detached PowerShell launch, PID identity checks, logs, and explicit process-tree kill.
- Create `src/control/httpServer.ts`: loopback server, control API, request security, and existing UI delegation.
- Create `src/control/index.ts`: production composition and controller lifecycle.

### Existing runtime integration

- Modify `src/index.ts`: publish controlled identity, start heartbeat, and route signals/control requests through one shutdown coordinator.
- Modify `scripts/runtime_env.ps1`: resolve explicit controlled mode without weakening manual `.env` authority.
- Modify `run_bot.ps1`: controlled parameters, non-interactive path, runtime environment, and wrapper-result record.
- Modify `src/ui/server.ts`: export the current UI handler/config helpers without changing legacy embedded behavior.
- Create `codex_machine.ps1`: build and start the independent controller.
- Modify `.gitignore`: ignore `polydb/runtime/`.
- Modify `package.json`: controller commands and focused test commands.

### CODEX client

- Modify `newGui/src/types.ts`: mirror the control API contract.
- Create `newGui/src/lib/controlApi.ts`: bootstrap/status/mutation client.
- Create `newGui/src/hooks/useBotControl.ts`: one-second control-state polling and actions.
- Create `newGui/src/components/codex/CodexRuntimeControls.tsx`: state-aware buttons and diagnostics.
- Modify `newGui/src/components/codex/CodexLiveView.tsx`: render controls even when telemetry is unavailable.
- Modify `newGui/src/pages/CodexLivePage.tsx`: connect the control hook.
- Modify `newGui/src/styles/codex.css`: approved button, state, error, and responsive styles.

### Tests

- Create `tests/control_runtime_store.test.ts`.
- Create `tests/control_bot_runtime.test.ts`.
- Create `tests/control_shutdown_coordinator.test.ts`.
- Create `scripts/check_controlled_launcher.ps1`.
- Create `tests/control_runtime_controller.test.ts`.
- Create `tests/control_windows_process.test.ts`.
- Create `tests/control_http_server.test.ts`.
- Create `newGui/tests/codex_runtime_controls.test.tsx`.
- Create `scripts/check_codex_machine.ps1`.

---

### Task 1: Define the runtime records and atomic store

**Files:**
- Create: `PATBv5/src/control/contracts.ts`
- Create: `PATBv5/src/control/runtimeStore.ts`
- Create: `PATBv5/tests/control_runtime_store.test.ts`
- Modify: `PATBv5/.gitignore`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces: `createControlPaths(controlDir)`, `ControlRuntimeStore`, and all shared record types.
- Consumes: only a caller-provided runtime directory; tests never touch the real `polydb/runtime` tree.

- [ ] **Step 1: Write the failing store test**

Create `tests/control_runtime_store.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlRuntimeStore, createControlPaths } from "../src/control/runtimeStore";
import type { ActiveRunRecord } from "../src/control/contracts";

async function run(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "patbv5-control-store-"));
  try {
    const paths = createControlPaths(root);
    const store = new ControlRuntimeStore(paths);
    await store.ensure();

    await store.acquireControllerLock({ pid: 100, startedAt: "2026-07-16T20:00:00.000Z" });
    await assert.rejects(
      store.acquireControllerLock({ pid: 101, startedAt: "2026-07-16T20:00:01.000Z" }),
      /controller lock already exists/i,
    );

    const active: ActiveRunRecord = {
      schemaVersion: 1,
      runId: "11111111-1111-4111-8111-111111111111",
      requestedMode: "PAPER",
      modeSource: "CONTROL_OVERRIDE",
      requestedAt: "2026-07-16T20:01:00.000Z",
      wrapper: null,
      stopRequestedAt: null,
      forceEligibleAt: null,
      logPath: join(paths.logsDir, "run.log"),
    };
    await store.createActiveRun(active);
    await assert.rejects(store.createActiveRun(active), /active run already exists/i);
    assert.deepEqual(await store.readActiveRun(), active);

    await store.writeStopRequest({ schemaVersion: 1, runId: active.runId, requestedAt: "2026-07-16T20:02:00.000Z" });
    assert.equal((await store.readStopRequest())?.runId, active.runId);
    await store.clearStopRequest(active.runId);
    assert.equal(await store.readStopRequest(), null);

    await store.appendAudit({
      schemaVersion: 1,
      timestamp: "2026-07-16T20:02:01.000Z",
      action: "stop.requested",
      outcome: "accepted",
      runId: active.runId,
      sessionId: null,
      detail: null,
    });
    const audit = await readFile(paths.audit, "utf8");
    assert.match(audit, /stop\.requested/);

    assert.equal(await store.clearActiveRun("different-run"), false);
    assert.equal(await store.clearActiveRun(active.runId), true);
    assert.equal(await store.readActiveRun(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npx tsx tests/control_runtime_store.test.ts`  
Expected: FAIL with missing `src/control/runtimeStore`.

- [ ] **Step 3: Define the exact shared contracts**

Create `src/control/contracts.ts` with these exported names and fields:

```ts
export const CONTROL_SCHEMA_VERSION = 1 as const;
export const GRACEFUL_STOP_TIMEOUT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 1_000;
export const STOP_POLL_INTERVAL_MS = 250;
export const HEARTBEAT_STALE_MS = 5_000;

export type RequestedMode = "PAPER" | "LIVE";
export type ControllerState = "STOPPED" | "STARTING" | "PAPER" | "LIVE" | "STOPPING" | "FINALIZING" | "ERROR";
export type BotRuntimeState = "RUNNING" | "STOPPING" | "SHUTDOWN_COMPLETE";
export type WrapperOutcome = "COMPLETE" | "ERROR" | "UNCLEAN";

export interface ProcessIdentity { pid: number; startedAt: string; }
export interface ActiveRunRecord {
  schemaVersion: 1;
  runId: string;
  requestedMode: RequestedMode;
  modeSource: "CONTROL_OVERRIDE";
  requestedAt: string;
  wrapper: ProcessIdentity | null;
  stopRequestedAt: string | null;
  forceEligibleAt: string | null;
  logPath: string;
}
export interface BotHeartbeat {
  schemaVersion: 1;
  runId: string;
  mode: RequestedMode;
  sessionId: string;
  bot: ProcessIdentity;
  status: BotRuntimeState;
  updatedAt: string;
}
export interface StopRequest { schemaVersion: 1; runId: string; requestedAt: string; }
export interface WrapperResult {
  schemaVersion: 1;
  runId: string;
  outcome: WrapperOutcome;
  botExitCode: number;
  finalExitCode: number;
  persistenceSucceeded: boolean;
  completedAt: string;
  error: string | null;
}
export interface PersistedControllerState {
  schemaVersion: 1;
  lastRunId: string | null;
  lastOutcome: WrapperOutcome | null;
  lastError: string | null;
  updatedAt: string;
}
export interface ControlAuditRecord {
  schemaVersion: 1;
  timestamp: string;
  action: string;
  outcome: "accepted" | "rejected" | "completed" | "failed" | "recovered";
  runId: string | null;
  sessionId: string | null;
  detail: string | null;
}
export interface ControlRunView {
  runId: string;
  requestedMode: RequestedMode;
  modeSource: "CONTROL_OVERRIDE";
  requestedAt: string;
  wrapperPid: number | null;
  botPid: number | null;
  sessionId: string | null;
  heartbeatUpdatedAt: string | null;
}
export interface ControlStatus {
  state: ControllerState;
  canStart: boolean;
  canStop: boolean;
  canForceStop: boolean;
  activeRun: ControlRunView | null;
  error: string | null;
  logTail: string[];
}
export interface SpawnRunRequest {
  repoRoot: string;
  controlDir: string;
  runId: string;
  mode: RequestedMode;
  logPath: string;
}
export interface WrapperHandle {
  identity: ProcessIdentity;
  completion: Promise<{ exitCode: number; signal: string | null }>;
}
export type ProcessInspection = "alive" | "absent" | "identity_mismatch";
export interface RuntimeProcessAdapter {
  currentIdentity(): Promise<ProcessIdentity>;
  spawnRun(request: SpawnRunRequest): Promise<WrapperHandle>;
  inspect(identity: ProcessIdentity): Promise<ProcessInspection>;
  forceKillTree(identity: ProcessIdentity): Promise<void>;
}
```

- [ ] **Step 4: Implement atomic runtime persistence**

Create `src/control/runtimeStore.ts`. Export this exact path contract and class surface:

```ts
export interface ControlPaths {
  controlDir: string;
  controllerLock: string;
  activeRun: string;
  heartbeat: string;
  stopRequest: string;
  wrapperResult: string;
  controllerState: string;
  audit: string;
  logsDir: string;
}

export function createControlPaths(controlDir: string): ControlPaths;

export class ControlRuntimeStore {
  constructor(readonly paths: ControlPaths);
  ensure(): Promise<void>;
  acquireControllerLock(identity: ProcessIdentity): Promise<void>;
  readControllerLock(): Promise<ProcessIdentity | null>;
  releaseControllerLock(identity: ProcessIdentity): Promise<boolean>;
  createActiveRun(record: ActiveRunRecord): Promise<void>;
  readActiveRun(): Promise<ActiveRunRecord | null>;
  writeActiveRun(record: ActiveRunRecord): Promise<void>;
  clearActiveRun(runId: string): Promise<boolean>;
  readHeartbeat(): Promise<BotHeartbeat | null>;
  writeHeartbeat(record: BotHeartbeat): Promise<void>;
  readStopRequest(): Promise<StopRequest | null>;
  writeStopRequest(record: StopRequest): Promise<void>;
  clearStopRequest(runId: string): Promise<boolean>;
  readWrapperResult(): Promise<WrapperResult | null>;
  writeWrapperResult(record: WrapperResult): Promise<void>;
  readControllerState(): Promise<PersistedControllerState | null>;
  writeControllerState(record: PersistedControllerState): Promise<void>;
  appendAudit(record: ControlAuditRecord): Promise<void>;
  readLogTail(path: string, maxLines?: number): Promise<string[]>;
}
```

Implementation rules are exact:

- `ensure()` creates `controlDir` and `logsDir` recursively.
- Exclusive files use `open(path, "wx")`; translate `EEXIST` into `controller lock already exists` or `active run already exists`.
- Mutable JSON writes use `<target>.<pid>.<uuid>.tmp`, `writeFile`, then `rename`.
- Missing files return `null`; malformed JSON throws and is never treated as absent.
- `clear*` reads the record first and removes it only when `runId`/identity matches.
- Audit appends one compact JSON object plus `\n`.
- `readLogTail` returns at most 200 non-secret lines by default and returns `[]` for a missing log.

- [ ] **Step 5: Ignore runtime state and add the focused command**

Append to `.gitignore`:

```gitignore
polydb/runtime/
```

Add to `package.json`:

```json
"test:control-store": "tsx scripts/run_isolated_test.ts tests/control_runtime_store.test.ts"
```

- [ ] **Step 6: Run the focused test and build**

Run: `npm run test:control-store && npm run build`  
Expected: PASS; `dist/control/contracts.js` and `dist/control/runtimeStore.js` exist.

- [ ] **Step 7: Commit the store**

```powershell
git add PATBv5/src/control/contracts.ts PATBv5/src/control/runtimeStore.ts PATBv5/tests/control_runtime_store.test.ts PATBv5/.gitignore PATBv5/package.json
git commit -m "feat: add runtime control store"
```

---

### Task 2: Add the bot heartbeat and targeted stop channel

**Files:**
- Create: `PATBv5/src/control/botRuntimeControl.ts`
- Create: `PATBv5/tests/control_bot_runtime.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: `ControlRuntimeStore`, a run ID, explicit mode, session ID, bot identity, and `onStop` callback.
- Produces: `readControlledRunConfig()` and `createBotRuntimeControl()`.

- [ ] **Step 1: Write the failing bot-channel test**

Create `tests/control_bot_runtime.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBotRuntimeControl, readControlledRunConfig } from "../src/control/botRuntimeControl";
import { ControlRuntimeStore, createControlPaths } from "../src/control/runtimeStore";

async function run(): Promise<void> {
  assert.equal(readControlledRunConfig({}), null);
  assert.throws(
    () => readControlledRunConfig({ CODEX_CONTROL_RUN_ID: "bad", CODEX_CONTROL_DIR: "C:\\runtime" }),
    /valid UUID/i,
  );

  const root = await mkdtemp(join(tmpdir(), "patbv5-bot-control-"));
  try {
    const store = new ControlRuntimeStore(createControlPaths(root));
    await store.ensure();
    let stopCalls = 0;
    const control = createBotRuntimeControl({
      store,
      runId: "11111111-1111-4111-8111-111111111111",
      mode: "PAPER",
      sessionId: "session-one",
      bot: { pid: 4242, startedAt: "2026-07-16T20:00:00.000Z" },
      now: () => Date.parse("2026-07-16T20:00:01.000Z"),
      onStop: async () => { stopCalls += 1; },
      autoStart: false,
    });

    await control.publish("RUNNING");
    assert.equal((await store.readHeartbeat())?.status, "RUNNING");

    await store.writeStopRequest({ schemaVersion: 1, runId: "stale-run", requestedAt: "2026-07-16T20:00:02.000Z" });
    assert.equal(await control.pollStopRequest(), false);
    assert.equal(stopCalls, 0);

    await store.writeStopRequest({ schemaVersion: 1, runId: control.runId, requestedAt: "2026-07-16T20:00:03.000Z" });
    assert.equal(await control.pollStopRequest(), true);
    assert.equal(await control.pollStopRequest(), false);
    assert.equal(stopCalls, 1);
    assert.equal((await store.readHeartbeat())?.status, "STOPPING");

    await control.publish("SHUTDOWN_COMPLETE");
    await control.close();
    assert.equal((await store.readHeartbeat())?.status, "SHUTDOWN_COMPLETE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run: `npx tsx tests/control_bot_runtime.test.ts`  
Expected: FAIL with missing `botRuntimeControl`.

- [ ] **Step 3: Implement environment validation and the bot handle**

Create `src/control/botRuntimeControl.ts` with this public surface:

```ts
export interface ControlledRunConfig { runId: string; controlDir: string; }
export interface BotRuntimeControlOptions {
  store: ControlRuntimeStore;
  runId: string;
  mode: RequestedMode;
  sessionId: string;
  bot: ProcessIdentity;
  onStop: () => Promise<void>;
  now?: () => number;
  autoStart?: boolean;
}
export interface BotRuntimeControl {
  readonly runId: string;
  publish(status: BotRuntimeState): Promise<void>;
  pollStopRequest(): Promise<boolean>;
  close(): Promise<void>;
}
export function readControlledRunConfig(env?: NodeJS.ProcessEnv): ControlledRunConfig | null;
export function createBotRuntimeControl(options: BotRuntimeControlOptions): BotRuntimeControl;
```

Use `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` for the run ID. Both control environment values must be present together; the directory must resolve to an absolute path.

`createBotRuntimeControl` must:

- publish heartbeat every 1,000 ms and poll STOP every 250 ms when `autoStart !== false`;
- call `unref()` on both timers;
- ignore a stop request for another run without deleting it;
- atomically change heartbeat to `STOPPING`, remove the matching request, and call `onStop` once;
- keep the final `SHUTDOWN_COMPLETE` heartbeat after `close()`;
- serialize publish/poll operations so interval overlap cannot invoke `onStop` twice.

- [ ] **Step 4: Add the test command and verify**

Add:

```json
"test:control-bot": "tsx scripts/run_isolated_test.ts tests/control_bot_runtime.test.ts"
```

Run: `npm run test:control-bot && npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit the bot channel**

```powershell
git add PATBv5/src/control/botRuntimeControl.ts PATBv5/tests/control_bot_runtime.test.ts PATBv5/package.json
git commit -m "feat: add bot runtime control channel"
```

---

### Task 3: Route every shutdown source through one guarded path

**Files:**
- Create: `PATBv5/src/control/shutdownCoordinator.ts`
- Create: `PATBv5/tests/control_shutdown_coordinator.test.ts`
- Modify: `PATBv5/src/index.ts:336-349,640-723`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces: `createShutdownCoordinator(runShutdown)` returning an idempotent async shutdown requester.
- Integrates: SIGINT, SIGTERM, and controlled STOP with the existing trade-exit and persistence code.

- [ ] **Step 1: Write the failing coordinator test**

```ts
import assert from "node:assert/strict";
import { createShutdownCoordinator } from "../src/control/shutdownCoordinator";

async function run(): Promise<void> {
  let calls = 0;
  let observedReason = "";
  const requestShutdown = createShutdownCoordinator(async (reason) => {
    calls += 1;
    observedReason = reason;
    await Promise.resolve();
  });
  await Promise.all([requestShutdown("CONTROL_STOP"), requestShutdown("SIGINT"), requestShutdown("SIGTERM")]);
  assert.equal(calls, 1);
  assert.equal(observedReason, "CONTROL_STOP");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx tsx tests/control_shutdown_coordinator.test.ts`  
Expected: FAIL with missing `shutdownCoordinator`.

- [ ] **Step 3: Implement the coordinator**

Create `src/control/shutdownCoordinator.ts`:

```ts
export function createShutdownCoordinator(
  runShutdown: (reason: string) => Promise<void>,
): (reason: string) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return (reason: string) => {
    if (!inFlight) inFlight = runShutdown(reason);
    return inFlight;
  };
}
```

- [ ] **Step 4: Integrate controlled identity and heartbeat in `src/index.ts`**

Import `createBotRuntimeControl`, `readControlledRunConfig`, `createControlPaths`, `ControlRuntimeStore`, and `createShutdownCoordinator`. Immediately after `runtimeMode` is known, resolve the controlled configuration and declare the handle:

```ts
const controlledRun = readControlledRunConfig();
let botRuntimeControl: ReturnType<typeof createBotRuntimeControl> | null = null;
```

Replace `handleSignal` with one coordinator. Keep the current five-second position-exit race, LIVE balance checkpoint, and PAPER persistence unchanged inside it; add only the status publication and generalized copy:

```ts
const requestShutdown = createShutdownCoordinator(async (reason) => {
  console.log(chalk.yellow(`Received ${reason}. Saving session state before exit...`));
  await botRuntimeControl?.publish("STOPPING");
  if (
    activeTrade
    && (activeTrade.holdingStatus === Market.Up || activeTrade.holdingStatus === Market.Down)
    && activeTrade.share > 0
  ) {
    try {
      activeTrade.setPendingExitIntent("manual", `shutdown_signal:${reason}`);
      const exitPromise = activeTrade.holdingStatus === Market.Up
        ? activeTrade.sellUpToken()
        : activeTrade.sellDownToken();
      await Promise.race([
        exitPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("manual exit timeout")), 5_000)),
      ]);
    } catch (error) {
      console.error(chalk.yellow(
        `Manual exit attempt failed during ${reason}: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  }
  if (!PAPER_TRADING && activeTrade?.authorizedClob) {
    await writeLiveBalanceCheckpoint({
      client: activeTrade.authorizedClob,
      reason: `shutdown_${reason}`,
      marketSlug: activeTrade.marketSlug,
      upTokenId: activeTrade.upTokenId,
      downTokenId: activeTrade.downTokenId,
    });
  }
  await persistPaperBalance(reason);
  await botRuntimeControl?.publish("SHUTDOWN_COMPLETE");
  await botRuntimeControl?.close();
  process.exit(0);
});
```

Register both signals against `requestShutdown`. Add `controlRunId` and `modeSource` to `bot.startup`:

```ts
controlRunId: controlledRun?.runId ?? null,
modeSource: controlledRun ? "CONTROL_OVERRIDE" : "ENV_FILE",
```

Immediately after the two startup telemetry events, start the channel only for a controlled run:

```ts
if (controlledRun) {
  const sessionId = getTelemetrySession()?.id;
  if (!sessionId) throw new Error("Controlled run cannot start without a telemetry session ID");
  const store = new ControlRuntimeStore(createControlPaths(controlledRun.controlDir));
  await store.ensure();
  botRuntimeControl = createBotRuntimeControl({
    store,
    runId: controlledRun.runId,
    mode: runtimeMode,
    sessionId,
    bot: {
      pid: process.pid,
      startedAt: new Date(Date.now() - process.uptime() * 1_000).toISOString(),
    },
    onStop: () => requestShutdown("CONTROL_STOP"),
  });
  await botRuntimeControl.publish("RUNNING");
}
```

- [ ] **Step 5: Add the focused command and verify**

Add:

```json
"test:control-shutdown": "tsx scripts/run_isolated_test.ts tests/control_shutdown_coordinator.test.ts"
```

Run: `npm run test:control-shutdown && npm run test:lifecycle && npm run build`  
Expected: PASS; lifecycle behavior remains intact.

- [ ] **Step 6: Commit shutdown integration**

```powershell
git add PATBv5/src/control/shutdownCoordinator.ts PATBv5/src/index.ts PATBv5/tests/control_shutdown_coordinator.test.ts PATBv5/package.json
git commit -m "feat: accept graceful controlled shutdown"
```

---

### Task 4: Add a safe non-interactive controlled launcher mode

**Files:**
- Modify: `PATBv5/scripts/runtime_env.ps1`
- Modify: `PATBv5/run_bot.ps1:1-32,151-205,235-244`
- Create: `PATBv5/scripts/check_controlled_launcher.ps1`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces: optional `run_bot.ps1 -Mode -RunId -ControlDirectory -NonInteractive -SkipBuild -DisableEmbeddedUi` behavior.
- Preserves: no-argument launch behavior and `.env` authority.

- [ ] **Step 1: Write the failing PowerShell contract test**

Create `scripts/check_controlled_launcher.ps1`. It must dot-source `runtime_env.ps1`, create a temporary `.env`, and assert these cases:

```powershell
$manual = Resolve-EffectiveTradingMode -EnvValue "false" -SourcePath $envFile
Assert-Equal $manual.Name "LIVE" "manual mode must use env"
Assert-Equal $manual.Source "ENV_FILE" "manual source"
Assert-Equal $manual.PaperTradingValue "false" "manual paper value"

$paper = Resolve-EffectiveTradingMode -EnvValue "false" -SourcePath $envFile -RequestedMode "PAPER"
Assert-Equal $paper.Name "PAPER" "controlled PAPER override"
Assert-Equal $paper.Source "CONTROL_OVERRIDE" "controlled source"
Assert-Equal $paper.PaperTradingValue "true" "controlled PAPER value"

$live = Resolve-EffectiveTradingMode -EnvValue "true" -SourcePath $envFile -RequestedMode "LIVE"
Assert-Equal $live.Name "LIVE" "controlled LIVE override"
Assert-Equal $live.PaperTradingValue "false" "controlled LIVE value"
```

Read `run_bot.ps1 -Raw` and assert that it contains every controlled parameter, sets `CODEX_CONTROL_RUN_ID`/`CODEX_CONTROL_DIR`, branches all `Read-Host` calls behind `-not $NonInteractive`, and never calls `Set-Content` against `$RuntimeEnvPath`.

- [ ] **Step 2: Run and verify the missing-helper failure**

Run: `powershell -NoProfile -File scripts/check_controlled_launcher.ps1`  
Expected: FAIL because `Resolve-EffectiveTradingMode` does not exist.

- [ ] **Step 3: Add effective-mode resolution without changing the old resolver**

Append to `scripts/runtime_env.ps1`:

```powershell
function Resolve-EffectiveTradingMode {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$EnvValue,
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [ValidateSet("PAPER", "LIVE")][string]$RequestedMode
    )
    $envMode = Resolve-TradingMode -Value $EnvValue -SourcePath $SourcePath
    if ([string]::IsNullOrWhiteSpace($RequestedMode)) {
        return [pscustomobject]@{
            Name = $envMode
            Source = "ENV_FILE"
            PaperTradingValue = if ($envMode -eq "PAPER") { "true" } else { "false" }
        }
    }
    return [pscustomobject]@{
        Name = $RequestedMode
        Source = "CONTROL_OVERRIDE"
        PaperTradingValue = if ($RequestedMode -eq "PAPER") { "true" } else { "false" }
    }
}
```

- [ ] **Step 4: Add controlled parameters and runtime environment**

Add this parameter block as the first executable statement in `run_bot.ps1`:

```powershell
param(
    [ValidateSet("PAPER", "LIVE")][string]$Mode,
    [string]$RunId,
    [string]$ControlDirectory,
    [switch]$NonInteractive,
    [switch]$SkipBuild,
    [switch]$DisableEmbeddedUi
)
```

After importing `.env`, resolve and apply the effective mode:

```powershell
$EffectiveMode = Resolve-EffectiveTradingMode -EnvValue $env:PAPER_TRADING -SourcePath $RuntimeEnvPath -RequestedMode $Mode
$TradingMode = $EffectiveMode.Name
$env:PAPER_TRADING = $EffectiveMode.PaperTradingValue

$ControlledRun = -not [string]::IsNullOrWhiteSpace($Mode)
if ($ControlledRun) {
    if ($RunId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
        throw "Controlled run requires a valid version-4 -RunId UUID."
    }
    if ([string]::IsNullOrWhiteSpace($ControlDirectory)) { throw "Controlled run requires -ControlDirectory." }
    $env:CODEX_CONTROL_RUN_ID = $RunId.ToLowerInvariant()
    $env:CODEX_CONTROL_DIR = [System.IO.Path]::GetFullPath($ControlDirectory)
    $env:TRADING_MODE_SOURCE = "CONTROL_OVERRIDE"
}
```

`Write-Host` must display `source=$($EffectiveMode.Source)`. When `DisableEmbeddedUi`, set both UI environment values to `0`. When `NonInteractive`, skip the UI prompt and final pause. When `SkipBuild`, skip only `npm run build`; never skip bot execution or finalization.

- [ ] **Step 5: Persist a wrapper result for recovery**

Declare `$PersistenceError = $null` beside `$PersistenceSucceeded`, then assign `$PersistenceError = $_.Exception.Message` in the existing persistence catch. For controlled runs, atomically write `wrapper-result.json` under the control directory immediately before the final exit. Use a temporary sibling plus `Move-Item -Force`. The JSON shape must match `WrapperResult` exactly:

```powershell
$WrapperResult = [ordered]@{
    schemaVersion = 1
    runId = $env:CODEX_CONTROL_RUN_ID
    outcome = if ($BotExitCode -eq 0 -and $PersistenceSucceeded) { "COMPLETE" } else { "ERROR" }
    botExitCode = $BotExitCode
    finalExitCode = $FinalExitCode
    persistenceSucceeded = $PersistenceSucceeded
    completedAt = [datetime]::UtcNow.ToString("o")
    error = if ($PersistenceSucceeded) { $null } elseif ($PersistenceError) { $PersistenceError } else { "Session persistence did not complete." }
}
```

Do not remove or bypass the existing `finally` block.

- [ ] **Step 6: Add and run launcher verification**

Add:

```json
"test:controlled-launcher": "powershell -NoProfile -File scripts/check_controlled_launcher.ps1"
```

Run: `npm run test:controlled-launcher && npm run test:run-bot-launcher`  
Expected: PASS. Neither test launches the bot.

- [ ] **Step 7: Commit the controlled launcher**

```powershell
git add PATBv5/scripts/runtime_env.ps1 PATBv5/run_bot.ps1 PATBv5/scripts/check_controlled_launcher.ps1 PATBv5/package.json
git commit -m "feat: add controlled bot launcher mode"
```

---

### Task 5: Implement the recoverable controller state machine

**Files:**
- Create: `PATBv5/src/control/runtimeController.ts`
- Create: `PATBv5/tests/control_runtime_controller.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: `ControlRuntimeStore`, `RuntimeProcessAdapter`, repo root, clock, and UUID factory.
- Produces: `RuntimeController.initialize/status/start/stop/forceStop/reconcile`.

- [ ] **Step 1: Write the failing state-machine test with a fake adapter**

Create a fake adapter implementing `RuntimeProcessAdapter`; it records spawns/kills and exposes mutable `ProcessInspection`. The test must execute this exact sequence:

```ts
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ProcessIdentity,
  ProcessInspection,
  RuntimeProcessAdapter,
  SpawnRunRequest,
  WrapperHandle,
} from "../src/control/contracts";
import { ControlRuntimeStore, createControlPaths } from "../src/control/runtimeStore";
import { RuntimeController } from "../src/control/runtimeController";

class ManualClock {
  private value: number;
  constructor(iso: string) { this.value = Date.parse(iso); }
  now(): number { return this.value; }
  iso(): string { return new Date(this.value).toISOString(); }
  advance(ms: number): void { this.value += ms; }
}

class FakeProcessAdapter implements RuntimeProcessAdapter {
  readonly spawns: SpawnRunRequest[] = [];
  readonly kills: ProcessIdentity[] = [];
  private readonly states = new Map<number, ProcessInspection>();
  constructor(private readonly nextWrapper: ProcessIdentity) {}
  async currentIdentity(): Promise<ProcessIdentity> {
    return { pid: 999, startedAt: "2026-07-16T19:59:00.000Z" };
  }
  async spawnRun(request: SpawnRunRequest): Promise<WrapperHandle> {
    this.spawns.push(request);
    this.markAlive(this.nextWrapper);
    return {
      identity: this.nextWrapper,
      completion: new Promise<{ exitCode: number; signal: string | null }>(() => undefined),
    };
  }
  async inspect(identity: ProcessIdentity): Promise<ProcessInspection> {
    return this.states.get(identity.pid) ?? "absent";
  }
  async forceKillTree(identity: ProcessIdentity): Promise<void> {
    this.kills.push(identity);
    this.markAbsent(identity);
  }
  markAlive(identity: ProcessIdentity): void { this.states.set(identity.pid, "alive"); }
  markAbsent(identity: ProcessIdentity): void { this.states.set(identity.pid, "absent"); }
}

const root = await mkdtemp(join(tmpdir(), "patbv5-runtime-controller-"));
const store = new ControlRuntimeStore(createControlPaths(join(root, "control")));
await store.ensure();
const wrapperIdentity = { pid: 400, startedAt: "2026-07-16T20:00:01.000Z" };
const botIdentity = { pid: 500, startedAt: "2026-07-16T20:00:02.000Z" };
const processes = new FakeProcessAdapter(wrapperIdentity);
const clock = new ManualClock("2026-07-16T20:00:00.000Z");
const controller = new RuntimeController(store, processes, {
  repoRoot: root,
  controlDir: store.paths.controlDir,
  now: () => clock.now(),
  createRunId: () => "11111111-1111-4111-8111-111111111111",
});

const started = await controller.start("PAPER");
assert.equal(started.state, "STARTING");
assert.equal(processes.spawns.length, 1);
await assert.rejects(controller.start("LIVE"), /already active/i);

const active = await store.readActiveRun();
if (!active?.wrapper) throw new Error("expected wrapper identity after START");
await store.writeHeartbeat({
  schemaVersion: 1,
  runId: active.runId,
  mode: "PAPER",
  sessionId: "session-paper",
  bot: { pid: 500, startedAt: "2026-07-16T20:00:02.000Z" },
  status: "RUNNING",
  updatedAt: "2026-07-16T20:00:03.000Z",
});
assert.equal((await controller.status()).state, "PAPER");

await controller.stop();
await controller.stop();
assert.equal((await store.readStopRequest())?.runId, active.runId);
assert.equal((await controller.status()).state, "STOPPING");
clock.advance(29_999);
assert.equal((await controller.status()).canForceStop, false);
clock.advance(1);
assert.equal((await controller.status()).canForceStop, true);

await store.writeHeartbeat({ ...(await store.readHeartbeat())!, status: "SHUTDOWN_COMPLETE", updatedAt: clock.iso() });
assert.equal((await controller.status()).state, "FINALIZING");
assert.equal((await controller.status()).canForceStop, false);

processes.markAbsent(active.wrapper);
await store.writeWrapperResult({
  schemaVersion: 1,
  runId: active.runId,
  outcome: "COMPLETE",
  botExitCode: 0,
  finalExitCode: 0,
  persistenceSucceeded: true,
  completedAt: clock.iso(),
  error: null,
});
assert.equal((await controller.reconcile()).state, "STOPPED");
assert.equal(await store.readActiveRun(), null);

await rm(root, { recursive: true, force: true });
```

Add these explicit assertions after resetting the temporary store between cases:

```ts
// Recovery: a matching live wrapper and fresh LIVE heartbeat must not spawn.
await seedActiveRun(store, "LIVE", wrapperIdentity);
await seedHeartbeat(store, "LIVE", "RUNNING", clock.iso());
processes.markAlive(wrapperIdentity);
const recovered = await controller.initialize();
assert.equal(recovered.state, "LIVE");
assert.equal(processes.spawns.length, 0);

// Completed wrapper with persistence failure leaves an actionable error but no active process.
processes.markAbsent(wrapperIdentity);
await seedWrapperResult(store, "ERROR", false, "database unavailable");
const failed = await controller.reconcile();
assert.equal(failed.state, "ERROR");
assert.equal(failed.canStart, true);
assert.match(failed.error ?? "", /database unavailable/i);

// Stale heartbeat with a matching live bot blocks a second start but still permits graceful STOP.
await seedActiveRun(store, "PAPER", wrapperIdentity);
await seedHeartbeat(store, "PAPER", "RUNNING", new Date(clock.now() - 5_001).toISOString());
processes.markAlive(wrapperIdentity);
processes.markAlive(botIdentity);
const stale = await controller.reconcile();
assert.equal(stale.state, "ERROR");
assert.equal(stale.canStart, false);
assert.equal(stale.canStop, true);

// Force Stop is rejected early, then records UNCLEAN only after eligibility.
await controller.stop();
await assert.rejects(controller.forceStop(), /not eligible/i);
clock.advance(30_000);
await controller.forceStop();
assert.equal(processes.kills.length, 1);
assert.equal((await store.readControllerState())?.lastOutcome, "UNCLEAN");
```

Implement `seedActiveRun`, `seedHeartbeat`, and `seedWrapperResult` as test-only functions that write the complete contracts from Task 1; each test uses a new temporary directory so records cannot leak between cases.

- [ ] **Step 2: Run and verify the missing-module failure**

Run: `npx tsx tests/control_runtime_controller.test.ts`  
Expected: FAIL with missing `runtimeController`.

- [ ] **Step 3: Define controller errors and public surface**

Create `src/control/runtimeController.ts` with:

```ts
export class ControlConflictError extends Error {}
export class ControlValidationError extends Error {}
export class ForceStopNotEligibleError extends Error {}

export interface RuntimeControllerOptions {
  repoRoot: string;
  controlDir: string;
  now?: () => number;
  createRunId?: () => string;
  gracefulStopTimeoutMs?: number;
}

export class RuntimeController {
  constructor(store: ControlRuntimeStore, processes: RuntimeProcessAdapter, options: RuntimeControllerOptions);
  initialize(): Promise<ControlStatus>;
  status(): Promise<ControlStatus>;
  start(mode: RequestedMode): Promise<ControlStatus>;
  stop(): Promise<ControlStatus>;
  forceStop(): Promise<ControlStatus>;
  reconcile(): Promise<ControlStatus>;
}
```

- [ ] **Step 4: Implement the exact transition rules**

Use one internal promise queue for all mutations. Implement these rules without alternate transitions:

```text
no active-run file                         -> STOPPED, or ERROR with the persisted last error
active wrapper + no matching heartbeat     -> STARTING (until 60-second startup timeout)
matching fresh RUNNING heartbeat PAPER     -> PAPER
matching fresh RUNNING heartbeat LIVE      -> LIVE
matching STOPPING heartbeat/request        -> STOPPING
matching SHUTDOWN_COMPLETE + wrapper alive -> FINALIZING
wrapper absent + COMPLETE result           -> clear active run, STOPPED
wrapper absent + ERROR/UNCLEAN/no result    -> clear active run, persist error, ERROR
stale heartbeat + matching live bot PID     -> ERROR, canStart false
matching run ID but mismatched mode          -> ERROR, canStart false, canStop true
60-second startup timeout + wrapper alive    -> ERROR, canStart false, canStop true
PID identity mismatch                       -> treat recorded PID as absent, never kill it
```

START must create the exclusive active-run file before spawning, update it with the returned wrapper identity, attach completion to `reconcile()`, and remove the lock after a spawn failure only when no wrapper exists.

STOP writes one matching `StopRequest`, stamps `stopRequestedAt` and `forceEligibleAt = stop + 30,000 ms`, and is idempotent thereafter.

Force Stop requires `STOPPING`, elapsed eligibility, and a matching live wrapper identity. After `forceKillTree`, poll `inspect` until absent (maximum five seconds), persist `UNCLEAN`, clear the active run, and expose the warning through `PersistedControllerState`.

Every accepted/rejected/completed/failed transition appends a sanitized audit record. `status()` returns at most 200 log lines from the recorded log path.

- [ ] **Step 5: Add and run the state-machine command**

Add:

```json
"test:control-manager": "tsx scripts/run_isolated_test.ts tests/control_runtime_controller.test.ts"
```

Run: `npm run test:control-manager && npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit the state machine**

```powershell
git add PATBv5/src/control/runtimeController.ts PATBv5/tests/control_runtime_controller.test.ts PATBv5/package.json
git commit -m "feat: add bot runtime controller"
```

---

### Task 6: Add the Windows process adapter

**Files:**
- Create: `PATBv5/src/control/windowsProcessAdapter.ts`
- Create: `PATBv5/tests/control_windows_process.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Produces: `buildRunBotArgs(request)` and `WindowsProcessAdapter` implementing `RuntimeProcessAdapter`.
- Does not run: any real bot in tests.

- [ ] **Step 1: Write the failing argument/identity test**

```ts
import assert from "node:assert/strict";
import { buildRunBotArgs, sameProcessStart } from "../src/control/windowsProcessAdapter";

const args = buildRunBotArgs({
  repoRoot: "C:\\Projects\\lkcsite\\PATBv5",
  controlDir: "C:\\Projects\\lkcsite\\PATBv5\\polydb\\runtime\\control",
  runId: "11111111-1111-4111-8111-111111111111",
  mode: "LIVE",
  logPath: "C:\\temp\\run.log",
});
assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
assert.ok(args.includes("-Mode"));
assert.ok(args.includes("LIVE"));
assert.ok(args.includes("-NonInteractive"));
assert.ok(args.includes("-SkipBuild"));
assert.ok(args.includes("-DisableEmbeddedUi"));
assert.equal(sameProcessStart("2026-07-16T20:00:00.000Z", "2026-07-16T20:00:00.000Z"), true);
assert.equal(sameProcessStart("2026-07-16T20:00:00.000Z", "2026-07-16T20:00:03.000Z"), false);
```

- [ ] **Step 2: Run and verify failure**

Run: `npx tsx tests/control_windows_process.test.ts`  
Expected: FAIL with missing `windowsProcessAdapter`.

- [ ] **Step 3: Implement safe argument construction and detached launch**

`buildRunBotArgs` returns exactly:

```ts
[
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(request.repoRoot, "run_bot.ps1"),
  "-Mode", request.mode,
  "-RunId", request.runId,
  "-ControlDirectory", request.controlDir,
  "-NonInteractive", "-SkipBuild", "-DisableEmbeddedUi",
]
```

`WindowsProcessAdapter.spawnRun` must open `logPath` for append, spawn `powershell.exe` with `cwd: repoRoot`, `detached: true`, `windowsHide: true`, and `stdio: ["ignore", logFd, logFd]`, close the parent's descriptor after spawn, and return an exit promise. Call `unref()` only after attaching the error/close listeners.

For process identity, invoke `powershell.exe -NoProfile -Command` with a numeric PID only and obtain `Get-Process -Id <pid> | Select-Object -ExpandProperty StartTime`. Normalize to UTC ISO. `currentIdentity()` performs this lookup for `process.pid`. `inspect` returns:

- `absent` for a missing PID;
- `identity_mismatch` when start times differ by more than 1,000 ms;
- `alive` otherwise.

`forceKillTree` invokes `taskkill.exe /PID <pid> /T /F`; never build a shell command string.

- [ ] **Step 4: Add and run the process test**

Add:

```json
"test:control-process": "tsx scripts/run_isolated_test.ts tests/control_windows_process.test.ts"
```

Run: `npm run test:control-process && npm run build`  
Expected: PASS; no PowerShell wrapper is spawned by the test.

- [ ] **Step 5: Commit the process adapter**

```powershell
git add PATBv5/src/control/windowsProcessAdapter.ts PATBv5/tests/control_windows_process.test.ts PATBv5/package.json
git commit -m "feat: launch controlled bot process"
```

---

### Task 7: Serve the loopback-only control API

**Files:**
- Modify: `PATBv5/src/ui/server.ts:20-34,157-207`
- Create: `PATBv5/src/control/httpServer.ts`
- Create: `PATBv5/tests/control_http_server.test.ts`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: `RuntimeController` plus the existing UI request handler.
- Produces: `createControlHttpServer(options)` and `startControlHttpServer(options)`.

- [ ] **Step 1: Write the failing HTTP security test**

Create `tests/control_http_server.test.ts` with a fake controller and an ephemeral server. Verify:

```ts
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { ControlStatus, RequestedMode } from "../src/control/contracts";
import { createControlHttpServer } from "../src/control/httpServer";

const stopped: ControlStatus = {
  state: "STOPPED",
  canStart: true,
  canStop: false,
  canForceStop: false,
  activeRun: null,
  error: null,
  logTail: [],
};
const fakeController = {
  startCalls: [] as RequestedMode[],
  async status() { return stopped; },
  async start(mode: RequestedMode) { this.startCalls.push(mode); return { ...stopped, state: "STARTING" as const, canStart: false }; },
  async stop() { return { ...stopped, state: "STOPPING" as const, canStart: false }; },
  async forceStop() { return { ...stopped, state: "ERROR" as const, error: "unclean stop" }; },
};
const server = createControlHttpServer({
  controller: fakeController,
  routeBase: "/terminal-v5",
  csrfToken: "test-token",
  serveUi: async () => false,
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const bootstrap = await fetch(`${base}/terminal-v5/api/control/bootstrap`);
assert.equal(bootstrap.status, 200);
assert.equal((await bootstrap.json()).csrfToken, "test-token");

const forbidden = await fetch(`${base}/terminal-v5/api/control/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://evil.example", "X-Codex-CSRF": "test-token" },
  body: JSON.stringify({ mode: "PAPER" }),
});
assert.equal(forbidden.status, 403);

const missingToken = await fetch(`${base}/terminal-v5/api/control/stop`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: "{}",
});
assert.equal(missingToken.status, 403);

const accepted = await fetch(`${base}/terminal-v5/api/control/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base, "X-Codex-CSRF": "test-token" },
  body: JSON.stringify({ mode: "LIVE" }),
});
assert.equal(accepted.status, 202);
assert.deepEqual(fakeController.startCalls, ["LIVE"]);

await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
```

Also assert HTTP 415 for non-JSON mutation, HTTP 400 for an invalid mode, HTTP 409 for `ControlConflictError`, and that `server.address().address` is `127.0.0.1` when started through `startControlHttpServer`.

- [ ] **Step 2: Run and verify failure**

Run: `npx tsx tests/control_http_server.test.ts`  
Expected: FAIL with missing `httpServer`.

- [ ] **Step 3: Export the existing UI handler without changing behavior**

In `src/ui/server.ts`, export `getUiPort`, `getUiRouteBase`, `openBrowser`, and `handleUiRequest`. Give `handleUiRequest` an optional third argument:

```ts
export async function handleUiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  routeBase = getUiRouteBase(),
): Promise<boolean>
```

Remove only its internal redeclaration of `routeBase`. Keep the embedded `startUiServer()` paths and responses unchanged.

- [ ] **Step 4: Implement API parsing and security**

Create `src/control/httpServer.ts`. The factory options are:

```ts
export interface ControlApiController {
  status(): Promise<ControlStatus>;
  start(mode: RequestedMode): Promise<ControlStatus>;
  stop(): Promise<ControlStatus>;
  forceStop(): Promise<ControlStatus>;
}
export interface ControlHttpServerOptions {
  controller: ControlApiController;
  routeBase: string;
  csrfToken: string;
  serveUi?: typeof handleUiRequest;
}
export function createControlHttpServer(options: ControlHttpServerOptions): ReturnType<typeof createServer>;
export async function startControlHttpServer(options: ControlHttpServerOptions & {
  preferredPort: number;
  openBrowser?: boolean;
}): Promise<{ server: ReturnType<typeof createServer>; port: number; url: string }>;
```

Exact request rules:

- control route prefix is `${routeBase}/api/control`;
- GET bootstrap returns `{ csrfToken, status }`; GET status returns `{ status }`;
- all responses use `Cache-Control: no-store`;
- mutation body limit is 8,192 bytes;
- every control-route `Host` must parse to `localhost` or `127.0.0.1` and the actual bound port;
- mutation `Origin` must equal `http://localhost:<port>` or `http://127.0.0.1:<port>`;
- `Content-Type` must begin `application/json`;
- `X-Codex-CSRF` must match with `timingSafeEqual` after equal-length validation;
- no CORS headers are emitted;
- start/stop/force success returns HTTP 202 and `{ status }`;
- malformed JSON/mode returns 400, security failures 403, media failures 415, control conflicts 409, unknown control path 404, and unexpected failures 500 with sanitized text.

After control routing, delegate to `serveUi(request, response, routeBase)`. `startControlHttpServer` tries ports `preferredPort..preferredPort+9`, always calls `server.listen(port, "127.0.0.1")`, builds the URL from the actual bound port, and calls the exported `openBrowser(url)` only after listening when `openBrowser === true`.

- [ ] **Step 5: Add and run the HTTP command**

Add:

```json
"test:control-http": "tsx scripts/run_isolated_test.ts tests/control_http_server.test.ts"
```

Run: `npm run test:control-http && npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit the API**

```powershell
git add PATBv5/src/ui/server.ts PATBv5/src/control/httpServer.ts PATBv5/tests/control_http_server.test.ts PATBv5/package.json
git commit -m "feat: expose local bot control api"
```

---

### Task 8: Add the CODEX runtime-control buttons

**Files:**
- Modify: `PATBv5/newGui/src/types.ts`
- Create: `PATBv5/newGui/src/lib/controlApi.ts`
- Create: `PATBv5/newGui/src/hooks/useBotControl.ts`
- Create: `PATBv5/newGui/src/components/codex/CodexRuntimeControls.tsx`
- Modify: `PATBv5/newGui/src/components/codex/CodexLiveView.tsx`
- Modify: `PATBv5/newGui/src/pages/CodexLivePage.tsx`
- Modify: `PATBv5/newGui/src/styles/codex.css`
- Create: `PATBv5/newGui/tests/codex_runtime_controls.test.tsx`
- Modify: `PATBv5/package.json`

**Interfaces:**
- Consumes: the control API from Task 7.
- Produces: `useBotControl()` and fetch-free `CodexRuntimeControls`.

- [ ] **Step 1: Write the failing component contract test**

Create `newGui/tests/codex_runtime_controls.test.tsx` using `renderToStaticMarkup`. Provide no-op actions and assert:

```tsx
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexRuntimeControls } from "../src/components/codex/CodexRuntimeControls";
import type { ControlRunView, ControlStatus } from "../src/types";

const base: ControlStatus = {
  state: "STOPPED",
  canStart: true,
  canStop: false,
  canForceStop: false,
  activeRun: null,
  error: null,
  logTail: [],
};
const activeRun: ControlRunView = {
  runId: "11111111-1111-4111-8111-111111111111",
  requestedMode: "LIVE",
  modeSource: "CONTROL_OVERRIDE",
  requestedAt: "2026-07-16T20:00:00.000Z",
  wrapperPid: 400,
  botPid: 401,
  sessionId: "session-live",
  heartbeatUpdatedAt: "2026-07-16T20:00:01.000Z",
};
const render = (status: ControlStatus) => renderToStaticMarkup(
  <CodexRuntimeControls
    status={status}
    loading={false}
    pendingAction={null}
    error={null}
    start={async () => undefined}
    stop={async () => undefined}
    forceStop={async () => undefined}
    refresh={async () => undefined}
  />,
);

const stopped = render({ state: "STOPPED", canStart: true, canStop: false, canForceStop: false, activeRun: null, error: null, logTail: [] });
assert.match(stopped, /START PAPER/);
assert.match(stopped, /START LIVE/);
assert.doesNotMatch(stopped, />STOP</);

const live = render({ ...base, state: "LIVE", canStart: false, canStop: true, activeRun });
assert.match(live, /LIVE/);
assert.match(live, />STOP</);
assert.doesNotMatch(live, /START PAPER/);

const waiting = render({ ...base, state: "STOPPING", canForceStop: false, activeRun });
assert.match(waiting, /STOPPING/);
assert.doesNotMatch(waiting, /FORCE STOP/);

const force = render({ ...base, state: "STOPPING", canForceStop: true, activeRun });
assert.match(force, /FORCE STOP/);

const finalizing = render({ ...base, state: "FINALIZING", canForceStop: false, activeRun });
assert.match(finalizing, /FINALIZING/);
assert.doesNotMatch(finalizing, /FORCE STOP/);

const fault = render({ ...base, state: "ERROR", canStart: false, canStop: true, activeRun, error: "heartbeat stale" });
assert.match(fault, /heartbeat stale/i);
assert.match(fault, /CONTROL OVERRIDE/);
assert.match(fault, /session-live/);
```

Also assert visible `CONTROL OVERRIDE`, run ID, session ID, PIDs, heartbeat timestamp, and an error banner. Do not add a confirmation dialog test because the approved behavior is immediate LIVE start.

- [ ] **Step 2: Run and verify missing-component failure**

Run: `npx tsx newGui/tests/codex_runtime_controls.test.tsx`  
Expected: FAIL with missing `CodexRuntimeControls`.

- [ ] **Step 3: Mirror the API types and implement the client**

Add `RequestedMode`, `ControllerState`, `ControlRunView`, and `ControlStatus` to `newGui/src/types.ts` with exactly the same fields as `src/control/contracts.ts`.

Create `newGui/src/lib/controlApi.ts`:

```ts
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "/terminal-v5/api";
export interface ControlBootstrap { csrfToken: string; status: ControlStatus; }
export function fetchControlBootstrap(): Promise<ControlBootstrap>;
export function fetchControlStatus(): Promise<ControlStatus>;
export function startControlledBot(mode: RequestedMode, csrfToken: string): Promise<ControlStatus>;
export function stopControlledBot(csrfToken: string): Promise<ControlStatus>;
export function forceStopControlledBot(csrfToken: string): Promise<ControlStatus>;
```

Every request sends `Accept: application/json`; mutations also send `Content-Type: application/json` and `X-Codex-CSRF`. Parse `{ status }` on non-bootstrap responses. On failure, prefer the server JSON `error`, otherwise throw `Control API failed: <status>`.

- [ ] **Step 4: Implement the polling/action hook**

`useBotControl()` bootstraps immediately, stores the token in a ref, polls the bootstrap endpoint every 1,000 ms, retains the last status on polling error, and exposes:

```ts
export interface BotControlHookState {
  status: ControlStatus | null;
  loading: boolean;
  pendingAction: "start-paper" | "start-live" | "stop" | "force-stop" | null;
  error: string | null;
  start(mode: RequestedMode): Promise<void>;
  stop(): Promise<void>;
  forceStop(): Promise<void>;
  refresh(): Promise<void>;
}
```

Polling bootstrap rather than status is intentional: if the controller restarts, the open page receives the new in-memory CSRF token automatically before its next action. Serialize actions: if `pendingAction` is non-null, ignore a second click. LIVE calls `startControlledBot("LIVE", token)` directly—no `confirm()`, modal, readiness call, or delay.

- [ ] **Step 5: Implement state-aware controls and compose them**

`CodexRuntimeControls` accepts `BotControlHookState`. Render exact action behavior:

```tsx
{status?.canStart && (
  <div className="codex-control-actions">
    <button type="button" className="codex-control-button codex-control-button--paper" onClick={() => void start("PAPER")}>START PAPER</button>
    <button type="button" className="codex-control-button codex-control-button--live" onClick={() => void start("LIVE")}>START LIVE</button>
  </div>
)}
{status?.canStop && <button type="button" className="codex-control-button codex-control-button--stop" onClick={() => void stop()}>STOP</button>}
{status?.canForceStop && <button type="button" className="codex-control-button codex-control-button--force" onClick={() => void forceStop()}>FORCE STOP</button>}
```

All buttons are disabled during `pendingAction`. Render state text with `aria-live="polite"`; render active-run metadata with labels, not color alone. Show the latest error and the last 20 log lines in a collapsed `<details>` element.

Change `CodexLiveView` to accept a `control: BotControlHookState` prop and render `CodexRuntimeControls` in every branch, including missing/mock telemetry. Avoid nested `<main>` elements by using one outer `.codex-live` main and conditional inner sections.

Change `CodexLivePage` to call both hooks and pass the control state:

```tsx
export function CodexLivePage() {
  const terminal = useTerminalData();
  const control = useBotControl();
  return <CodexLiveView data={terminal.data} error={terminal.error} stale={terminal.stale} control={control} />;
}
```

- [ ] **Step 6: Add scoped control styles**

Append `.codex-control-*` rules under `.codex-live`. PAPER uses the existing phosphor/settled family; LIVE uses ember/fault borders and explicit `LIVE` text. STOP and FORCE STOP have distinct labels, focus-visible outlines, minimum 44 px height, disabled opacity without removing text, a one-column layout below 600 px, and no motion beyond the approved opacity transition.

- [ ] **Step 7: Add and run frontend verification**

Add:

```json
"test:control-ui": "tsx newGui/tests/codex_runtime_controls.test.tsx"
```

Run: `npm run test:control-ui && npm run test:ui-components && npm run ui:build`  
Expected: PASS.

- [ ] **Step 8: Commit the CODEX controls**

```powershell
git add PATBv5/newGui/src/types.ts PATBv5/newGui/src/lib/controlApi.ts PATBv5/newGui/src/hooks/useBotControl.ts PATBv5/newGui/src/components/codex/CodexRuntimeControls.tsx PATBv5/newGui/src/components/codex/CodexLiveView.tsx PATBv5/newGui/src/pages/CodexLivePage.tsx PATBv5/newGui/src/styles/codex.css PATBv5/newGui/tests/codex_runtime_controls.test.tsx PATBv5/package.json
git commit -m "feat: add codex bot controls"
```

---

### Task 9: Compose the controller launcher and complete verification

**Files:**
- Create: `PATBv5/src/control/index.ts`
- Create: `PATBv5/codex_machine.ps1`
- Create: `PATBv5/scripts/check_codex_machine.ps1`
- Modify: `PATBv5/package.json`
- Update: `graphify-out/graph.json`
- Update: `graphify-out/GRAPH_REPORT.md`

**Interfaces:**
- Produces: `npm run control:start`, `npm run control:dev`, and root `codex_machine.ps1`.
- Preserves: an active bot when the controller receives SIGINT/SIGTERM.

- [ ] **Step 1: Write the failing launcher contract test**

Create `scripts/check_codex_machine.ps1`. Read `codex_machine.ps1` and assert it:

- sets its working directory to its own directory;
- runs `npm run build` and `npm run ui:build` before `npm run control:start`;
- sets `UI_SERVER_ENABLED=0`;
- supports `-NoBrowser`;
- contains no PAPER/LIVE mode override and therefore cannot start a bot by itself;
- contains no credentials.

Read `src/control/index.ts` and assert it uses `randomBytes`, calls `startControlHttpServer`, uses a 500 ms reconcile timer, and releases only the controller lock on SIGINT/SIGTERM. Read `src/control/httpServer.ts` and assert the production listener binds the literal `127.0.0.1`.

- [ ] **Step 2: Run and verify missing-file failure**

Run: `powershell -NoProfile -File scripts/check_codex_machine.ps1`  
Expected: FAIL because `codex_machine.ps1` and `src/control/index.ts` do not exist.

- [ ] **Step 3: Compose the production controller**

Create `src/control/index.ts` with this sequence:

```ts
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { readOptionalConfigEnv } from "../config/secrets";
import { getUiPort, getUiRouteBase } from "../ui/server";
import { startControlHttpServer } from "./httpServer";
import { RuntimeController } from "./runtimeController";
import { ControlRuntimeStore, createControlPaths } from "./runtimeStore";
import { WindowsProcessAdapter } from "./windowsProcessAdapter";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const controlDir = resolve(repoRoot, "polydb", "runtime", "control");
  const store = new ControlRuntimeStore(createControlPaths(controlDir));
  const processes = new WindowsProcessAdapter();
  await store.ensure();
  const controllerIdentity = await processes.currentIdentity();
  const existingController = await store.readControllerLock();
  if (existingController) {
    const existingState = await processes.inspect(existingController);
    if (existingState === "alive") {
      throw new Error(`CODEX controller already running with PID ${existingController.pid}`);
    }
    await store.releaseControllerLock(existingController);
  }
  await store.acquireControllerLock(controllerIdentity);
  await store.appendAudit({
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    action: existingController ? "controller.recovered" : "controller.started",
    outcome: existingController ? "recovered" : "accepted",
    runId: null,
    sessionId: null,
    detail: null,
  });

  const controller = new RuntimeController(store, processes, { repoRoot, controlDir });
  await controller.initialize();
  const csrfToken = randomBytes(32).toString("hex");
  const openBrowser = ["1", "true", "yes", "on"].includes(readOptionalConfigEnv("UI_OPEN_BROWSER").toLowerCase());
  const listening = await startControlHttpServer({
    controller,
    routeBase: getUiRouteBase(),
    csrfToken,
    preferredPort: getUiPort(),
    openBrowser,
  });
  const reconcileTimer = setInterval(() => {
    void controller.reconcile().catch((error) => console.error(error instanceof Error ? error.message : String(error)));
  }, 500);

  let closing = false;
  const closeController = async (reason: string): Promise<void> => {
    if (closing) return;
    closing = true;
    clearInterval(reconcileTimer);
    await store.appendAudit({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      action: "controller.exited",
      outcome: "completed",
      runId: (await store.readActiveRun())?.runId ?? null,
      sessionId: (await store.readHeartbeat())?.sessionId ?? null,
      detail: reason,
    });
    await new Promise<void>((resolvePromise) => listening.server.close(() => resolvePromise()));
    await store.releaseControllerLock(controllerIdentity);
    process.exit(0);
  };
  process.once("SIGINT", () => void closeController("SIGINT"));
  process.once("SIGTERM", () => void closeController("SIGTERM"));
  console.log(`CODEX controller listening at ${listening.url} | state=${(await controller.status()).state}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

The shutdown handler clears the reconcile timer, closes only the HTTP server, appends `controller.exited`, releases `controllerIdentity`, and exits. It must not write a bot STOP request or call `forceKillTree`; a detached active run continues and is recovered on restart.

Log only the URL and recovered controller state. Never log the CSRF token, environment, or secrets.

- [ ] **Step 4: Create the root controller launcher**

Create `codex_machine.ps1`:

```powershell
param([switch]$NoBrowser)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "Building PATBv5 controller..."
& npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Building CODEX UI..."
& npm run ui:build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:UI_SERVER_ENABLED = "0"
$env:UI_OPEN_BROWSER = if ($NoBrowser) { "0" } else { "1" }
Write-Host "Starting CODEX control machine..."
& npm run control:start
exit $LASTEXITCODE
```

- [ ] **Step 5: Add aggregate commands**

Add:

```json
"control:dev": "tsx src/control/index.ts",
"control:start": "node dist/control/index.js",
"test:codex-machine": "powershell -NoProfile -File scripts/check_codex_machine.ps1",
"test:control": "npm run test:control-store && npm run test:control-bot && npm run test:control-shutdown && npm run test:controlled-launcher && npm run test:control-manager && npm run test:control-process && npm run test:control-http && npm run test:control-ui && npm run test:codex-machine"
```

Insert `npm run test:control` into `test:all` after `test:ui-codex` and before report tests.

- [ ] **Step 6: Run all automated verification**

Run from `PATBv5`:

```powershell
npm run test:control
npm run test:run-bot-launcher
npm run test:lifecycle
npm run build
npm run ui:build
```

Expected: every command exits 0. No test starts a real bot or places an order.

- [ ] **Step 7: Verify the controller without starting trading**

Run `./codex_machine.ps1 -NoBrowser` in a separate PowerShell window. Verify:

```powershell
curl.exe http://localhost:4175/terminal-v5/api/control/status
curl.exe -I http://localhost:4175/terminal-v5/codex
```

Expected: HTTP 200; status is `STOPPED`; both START buttons are visible in the browser. Stop the controller with Ctrl+C and restart it; status remains `STOPPED` and no bot appears.

- [ ] **Step 8: Perform one manual PAPER lifecycle only**

In CODEX, click `START PAPER`, confirm transitions `STARTING -> PAPER`, then click `STOP` and confirm `STOPPING -> FINALIZING -> STOPPED`. Verify:

- one telemetry session was created;
- `bot.startup.payload.mode` is `PAPER` and `modeSource` is `CONTROL_OVERRIDE`;
- the session persisted to `strategy_performance`;
- `.env` is byte-for-byte unchanged;
- START LIVE remained visually distinct but was not clicked during verification.

- [ ] **Step 9: Verify restart recovery during PAPER**

Start PAPER again, stop only the controller with Ctrl+C, restart `codex_machine.ps1`, and verify it reconstructs `PAPER` without spawning a second wrapper. Then use STOP and confirm normal finalization.

- [ ] **Step 10: Verify timeout presentation with the fake adapter harness**

Use the controller test harness—not the real bot—to hold a fake run in `STOPPING`, advance past 30,000 ms, and visually confirm `FORCE STOP` appears. Confirm it is absent during `FINALIZING`. Do not force-kill a real trading run for acceptance testing.

- [ ] **Step 11: Update the codebase graph**

Run from `C:\Projects\lkcsite`:

```powershell
graphify . --backend nvidia --update
```

Expected: Graphify includes `RuntimeController`, `createBotRuntimeControl`, `startControlHttpServer`, `WindowsProcessAdapter`, `useBotControl`, and `CodexRuntimeControls`.

- [ ] **Step 12: Commit final composition**

```powershell
git add PATBv5/src/control/index.ts PATBv5/codex_machine.ps1 PATBv5/scripts/check_codex_machine.ps1 PATBv5/package.json graphify-out/graph.json graphify-out/GRAPH_REPORT.md
git commit -m "feat: launch codex control machine"
```

---

## Final Verification Checklist

- [ ] Prerequisite CODEX live-terminal plan is complete.
- [ ] `npm run test:control`
- [ ] `npm run test:run-bot-launcher`
- [ ] `npm run test:lifecycle`
- [ ] `npm run build`
- [ ] `npm run ui:build`
- [ ] Controller binds only `127.0.0.1`.
- [ ] Cross-origin and missing-CSRF mutations are rejected.
- [ ] `codex_machine.ps1` keeps CODEX open while no bot runs.
- [ ] PAPER/LIVE are mutually exclusive and mode override never edits `.env`.
- [ ] Manual `run_bot.ps1` still obeys `.env`.
- [ ] STOP produces `STOPPING`, shutdown telemetry, `FINALIZING`, persistence, then `STOPPED`.
- [ ] Force Stop appears only after 30 seconds of `STOPPING` and is never automatic.
- [ ] Controller restart reconstructs the active run without duplication.
- [ ] No automated or acceptance test initiates LIVE trading.
- [ ] Unrelated evaluation artifacts remain unstaged.
