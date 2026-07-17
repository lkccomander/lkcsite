import { isAbsolute, resolve } from "node:path";
import {
  CONTROL_SCHEMA_VERSION,
  HEARTBEAT_INTERVAL_MS,
  STOP_POLL_INTERVAL_MS,
} from "./contracts";
import type {
  BotRuntimeState,
  ProcessIdentity,
  RequestedMode,
} from "./contracts";
import type { ControlRuntimeStore } from "./runtimeStore";

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ControlledRunConfig {
  runId: string;
  controlDir: string;
}

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

export function readControlledRunConfig(env: NodeJS.ProcessEnv = process.env): ControlledRunConfig | null {
  const runId = env.CODEX_CONTROL_RUN_ID?.trim() ?? "";
  const controlDir = env.CODEX_CONTROL_DIR?.trim() ?? "";

  if (!runId && !controlDir) return null;
  if (!runId || !controlDir) {
    throw new Error("CODEX_CONTROL_RUN_ID and CODEX_CONTROL_DIR must be provided together.");
  }
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("CODEX_CONTROL_RUN_ID must be a valid UUID v4.");
  }

  const resolvedControlDir = resolve(controlDir);
  if (!isAbsolute(resolvedControlDir)) {
    throw new Error("CODEX_CONTROL_DIR must resolve to an absolute path.");
  }
  return { runId, controlDir: resolvedControlDir };
}

export function createBotRuntimeControl(options: BotRuntimeControlOptions): BotRuntimeControl {
  if (!RUN_ID_PATTERN.test(options.runId)) {
    throw new Error("Bot runtime control runId must be a valid UUID v4.");
  }

  const now = options.now ?? Date.now;
  let currentStatus: BotRuntimeState = "RUNNING";
  let stopHandled = false;
  let closed = false;
  let operationTail: Promise<void> = Promise.resolve();
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let stopPollTimer: NodeJS.Timeout | null = null;

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function writeHeartbeat(status: BotRuntimeState): Promise<void> {
    return options.store.writeHeartbeat({
      schemaVersion: CONTROL_SCHEMA_VERSION,
      runId: options.runId,
      mode: options.mode,
      sessionId: options.sessionId,
      bot: options.bot,
      status,
      updatedAt: new Date(now()).toISOString(),
    });
  }

  function publish(status: BotRuntimeState): Promise<void> {
    return serialize(async () => {
      if (closed) return;
      currentStatus = status;
      await writeHeartbeat(currentStatus);
    });
  }

  async function pollStopRequest(): Promise<boolean> {
    const shouldStop = await serialize(async () => {
      if (closed || stopHandled) return false;
      const request = await options.store.readStopRequest();
      if (!request || request.runId !== options.runId) return false;

      currentStatus = "STOPPING";
      await writeHeartbeat(currentStatus);
      const cleared = await options.store.clearStopRequest(options.runId);
      if (!cleared) return false;
      stopHandled = true;
      return true;
    });

    if (!shouldStop) return false;
    // The shutdown callback may publish its own final status and close this
    // handle, so invoke it only after releasing the serialized operation tail.
    await options.onStop();
    return true;
  }

  async function close(): Promise<void> {
    if (!closed) {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (stopPollTimer) clearInterval(stopPollTimer);
      heartbeatTimer = null;
      stopPollTimer = null;
    }
    await operationTail;
  }

  if (options.autoStart !== false) {
    heartbeatTimer = setInterval(() => {
      void serialize(async () => {
        if (!closed) await writeHeartbeat(currentStatus);
      }).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    stopPollTimer = setInterval(() => {
      void pollStopRequest().catch(() => undefined);
    }, STOP_POLL_INTERVAL_MS);
    heartbeatTimer.unref();
    stopPollTimer.unref();
  }

  return {
    runId: options.runId,
    publish,
    pollStopRequest,
    close,
  };
}
