import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  CONTROL_SCHEMA_VERSION,
  GRACEFUL_STOP_TIMEOUT_MS,
  HEARTBEAT_STALE_MS,
} from "./contracts";
import type {
  ActiveRunRecord,
  BotHeartbeat,
  ControlAuditRecord,
  ControlStatus,
  ControllerState,
  ProcessInspection,
  RequestedMode,
  RuntimeProcessAdapter,
  WrapperHandle,
  WrapperOutcome,
} from "./contracts";
import type { ControlRuntimeStore } from "./runtimeStore";

const STARTUP_TIMEOUT_MS = 60_000;
const FORCE_STOP_POLL_MS = 50;
const FORCE_STOP_WAIT_MS = 5_000;
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_ASSIGNMENT_PATTERN = /(?:pass[\s_-]*word|secret|token|api[\s_-]*key|private[\s_-]*key|pass[\s_-]*phrase|pg[\s_-]*pass[\s_-]*word)\s*[:=]/i;

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

function sanitizeDetail(value: unknown): string | null {
  if (value == null) return null;
  const compact = String(value).replace(/[\r\n]+/g, " ").trim();
  if (!compact) return null;
  const secret = SECRET_ASSIGNMENT_PATTERN.exec(compact);
  if (secret) {
    const safePrefix = compact.slice(0, secret.index).trim();
    return `${safePrefix}${safePrefix ? " " : ""}[REDACTED]`.slice(0, 500);
  }
  return compact.slice(0, 500);
}

function errorDetail(error: unknown): string {
  return sanitizeDetail(error instanceof Error ? error.message : String(error)) ?? "Unknown controller error.";
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export class RuntimeController {
  private readonly now: () => number;
  private readonly createRunId: () => string;
  private readonly gracefulStopTimeoutMs: number;
  private operationTail: Promise<void> = Promise.resolve();
  private readonly lastDerivedState = new Map<string, string>();

  constructor(
    private readonly store: ControlRuntimeStore,
    private readonly processes: RuntimeProcessAdapter,
    private readonly options: RuntimeControllerOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.createRunId = options.createRunId ?? randomUUID;
    this.gracefulStopTimeoutMs = options.gracefulStopTimeoutMs ?? GRACEFUL_STOP_TIMEOUT_MS;
  }

  initialize(): Promise<ControlStatus> {
    return this.enqueue(async () => {
      await this.store.ensure();
      const activeBefore = await this.store.readActiveRun();
      const status = await this.reconcileUnlocked();
      if (activeBefore && status.activeRun) {
        await this.audit("controller.initialize", "recovered", activeBefore, await this.matchingHeartbeat(activeBefore), null);
      }
      return status;
    });
  }

  status(): Promise<ControlStatus> {
    return this.enqueue(() => this.reconcileUnlocked());
  }

  start(mode: RequestedMode): Promise<ControlStatus> {
    return this.enqueue(async () => {
      await this.store.ensure();
      if (mode !== "PAPER" && mode !== "LIVE") {
        await this.audit("run.start", "rejected", null, null, "Invalid requested mode.");
        throw new ControlValidationError("Requested mode must be PAPER or LIVE.");
      }

      await this.reconcileUnlocked();
      const existing = await this.store.readActiveRun();
      if (existing) {
        await this.audit("run.start", "rejected", existing, await this.matchingHeartbeat(existing), "A run is already active.");
        throw new ControlConflictError("A bot run is already active.");
      }

      const runId = this.createRunId();
      if (!RUN_ID_PATTERN.test(runId)) {
        await this.audit("run.start", "rejected", null, null, "Run ID factory returned an invalid UUID v4.");
        throw new ControlValidationError("Run ID must be a valid UUID v4.");
      }

      const requestedAt = new Date(this.now()).toISOString();
      const logPath = join(this.store.paths.logsDir, `${runId}.log`);
      const active: ActiveRunRecord = {
        schemaVersion: CONTROL_SCHEMA_VERSION,
        runId,
        requestedMode: mode,
        modeSource: "CONTROL_OVERRIDE",
        requestedAt,
        wrapper: null,
        stopRequestedAt: null,
        forceEligibleAt: null,
        logPath,
      };

      try {
        await this.store.createActiveRun(active);
      } catch (error) {
        await this.audit("run.start", "rejected", active, null, errorDetail(error));
        throw new ControlConflictError("A bot run is already active.");
      }
      await this.audit("run.start", "accepted", active, null, `Mode ${mode}.`);

      let handle: WrapperHandle;
      try {
        handle = await this.processes.spawnRun({
          repoRoot: this.options.repoRoot,
          controlDir: this.options.controlDir,
          runId,
          mode,
          logPath,
        });
      } catch (error) {
        const detail = errorDetail(error);
        await this.store.clearActiveRun(runId);
        await this.persistOutcome(runId, "ERROR", detail);
        await this.audit("run.spawn", "failed", active, null, detail);
        throw new Error(`Bot wrapper spawn failed: ${detail}`);
      }

      active.wrapper = handle.identity;
      try {
        await this.store.writeActiveRun(active);
        await handle.releaseStart();
      } catch (error) {
        const detail = errorDetail(error);
        await handle.abortStart().catch(() => undefined);
        await this.store.clearActiveRun(runId);
        await this.persistOutcome(runId, "ERROR", detail);
        await this.audit("run.release", "failed", active, null, detail);
        throw new Error(`Bot wrapper start failed before gate release: ${detail}`);
      }
      this.observeCompletion(handle);
      return this.reconcileUnlocked();
    });
  }

  stop(): Promise<ControlStatus> {
    return this.enqueue(async () => {
      const currentStatus = await this.reconcileUnlocked();
      const active = await this.store.readActiveRun();
      if (!active) {
        await this.audit("run.stop", "rejected", null, null, "No active run.");
        throw new ControlValidationError("There is no active bot run to stop.");
      }

      const heartbeat = await this.matchingHeartbeat(active);
      if (currentStatus.state === "FINALIZING" && !active.stopRequestedAt) {
        await this.audit("run.stop", "rejected", active, heartbeat, "Run is already finalizing.");
        throw new ControlConflictError("The bot run is already finalizing.");
      }
      if (active.stopRequestedAt) {
        await this.audit("run.stop", "accepted", active, heartbeat, "Stop was already requested.");
        return currentStatus;
      }

      const requestedAt = new Date(this.now()).toISOString();
      const forceEligibleAt = new Date(this.now() + this.gracefulStopTimeoutMs).toISOString();
      await this.store.writeStopRequest({
        schemaVersion: CONTROL_SCHEMA_VERSION,
        runId: active.runId,
        requestedAt,
      });
      active.stopRequestedAt = requestedAt;
      active.forceEligibleAt = forceEligibleAt;
      await this.store.writeActiveRun(active);
      await this.audit("run.stop", "accepted", active, heartbeat, null);
      return this.reconcileUnlocked();
    });
  }

  forceStop(): Promise<ControlStatus> {
    return this.enqueue(async () => {
      const currentStatus = await this.reconcileUnlocked();
      const active = await this.store.readActiveRun();
      const heartbeat = active ? await this.matchingHeartbeat(active) : null;
      if (!active || !active.wrapper || currentStatus.state !== "STOPPING") {
        await this.audit("run.force_stop", "rejected", active, heartbeat, "Force Stop is not eligible in the current state.");
        throw new ForceStopNotEligibleError("Force Stop is not eligible in the current state.");
      }

      const eligibleAt = active.forceEligibleAt ? timestampMs(active.forceEligibleAt) : Number.POSITIVE_INFINITY;
      if (this.now() < eligibleAt) {
        await this.audit("run.force_stop", "rejected", active, heartbeat, "Graceful stop timeout has not elapsed.");
        throw new ForceStopNotEligibleError("Force Stop is not eligible until the graceful stop timeout elapses.");
      }

      const inspection = await this.processes.inspect(active.wrapper);
      if (inspection !== "alive") {
        await this.audit("run.force_stop", "rejected", active, heartbeat, "Wrapper identity is not live and matching.");
        throw new ForceStopNotEligibleError("Force Stop requires a matching live wrapper process.");
      }

      try {
        await this.processes.forceKillTree(active.wrapper);
      } catch (error) {
        const detail = errorDetail(error);
        await this.audit("run.force_stop", "failed", active, heartbeat, detail);
        throw new Error(`Force Stop failed: ${detail}`);
      }

      const deadline = Date.now() + FORCE_STOP_WAIT_MS;
      let postKillInspection: ProcessInspection = await this.processes.inspect(active.wrapper);
      while (postKillInspection === "alive" && Date.now() < deadline) {
        await delay(FORCE_STOP_POLL_MS);
        postKillInspection = await this.processes.inspect(active.wrapper);
      }
      if (postKillInspection === "alive") {
        const detail = "Forced process tree did not exit within five seconds.";
        await this.audit("run.force_stop", "failed", active, heartbeat, detail);
        throw new Error(detail);
      }

      const warning = "Bot process tree was force-stopped; finalization may be incomplete.";
      await this.persistOutcome(active.runId, "UNCLEAN", warning);
      await this.store.clearStopRequest(active.runId);
      await this.store.clearActiveRun(active.runId);
      this.lastDerivedState.delete(active.runId);
      await this.audit("run.force_stop", "completed", active, heartbeat, warning);
      return this.noActiveStatus();
    });
  }

  reconcile(): Promise<ControlStatus> {
    return this.enqueue(() => this.reconcileUnlocked());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private observeCompletion(handle: WrapperHandle): void {
    void handle.completion.then(
      () => this.reconcile(),
      () => this.reconcile(),
    ).catch(() => undefined);
  }

  private async reconcileUnlocked(): Promise<ControlStatus> {
    const active = await this.store.readActiveRun();
    if (!active) return this.noActiveStatus();

    const heartbeat = await this.matchingHeartbeat(active);
    const stopRequest = await this.store.readStopRequest();
    const matchingStopRequest = stopRequest?.runId === active.runId ? stopRequest : null;
    const logTail = await this.store.readLogTail(active.logPath, 200);

    const stopTimingSource = active.stopRequestedAt
      ?? matchingStopRequest?.requestedAt
      ?? (heartbeat?.status === "STOPPING" ? heartbeat.updatedAt : null);
    if (stopTimingSource && (!active.stopRequestedAt || !active.forceEligibleAt)) {
      const parsedRequestedAt = Date.parse(stopTimingSource);
      const requestedAtMs = Number.isFinite(parsedRequestedAt) ? parsedRequestedAt : this.now();
      active.stopRequestedAt = new Date(requestedAtMs).toISOString();
      active.forceEligibleAt = new Date(requestedAtMs + this.gracefulStopTimeoutMs).toISOString();
      await this.store.writeActiveRun(active);
      await this.audit(
        "run.stop_recovered",
        "recovered",
        active,
        heartbeat,
        Number.isFinite(parsedRequestedAt)
          ? "Recovered persisted stop timing from available stop evidence."
          : "Recovered stop timing from the controller clock because the available timestamp was invalid.",
      );
    }

    const modeMismatchDetail = heartbeat && heartbeat.mode !== active.requestedMode
      ? `Heartbeat mode ${heartbeat.mode} does not match requested mode ${active.requestedMode}.`
      : null;

    if (!active.wrapper) {
      const wrapperResult = await this.store.readWrapperResult();
      if (wrapperResult?.runId === active.runId) {
        return this.finishExitedRun(active, heartbeat, "absent");
      }

      if (heartbeat?.status === "SHUTDOWN_COMPLETE") {
        return this.trackedActiveStatus("FINALIZING", active, heartbeat, null, logTail, false, false);
      }

      if (active.stopRequestedAt || matchingStopRequest || heartbeat?.status === "STOPPING") {
        return this.trackedActiveStatus(
          "STOPPING",
          active,
          heartbeat,
          modeMismatchDetail,
          logTail,
          false,
          false,
        );
      }

      if (heartbeat?.status === "RUNNING") {
        if (modeMismatchDetail) {
          return this.trackedActiveStatus("ERROR", active, heartbeat, modeMismatchDetail, logTail, true, false);
        }
        const heartbeatAge = Math.max(0, this.now() - timestampMs(heartbeat.updatedAt));
        if (heartbeatAge <= HEARTBEAT_STALE_MS) {
          return this.trackedActiveStatus(active.requestedMode, active, heartbeat, null, logTail, true, false);
        }

        const botInspection = await this.processes.inspect(heartbeat.bot);
        const detail = botInspection === "alive"
          ? "Bot heartbeat is stale while the matching bot process is still alive."
          : botInspection === "identity_mismatch"
            ? "Bot heartbeat is stale and its PID identity no longer matches the recorded bot process."
            : "Bot heartbeat is stale and the recorded bot process is no longer alive.";
        return this.trackedActiveStatus("ERROR", active, heartbeat, detail, logTail, true, false);
      }

      const elapsed = this.now() - timestampMs(active.requestedAt);
      if (elapsed >= STARTUP_TIMEOUT_MS) {
        const detail = "Bot startup timed out before a wrapper identity was recorded.";
        return this.trackedActiveStatus("ERROR", active, heartbeat, detail, logTail, true, false);
      }
      return this.trackedActiveStatus("STARTING", active, heartbeat, null, logTail, true, false);
    }

    const wrapperInspection = await this.processes.inspect(active.wrapper);
    if (wrapperInspection !== "alive") {
      return this.finishExitedRun(active, heartbeat, wrapperInspection);
    }

    if (heartbeat?.status === "SHUTDOWN_COMPLETE") {
      return this.trackedActiveStatus("FINALIZING", active, heartbeat, null, logTail, false, false);
    }

    if (active.stopRequestedAt || matchingStopRequest || heartbeat?.status === "STOPPING") {
      const eligibleAt = active.forceEligibleAt ? timestampMs(active.forceEligibleAt) : Number.POSITIVE_INFINITY;
      return this.trackedActiveStatus(
        "STOPPING",
        active,
        heartbeat,
        modeMismatchDetail,
        logTail,
        false,
        this.now() >= eligibleAt,
      );
    }

    if (modeMismatchDetail) {
      return this.trackedActiveStatus(
        "ERROR",
        active,
        heartbeat,
        modeMismatchDetail,
        logTail,
        true,
        false,
      );
    }

    if (heartbeat?.status === "RUNNING") {
      const age = Math.max(0, this.now() - timestampMs(heartbeat.updatedAt));
      if (age <= HEARTBEAT_STALE_MS) {
        return this.trackedActiveStatus(active.requestedMode, active, heartbeat, null, logTail, true, false);
      }
      const botInspection = await this.processes.inspect(heartbeat.bot);
      if (botInspection === "alive") {
        const detail = "Bot heartbeat is stale while the matching bot process is still alive.";
        return this.trackedActiveStatus(
          "ERROR",
          active,
          heartbeat,
          detail,
          logTail,
          true,
          false,
        );
      }
    }

    const startupElapsed = this.now() - timestampMs(active.requestedAt);
    if (startupElapsed >= STARTUP_TIMEOUT_MS) {
      const detail = "Bot startup timed out after 60 seconds.";
      return this.trackedActiveStatus("ERROR", active, heartbeat, detail, logTail, true, false);
    }
    return this.trackedActiveStatus("STARTING", active, heartbeat, null, logTail, true, false);
  }

  private async finishExitedRun(
    active: ActiveRunRecord,
    heartbeat: BotHeartbeat | null,
    inspection: ProcessInspection,
  ): Promise<ControlStatus> {
    const candidate = await this.store.readWrapperResult();
    const result = candidate?.runId === active.runId ? candidate : null;
    if (result?.outcome === "COMPLETE") {
      await this.persistOutcome(active.runId, "COMPLETE", null);
      await this.store.clearStopRequest(active.runId);
      await this.store.clearActiveRun(active.runId);
      this.lastDerivedState.delete(active.runId);
      await this.audit("run.finalize", "completed", active, heartbeat, null);
      return this.noActiveStatus();
    }

    const detail = inspection === "identity_mismatch"
      ? "Wrapper PID identity mismatch; the recorded PID was treated as absent."
      : result?.error
        ? errorDetail(result.error)
        : result
          ? `Wrapper finished with ${result.outcome}.`
          : "Wrapper exited without writing a matching result.";
    const outcome: WrapperOutcome = result?.outcome ?? "ERROR";
    await this.persistOutcome(active.runId, outcome, detail);
    await this.store.clearStopRequest(active.runId);
    await this.store.clearActiveRun(active.runId);
    this.lastDerivedState.delete(active.runId);
    await this.audit("run.finalize", "failed", active, heartbeat, detail);
    return this.noActiveStatus();
  }

  private async noActiveStatus(): Promise<ControlStatus> {
    const persisted = await this.store.readControllerState();
    const error = persisted?.lastError ?? null;
    return {
      state: error ? "ERROR" : "STOPPED",
      canStart: true,
      canStop: false,
      canForceStop: false,
      activeRun: null,
      error,
      logTail: [],
    };
  }

  private activeStatus(
    state: ControllerState,
    active: ActiveRunRecord,
    heartbeat: BotHeartbeat | null,
    error: string | null,
    logTail: string[],
    canStop: boolean,
    canForceStop: boolean,
  ): ControlStatus {
    return {
      state,
      canStart: false,
      canStop,
      canForceStop,
      activeRun: {
        runId: active.runId,
        requestedMode: active.requestedMode,
        modeSource: active.modeSource,
        requestedAt: active.requestedAt,
        stopRequestedAt: active.stopRequestedAt,
        forceEligibleAt: active.forceEligibleAt,
        wrapperPid: active.wrapper?.pid ?? null,
        botPid: heartbeat?.bot.pid ?? null,
        sessionId: heartbeat?.sessionId ?? null,
        heartbeatUpdatedAt: heartbeat?.updatedAt ?? null,
      },
      error,
      logTail,
    };
  }

  private async trackedActiveStatus(
    state: ControllerState,
    active: ActiveRunRecord,
    heartbeat: BotHeartbeat | null,
    error: string | null,
    logTail: string[],
    canStop: boolean,
    canForceStop: boolean,
  ): Promise<ControlStatus> {
    const stateKey = `${state}:${error ?? ""}`;
    if (this.lastDerivedState.get(active.runId) !== stateKey) {
      this.lastDerivedState.set(active.runId, stateKey);
      try {
        await this.audit(
          state === "ERROR" ? "state.error" : "state.transition",
          state === "ERROR" ? "failed" : "accepted",
          active,
          heartbeat,
          error ?? `State ${state}.`,
        );
      } catch (auditError) {
        this.lastDerivedState.delete(active.runId);
        throw auditError;
      }
    }
    return this.activeStatus(state, active, heartbeat, error, logTail, canStop, canForceStop);
  }

  private async matchingHeartbeat(active: ActiveRunRecord): Promise<BotHeartbeat | null> {
    const heartbeat = await this.store.readHeartbeat();
    return heartbeat?.runId === active.runId ? heartbeat : null;
  }

  private async persistOutcome(runId: string, outcome: WrapperOutcome, error: string | null): Promise<void> {
    await this.store.writeControllerState({
      schemaVersion: CONTROL_SCHEMA_VERSION,
      lastRunId: runId,
      lastOutcome: outcome,
      lastError: sanitizeDetail(error),
      updatedAt: new Date(this.now()).toISOString(),
    });
  }

  private async audit(
    action: string,
    outcome: ControlAuditRecord["outcome"],
    active: ActiveRunRecord | null,
    heartbeat: BotHeartbeat | null,
    detail: unknown,
  ): Promise<void> {
    await this.store.appendAudit({
      schemaVersion: CONTROL_SCHEMA_VERSION,
      timestamp: new Date(this.now()).toISOString(),
      action,
      outcome,
      runId: active?.runId ?? null,
      sessionId: heartbeat?.sessionId ?? null,
      detail: sanitizeDetail(detail),
    });
  }
}
