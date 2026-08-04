import { execFile, spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { open, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ProcessIdentity,
  ProcessInspection,
  RuntimeProcessAdapter,
  SpawnRunRequest,
  WrapperHandle,
} from "./contracts";

interface LogHandle {
  readonly fd: number;
  close(): Promise<void>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface WindowsProcessAdapterOptions {
  currentPid?: number;
  openLog?: (path: string, flags: "a") => Promise<LogHandle>;
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  runCommand?: (command: string, args: readonly string[]) => Promise<CommandResult>;
  identityLookupAttempts?: number;
  identityLookupDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  writeFileExclusive?: (path: string, contents: string) => Promise<void>;
  renameFile?: (from: string, to: string) => Promise<void>;
}

function defaultRunCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          rejectCommand(error);
          return;
        }
        resolveCommand({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function assertNumericPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid numeric process ID: ${pid}`);
  }
}

export function buildStartGatePath(controlDir: string, runId: string): string {
  return resolve(controlDir, `start-gate-${runId.toLowerCase()}.json`);
}

export function buildRunBotArgs(
  request: SpawnRunRequest,
  startGatePath = buildStartGatePath(request.controlDir, request.runId),
): string[] {
  return [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(request.repoRoot, "run_bot.ps1"),
    "-Mode", request.mode,
    "-RunId", request.runId,
    "-ControlDirectory", request.controlDir,
    "-StartGatePath", startGatePath,
    "-NonInteractive", "-SkipBuild", "-DisableEmbeddedUi",
  ];
}

export function sameProcessStart(expected: string, actual: string): boolean {
  const expectedMs = Date.parse(expected);
  const actualMs = Date.parse(actual);
  if (!Number.isFinite(expectedMs) || !Number.isFinite(actualMs)) return false;
  return Math.abs(expectedMs - actualMs) <= 1_000;
}

export class WindowsProcessAdapter implements RuntimeProcessAdapter {
  private readonly currentPid: number;
  private readonly openLog: (path: string, flags: "a") => Promise<LogHandle>;
  private readonly spawnProcess: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  private readonly runCommand: (command: string, args: readonly string[]) => Promise<CommandResult>;
  private readonly identityLookupAttempts: number;
  private readonly identityLookupDelayMs: number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly removeFile: (path: string) => Promise<void>;
  private readonly writeFileExclusive: (path: string, contents: string) => Promise<void>;
  private readonly renameFile: (from: string, to: string) => Promise<void>;

  constructor(options: WindowsProcessAdapterOptions = {}) {
    this.currentPid = options.currentPid ?? process.pid;
    this.openLog = options.openLog ?? ((path, flags) => open(path, flags));
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, [...args], spawnOptions));
    this.runCommand = options.runCommand ?? defaultRunCommand;
    this.identityLookupAttempts = Math.max(1, Math.floor(options.identityLookupAttempts ?? 5));
    this.identityLookupDelayMs = Math.max(0, Math.floor(options.identityLookupDelayMs ?? 100));
    this.wait = options.wait ?? (async (milliseconds) => { await delay(milliseconds); });
    this.removeFile = options.removeFile ?? (async (path) => { await rm(path, { force: true }); });
    this.writeFileExclusive = options.writeFileExclusive
      ?? (async (path, contents) => { await writeFile(path, contents, { encoding: "utf8", flag: "wx" }); });
    this.renameFile = options.renameFile ?? rename;
  }

  private async cleanupStartGate(startGatePath: string): Promise<void> {
    const outcomes = await Promise.allSettled([
      this.removeFile(startGatePath),
      this.removeFile(`${startGatePath}.tmp`),
    ]);
    const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (failure) throw failure.reason;
  }

  private async publishStartGate(
    startGatePath: string,
    runId: string,
    assertWrapperAlive: () => void,
  ): Promise<void> {
    const tempPath = `${startGatePath}.tmp`;
    const contents = JSON.stringify({ schemaVersion: 1, runId: runId.toLowerCase(), released: true });
    await this.writeFileExclusive(tempPath, contents);
    assertWrapperAlive();
    await this.renameFile(tempPath, startGatePath);
  }

  private async readProcessStart(pid: number): Promise<string | null> {
    assertNumericPid(pid);
    const command = [
      '$ErrorActionPreference = "Stop"',
      `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      "if ($null -eq $process) { exit 3 }",
      '($process | Select-Object -ExpandProperty StartTime).ToUniversalTime().ToString("o")',
    ].join("; ");

    let result: CommandResult;
    try {
      result = await this.runCommand("powershell.exe", ["-NoProfile", "-Command", command]);
    } catch (error) {
      if (Number((error as NodeJS.ErrnoException).code) === 3) return null;
      throw error;
    }

    const value = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    const timestampMs = value ? Date.parse(value) : Number.NaN;
    if (!Number.isFinite(timestampMs)) {
      throw new Error(`Unable to parse process start time for PID ${pid}.`);
    }
    return new Date(timestampMs).toISOString();
  }

  private async readSpawnedProcessStart(pid: number): Promise<string | null> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.identityLookupAttempts; attempt += 1) {
      try {
        const startedAt = await this.readProcessStart(pid);
        if (startedAt) return startedAt;
      } catch (error) {
        lastError = error;
      }
      if (attempt < this.identityLookupAttempts) await this.wait(this.identityLookupDelayMs);
    }
    if (lastError) throw lastError;
    return null;
  }

  async currentIdentity(): Promise<ProcessIdentity> {
    const startedAt = await this.readProcessStart(this.currentPid);
    if (!startedAt) {
      throw new Error(`Current process PID ${this.currentPid} is not available.`);
    }
    return { pid: this.currentPid, startedAt };
  }

  async spawnRun(request: SpawnRunRequest): Promise<WrapperHandle> {
    const startGatePath = buildStartGatePath(request.controlDir, request.runId);
    await this.cleanupStartGate(startGatePath);
    const log = await this.openLog(request.logPath, "a");
    let child: ChildProcess;
    try {
      child = this.spawnProcess("powershell.exe", buildRunBotArgs(request, startGatePath), {
        cwd: request.repoRoot,
        detached: false,
        windowsHide: true,
        stdio: ["ignore", log.fd, log.fd],
      });
    } catch (error) {
      await log.close();
      await this.cleanupStartGate(startGatePath).catch(() => undefined);
      throw error;
    }

    const completion = new Promise<{ exitCode: number; signal: string | null }>((resolveCompletion, rejectCompletion) => {
      child.once("error", rejectCompletion);
      child.once("close", (code, signal) => {
        resolveCompletion({ exitCode: code ?? 1, signal: signal == null ? null : String(signal) });
      });
    });
    void completion.catch(() => undefined);

    let childExited = false;
    let signalChildExit!: () => void;
    const childExitSignal = new Promise<void>((resolveExit) => { signalChildExit = resolveExit; });
    const markChildExited = () => {
      childExited = true;
      signalChildExit();
    };
    child.once("exit", markChildExited);
    child.once("error", markChildExited);

    const pid = child.pid;
    if (!pid) {
      await log.close();
      await this.cleanupStartGate(startGatePath).catch(() => undefined);
      void completion.catch(() => undefined);
      throw new Error("Controlled PowerShell wrapper did not provide a process ID.");
    }
    const terminateUnverifiedChild = () => {
      try {
        child.kill();
      } catch {
        // Preserve the identity-verification error; this handle is the only
        // process reference safe to terminate before StartTime is verified.
      }
    };
    let logClosed = false;
    const closeLog = async (): Promise<void> => {
      if (logClosed) return;
      logClosed = true;
      await log.close();
    };
    let startedAt: string | null;
    try {
      const verification = await Promise.race([
        this.readSpawnedProcessStart(pid).then(
          (value) => ({ type: "identity" as const, value }),
          (error: unknown) => ({ type: "error" as const, error }),
        ),
        childExitSignal.then(() => ({ type: "exit" as const })),
      ]);
      if (verification.type === "exit") {
        throw new Error(`Controlled PowerShell wrapper PID ${pid} exited before identity verification.`);
      }
      if (verification.type === "error") throw verification.error;
      startedAt = verification.value;
      if (childExited || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Controlled PowerShell wrapper PID ${pid} exited before identity verification.`);
      }
    } catch (error) {
      terminateUnverifiedChild();
      await closeLog().catch(() => undefined);
      await this.cleanupStartGate(startGatePath).catch(() => undefined);
      void completion.catch(() => undefined);
      throw error;
    }
    if (!startedAt) {
      terminateUnverifiedChild();
      await closeLog().catch(() => undefined);
      await this.cleanupStartGate(startGatePath).catch(() => undefined);
      void completion.catch(() => undefined);
      throw new Error(`Controlled PowerShell wrapper PID ${pid} exited before identity verification.`);
    }
    try {
      await closeLog();
    } catch (error) {
      terminateUnverifiedChild();
      await this.cleanupStartGate(startGatePath).catch(() => undefined);
      void completion.catch(() => undefined);
      throw error;
    }
    try {
      child.unref();
    } catch (error) {
      terminateUnverifiedChild();
      await this.cleanupStartGate(startGatePath).catch(() => undefined);
      throw error;
    }

    const completionWithGateCleanup = completion.finally(async () => {
      await this.cleanupStartGate(startGatePath);
    });
    let launchState: "prepared" | "released" | "aborted" = "prepared";
    const assertWrapperAlive = () => {
      if (childExited || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Controlled PowerShell wrapper PID ${pid} exited before start-gate release.`);
      }
    };

    return {
      identity: { pid, startedAt },
      completion: completionWithGateCleanup,
      releaseStart: async () => {
        if (launchState !== "prepared") throw new Error(`Wrapper start is already ${launchState}.`);
        assertWrapperAlive();
        try {
          await this.publishStartGate(startGatePath, request.runId, assertWrapperAlive);
          launchState = "released";
        } catch (error) {
          await this.cleanupStartGate(startGatePath).catch(() => undefined);
          throw error;
        }
      },
      abortStart: async () => {
        if (launchState === "released") throw new Error("Cannot abort a wrapper after its start gate was released.");
        if (launchState === "aborted") return;
        launchState = "aborted";
        terminateUnverifiedChild();
        await this.cleanupStartGate(startGatePath);
      },
    };
  }

  async inspect(identity: ProcessIdentity): Promise<ProcessInspection> {
    const startedAt = await this.readProcessStart(identity.pid);
    if (!startedAt) return "absent";
    return sameProcessStart(identity.startedAt, startedAt) ? "alive" : "identity_mismatch";
  }

  async forceKillTree(identity: ProcessIdentity): Promise<void> {
    const inspection = await this.inspect(identity);
    if (inspection !== "alive") {
      throw new Error(
        inspection === "absent"
          ? `Cannot force-kill PID ${identity.pid} because the process is absent.`
          : `Refusing to force-kill PID ${identity.pid} because its process identity does not match.`,
      );
    }
    await this.runCommand("taskkill.exe", ["/PID", String(identity.pid), "/T", "/F"]);
  }
}
