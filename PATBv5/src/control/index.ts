import { createHash, randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { normalize, resolve } from "node:path";
import { readOptionalConfigEnv } from "../config/secrets";
import { getUiPort, getUiRouteBase } from "../ui/server";
import type { ProcessIdentity } from "./contracts";
import { startControlHttpServer } from "./httpServer";
import { RuntimeController } from "./runtimeController";
import { ControlRuntimeStore, createControlPaths } from "./runtimeStore";
import { WindowsProcessAdapter } from "./windowsProcessAdapter";

const SECRET_ASSIGNMENT_PATTERN = /(?:pass[\s_-]*word|secret|token|api[\s_-]*key|private[\s_-]*key|pass[\s_-]*phrase)\s*[:=]/i;

function safeErrorMessage(error: unknown): string {
  const compact = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").trim();
  const secret = SECRET_ASSIGNMENT_PATTERN.exec(compact);
  if (!secret) return compact.slice(0, 500);
  const safePrefix = compact.slice(0, secret.index).trim();
  return `${safePrefix}${safePrefix ? " " : ""}[REDACTED]`.slice(0, 500);
}

async function controlMutexPath(controlDir: string): Promise<string> {
  const canonicalControlDir = await realpath(controlDir);
  const normalizedControlDir = normalize(resolve(canonicalControlDir)).toLowerCase();
  const controlDirHash = createHash("sha256").update(normalizedControlDir, "utf8").digest("hex").slice(0, 32);
  return `\\\\.\\pipe\\patbv5-codex-${controlDirHash}`;
}

async function acquireControlMutex(controlDir: string): Promise<Server> {
  const pipePath = await controlMutexPath(controlDir);
  const server = createServer((socket) => socket.destroy());
  return new Promise<Server>((resolveMutex, rejectMutex) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") {
        rejectMutex(new Error("A CODEX controller is already running for this workspace (OS mutex is occupied)."));
        return;
      }
      rejectMutex(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolveMutex(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(pipePath);
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const controlDir = resolve(repoRoot, "polydb", "runtime", "control");
  const store = new ControlRuntimeStore(createControlPaths(controlDir));
  const processes = new WindowsProcessAdapter();
  let controlMutex: Server | null = null;
  let controllerIdentity: ProcessIdentity | null = null;
  let fileLockHeld = false;
  let listening: Awaited<ReturnType<typeof startControlHttpServer>> | null = null;
  let reconcileTimer: NodeJS.Timeout | null = null;

  try {
    await store.ensure();
    controlMutex = await acquireControlMutex(controlDir);

    controllerIdentity = await processes.currentIdentity();
    const existingController = await store.readControllerLock();
    if (existingController) {
      const existingState = await processes.inspect(existingController);
      if (existingState === "alive") {
        throw new Error(`CODEX controller already running with PID ${existingController.pid}`);
      }
      await store.releaseControllerLock(existingController);
    }
    await store.acquireControllerLock(controllerIdentity);
    fileLockHeld = true;
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
    const initialStatus = await controller.initialize();
    const csrfToken = randomBytes(32).toString("hex");
    const openBrowser = ["1", "true", "yes", "on"].includes(
      readOptionalConfigEnv("UI_OPEN_BROWSER").toLowerCase(),
    );
    listening = await startControlHttpServer({
      controller,
      routeBase: getUiRouteBase(),
      csrfToken,
      preferredPort: getUiPort(),
      openBrowser,
    });

    reconcileTimer = setInterval(() => {
      void controller.reconcile().catch((error) => console.error(safeErrorMessage(error)));
    }, 500);

    let closing = false;
    const closeController = async (reason: string): Promise<void> => {
      if (closing) return;
      closing = true;
      if (reconcileTimer) clearInterval(reconcileTimer);

      let exitCode = 0;
      try {
        const activeRun = await store.readActiveRun();
        const heartbeat = await store.readHeartbeat();
        await store.appendAudit({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          action: "controller.exited",
          outcome: "completed",
          runId: activeRun?.runId ?? null,
          sessionId: heartbeat?.runId === activeRun?.runId ? heartbeat.sessionId : null,
          detail: reason,
        });
      } catch (error) {
        exitCode = 1;
        console.error(safeErrorMessage(error));
      }

      try {
        await closeServer(listening?.server ?? null);
      } catch (error) {
        exitCode = 1;
        console.error(safeErrorMessage(error));
      }

      try {
        await store.releaseControllerLock(controllerIdentity!);
        fileLockHeld = false;
      } catch (error) {
        exitCode = 1;
        console.error(safeErrorMessage(error));
      }

      try {
        await closeServer(controlMutex);
        controlMutex = null;
      } catch (error) {
        exitCode = 1;
        console.error(safeErrorMessage(error));
      }
      process.exit(exitCode);
    };

    process.once("SIGINT", () => void closeController("SIGINT"));
    process.once("SIGTERM", () => void closeController("SIGTERM"));
    console.log(`CODEX controller listening at ${listening.url} | state=${initialStatus.state}`);
  } catch (startupError) {
    if (reconcileTimer) clearInterval(reconcileTimer);
    try {
      await closeServer(listening?.server ?? null);
    } catch (cleanupError) {
      console.error(safeErrorMessage(cleanupError));
    }
    if (fileLockHeld && controllerIdentity) {
      try {
        await store.releaseControllerLock(controllerIdentity);
        fileLockHeld = false;
      } catch (cleanupError) {
        console.error(safeErrorMessage(cleanupError));
      }
    }
    try {
      await closeServer(controlMutex);
      controlMutex = null;
    } catch (cleanupError) {
      console.error(safeErrorMessage(cleanupError));
    }
    throw startupError;
  }
}

void main().catch((error) => {
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
});
