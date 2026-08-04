import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ProcessIdentity,
  ProcessInspection,
  RequestedMode,
  RuntimeProcessAdapter,
  SpawnRunRequest,
  WrapperHandle,
  WrapperOutcome,
} from "../src/control/contracts";
import { ControlRuntimeStore, createControlPaths } from "../src/control/runtimeStore";
import { ForceStopNotEligibleError, RuntimeController } from "../src/control/runtimeController";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const WRAPPER_IDENTITY = { pid: 400, startedAt: "2026-07-16T20:00:01.000Z" };
const BOT_IDENTITY = { pid: 500, startedAt: "2026-07-16T20:00:02.000Z" };

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
  readonly states = new Map<number, ProcessInspection>();
  spawnError: Error | null = null;
  releaseError: Error | null = null;
  beforeRelease: (() => Promise<void>) | null = null;
  readonly launchEvents: string[] = [];

  constructor(private readonly nextWrapper: ProcessIdentity) {}

  async currentIdentity(): Promise<ProcessIdentity> {
    return { pid: 999, startedAt: "2026-07-16T19:59:00.000Z" };
  }

  async spawnRun(request: SpawnRunRequest): Promise<WrapperHandle> {
    this.spawns.push(request);
    if (this.spawnError) throw this.spawnError;
    this.markAlive(this.nextWrapper);
    this.launchEvents.push("prepared");
    return {
      identity: this.nextWrapper,
      completion: new Promise<{ exitCode: number; signal: string | null }>(() => undefined),
      releaseStart: async () => {
        await this.beforeRelease?.();
        this.launchEvents.push("released");
        if (this.releaseError) throw this.releaseError;
      },
      abortStart: async () => {
        this.launchEvents.push("aborted");
        this.markAbsent(this.nextWrapper);
      },
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
  markIdentityMismatch(identity: ProcessIdentity): void { this.states.set(identity.pid, "identity_mismatch"); }
}

interface Harness {
  root: string;
  store: ControlRuntimeStore;
  processes: FakeProcessAdapter;
  clock: ManualClock;
  controller: RuntimeController;
}

async function withHarness(action: (harness: Harness) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "patbv5-runtime-controller-"));
  const store = new ControlRuntimeStore(createControlPaths(join(root, "control")));
  await store.ensure();
  const processes = new FakeProcessAdapter(WRAPPER_IDENTITY);
  const clock = new ManualClock("2026-07-16T20:00:00.000Z");
  const controller = new RuntimeController(store, processes, {
    repoRoot: root,
    controlDir: store.paths.controlDir,
    now: () => clock.now(),
    createRunId: () => RUN_ID,
  });
  try {
    await action({ root, store, processes, clock, controller });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedActiveRun(
  store: ControlRuntimeStore,
  mode: RequestedMode,
  wrapper: ProcessIdentity | null,
  overrides: Partial<{ stopRequestedAt: string; forceEligibleAt: string }> = {},
): Promise<void> {
  await store.createActiveRun({
    schemaVersion: 1,
    runId: RUN_ID,
    requestedMode: mode,
    modeSource: "CONTROL_OVERRIDE",
    requestedAt: "2026-07-16T20:00:00.000Z",
    wrapper,
    stopRequestedAt: overrides.stopRequestedAt ?? null,
    forceEligibleAt: overrides.forceEligibleAt ?? null,
    logPath: join(store.paths.logsDir, "run.log"),
  });
}

async function seedHeartbeat(
  store: ControlRuntimeStore,
  mode: RequestedMode,
  status: "RUNNING" | "STOPPING" | "SHUTDOWN_COMPLETE",
  updatedAt: string,
): Promise<void> {
  await store.writeHeartbeat({
    schemaVersion: 1,
    runId: RUN_ID,
    mode,
    sessionId: `session-${mode.toLowerCase()}`,
    bot: BOT_IDENTITY,
    status,
    updatedAt,
  });
}

async function seedWrapperResult(
  store: ControlRuntimeStore,
  outcome: WrapperOutcome,
  persistenceSucceeded: boolean,
  error: string | null,
): Promise<void> {
  await store.writeWrapperResult({
    schemaVersion: 1,
    runId: RUN_ID,
    outcome,
    botExitCode: outcome === "COMPLETE" ? 0 : 1,
    finalExitCode: outcome === "COMPLETE" ? 0 : 1,
    persistenceSucceeded,
    completedAt: "2026-07-16T20:01:00.000Z",
    error,
  });
}

async function run(): Promise<void> {
  await withHarness(async ({ store, processes, clock, controller }) => {
    processes.beforeRelease = async () => {
      assert.deepEqual((await store.readActiveRun())?.wrapper, WRAPPER_IDENTITY);
    };
    const started = await controller.start("PAPER");
    assert.equal(started.state, "STARTING");
    assert.equal(processes.spawns.length, 1);
    assert.deepEqual(processes.launchEvents, ["prepared", "released"]);
    await assert.rejects(controller.start("LIVE"), /already active/i);

    const active = await store.readActiveRun();
    if (!active?.wrapper) throw new Error("expected wrapper identity after START");
    await seedHeartbeat(store, "PAPER", "RUNNING", "2026-07-16T20:00:03.000Z");
    assert.equal((await controller.status()).state, "PAPER");

    const stopping = await controller.stop();
    await controller.stop();
    assert.equal((await store.readStopRequest())?.runId, active.runId);
    assert.equal(stopping.activeRun?.stopRequestedAt, clock.iso());
    assert.equal(stopping.activeRun?.forceEligibleAt, new Date(clock.now() + 30_000).toISOString());
    assert.equal((await controller.status()).state, "STOPPING");
    assert.equal((await controller.status()).activeRun?.stopRequestedAt, clock.iso());
    assert.equal((await controller.status()).activeRun?.forceEligibleAt, new Date(clock.now() + 30_000).toISOString());
    clock.advance(29_999);
    assert.equal((await controller.status()).canForceStop, false);
    clock.advance(1);
    assert.equal((await controller.status()).canForceStop, true);

    await seedHeartbeat(store, "PAPER", "SHUTDOWN_COMPLETE", clock.iso());
    assert.equal((await controller.status()).state, "FINALIZING");
    assert.equal((await controller.status()).canForceStop, false);

    processes.markAbsent(active.wrapper);
    await seedWrapperResult(store, "COMPLETE", true, null);
    assert.equal((await controller.reconcile()).state, "STOPPED");
    assert.equal(await store.readActiveRun(), null);
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "LIVE", WRAPPER_IDENTITY);
    await seedHeartbeat(store, "LIVE", "RUNNING", clock.iso());
    processes.markAlive(WRAPPER_IDENTITY);
    processes.markAlive(BOT_IDENTITY);
    await writeFile(join(store.paths.logsDir, "run.log"), "ready\nAPI KEY=hidden\nlast-line\n", "utf8");
    const recovered = await controller.initialize();
    assert.equal(recovered.state, "LIVE");
    assert.equal(processes.spawns.length, 0);
    assert.deepEqual(recovered.logTail, ["ready", "last-line"]);
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "PAPER", null);
    await seedHeartbeat(store, "PAPER", "RUNNING", clock.iso());
    processes.markAlive(BOT_IDENTITY);

    const recovered = await controller.reconcile();
    assert.equal(recovered.state, "PAPER");
    assert.equal(recovered.canStop, true);
    assert.equal(recovered.canForceStop, false);
    assert.equal(recovered.activeRun?.wrapperPid, null);
    assert.equal(recovered.activeRun?.botPid, BOT_IDENTITY.pid);
  });

  await withHarness(async ({ store, clock, controller }) => {
    await seedActiveRun(store, "LIVE", null);
    await seedHeartbeat(store, "LIVE", "STOPPING", clock.iso());

    const recovered = await controller.reconcile();
    assert.equal(recovered.state, "STOPPING");
    assert.equal(recovered.canStop, false);
    assert.equal(recovered.canForceStop, false);
    assert.equal(recovered.activeRun?.wrapperPid, null);

    clock.advance(30_000);
    assert.equal((await controller.status()).canForceStop, false);
  });

  await withHarness(async ({ store, controller }) => {
    await seedActiveRun(store, "PAPER", null);
    await seedHeartbeat(store, "PAPER", "SHUTDOWN_COMPLETE", "2026-07-16T20:00:05.000Z");
    await seedWrapperResult(store, "COMPLETE", true, null);

    const finalized = await controller.reconcile();
    assert.equal(finalized.state, "STOPPED");
    assert.equal(finalized.activeRun, null);
    assert.equal(await store.readActiveRun(), null);
  });

  await withHarness(async ({ store, processes, controller }) => {
    await seedActiveRun(store, "LIVE", WRAPPER_IDENTITY);
    processes.markAbsent(WRAPPER_IDENTITY);
    await seedWrapperResult(store, "ERROR", false, "database unavailable");
    const failed = await controller.reconcile();
    assert.equal(failed.state, "ERROR");
    assert.equal(failed.canStart, true);
    assert.match(failed.error ?? "", /database unavailable/i);
  });

  await withHarness(async ({ store, processes, controller }) => {
    processes.releaseError = new Error("gate release failed");
    await assert.rejects(controller.start("LIVE"), /gate release failed/i);
    assert.deepEqual(processes.launchEvents, ["prepared", "released", "aborted"]);
    assert.equal(await store.readActiveRun(), null);
    assert.equal((await store.readControllerState())?.lastOutcome, "ERROR");
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "PAPER", WRAPPER_IDENTITY);
    await seedHeartbeat(store, "PAPER", "RUNNING", new Date(clock.now() - 5_001).toISOString());
    processes.markAlive(WRAPPER_IDENTITY);
    processes.markAlive(BOT_IDENTITY);
    const stale = await controller.reconcile();
    assert.equal(stale.state, "ERROR");
    assert.equal(stale.canStart, false);
    assert.equal(stale.canStop, true);

    await controller.stop();
    await assert.rejects(controller.forceStop(), ForceStopNotEligibleError);
    clock.advance(30_000);
    await controller.forceStop();
    assert.equal(processes.kills.length, 1);
    assert.equal((await store.readControllerState())?.lastOutcome, "UNCLEAN");
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "PAPER", WRAPPER_IDENTITY);
    await store.writeStopRequest({ schemaVersion: 1, runId: RUN_ID, requestedAt: clock.iso() });
    processes.markAlive(WRAPPER_IDENTITY);

    const recovered = await controller.reconcile();
    assert.equal(recovered.state, "STOPPING");
    assert.equal(recovered.canForceStop, false);
    const repaired = await store.readActiveRun();
    assert.equal(repaired?.stopRequestedAt, clock.iso());
    assert.equal(repaired?.forceEligibleAt, new Date(clock.now() + 30_000).toISOString());

    clock.advance(30_000);
    assert.equal((await controller.status()).canForceStop, true);
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "LIVE", WRAPPER_IDENTITY);
    await store.writeStopRequest({ schemaVersion: 1, runId: RUN_ID, requestedAt: "not-a-timestamp" });
    processes.markAlive(WRAPPER_IDENTITY);

    const recovered = await controller.reconcile();
    assert.equal(recovered.state, "STOPPING");
    assert.equal(recovered.canForceStop, false);
    const repaired = await store.readActiveRun();
    assert.equal(repaired?.stopRequestedAt, clock.iso());
    assert.equal(repaired?.forceEligibleAt, new Date(clock.now() + 30_000).toISOString());
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "PAPER", WRAPPER_IDENTITY);
    await seedHeartbeat(store, "PAPER", "STOPPING", clock.iso());
    processes.markAlive(WRAPPER_IDENTITY);

    const recovered = await controller.reconcile();
    assert.equal(recovered.state, "STOPPING");
    assert.equal(recovered.canForceStop, false);
    const repaired = await store.readActiveRun();
    assert.equal(repaired?.stopRequestedAt, clock.iso());
    assert.equal(repaired?.forceEligibleAt, new Date(clock.now() + 30_000).toISOString());

    clock.advance(30_000);
    assert.equal((await controller.status()).canForceStop, true);
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "PAPER", WRAPPER_IDENTITY);
    await seedHeartbeat(store, "LIVE", "RUNNING", clock.iso());
    processes.markAlive(WRAPPER_IDENTITY);
    const mismatch = await controller.reconcile();
    assert.equal(mismatch.state, "ERROR");
    assert.equal(mismatch.canStart, false);
    assert.equal(mismatch.canStop, true);
    assert.match(mismatch.error ?? "", /mode/i);
    await controller.status();
    const audit = (await readFile(store.paths.audit, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { action: string; outcome: string });
    assert.equal(audit.filter((record) => record.action === "state.error").length, 1);

    const stopping = await controller.stop();
    assert.equal(stopping.state, "STOPPING");
    assert.match(stopping.error ?? "", /mode/i);
    assert.equal(stopping.canForceStop, false);
    clock.advance(30_000);
    assert.equal((await controller.status()).canForceStop, true);
    await controller.forceStop();
    assert.deepEqual(processes.kills, [WRAPPER_IDENTITY]);
    const finalAudit = (await readFile(store.paths.audit, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { action: string; outcome: string });
    assert.equal(finalAudit.filter((record) => record.action === "run.force_stop").at(-1)?.outcome, "completed");
    assert.equal((await store.readControllerState())?.lastOutcome, "UNCLEAN");
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "PAPER", WRAPPER_IDENTITY);
    processes.markAlive(WRAPPER_IDENTITY);
    clock.advance(60_000);
    const timedOut = await controller.reconcile();
    assert.equal(timedOut.state, "ERROR");
    assert.equal(timedOut.canStart, false);
    assert.equal(timedOut.canStop, true);
    assert.match(timedOut.error ?? "", /startup timed out/i);
  });

  await withHarness(async ({ store, processes, controller }) => {
    processes.spawnError = new Error("spawn failed; API KEY=super-secret");
    await assert.rejects(controller.start("LIVE"), /spawn failed/i);
    assert.equal(await store.readActiveRun(), null);
    const failed = await controller.status();
    assert.equal(failed.state, "ERROR");
    assert.equal(failed.canStart, true);
    assert.doesNotMatch(failed.error ?? "", /super-secret/);
    const audit = await readFile(store.paths.audit, "utf8");
    assert.doesNotMatch(audit, /super-secret/);
  });

  await withHarness(async ({ store, processes, controller }) => {
    await seedActiveRun(store, "PAPER", WRAPPER_IDENTITY);
    processes.markAbsent(WRAPPER_IDENTITY);
    const missingResult = await controller.reconcile();
    assert.equal(missingResult.state, "ERROR");
    assert.equal(missingResult.canStart, true);
    assert.match(missingResult.error ?? "", /result/i);
  });

  await withHarness(async ({ store, processes, clock, controller }) => {
    await seedActiveRun(store, "LIVE", WRAPPER_IDENTITY, {
      stopRequestedAt: new Date(clock.now() - 30_001).toISOString(),
      forceEligibleAt: new Date(clock.now() - 1).toISOString(),
    });
    await store.writeStopRequest({ schemaVersion: 1, runId: RUN_ID, requestedAt: clock.iso() });
    processes.markIdentityMismatch(WRAPPER_IDENTITY);
    await assert.rejects(controller.forceStop(), ForceStopNotEligibleError);
    assert.equal(processes.kills.length, 0);
    assert.equal((await controller.status()).canStart, true);
  });
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
