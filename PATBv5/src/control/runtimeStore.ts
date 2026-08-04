import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ActiveRunRecord,
  BotHeartbeat,
  ControlAuditRecord,
  PersistedControllerState,
  ProcessIdentity,
  StopRequest,
  WrapperResult,
} from "./contracts";

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

export function createControlPaths(controlDir: string): ControlPaths {
  const resolvedControlDir = resolve(controlDir);
  return {
    controlDir: resolvedControlDir,
    controllerLock: join(resolvedControlDir, "controller.lock"),
    activeRun: join(resolvedControlDir, "active-run.json"),
    heartbeat: join(resolvedControlDir, "bot-heartbeat.json"),
    stopRequest: join(resolvedControlDir, "stop-request.json"),
    wrapperResult: join(resolvedControlDir, "wrapper-result.json"),
    controllerState: join(resolvedControlDir, "controller-state.json"),
    audit: join(resolvedControlDir, "control-audit.jsonl"),
    logsDir: join(resolvedControlDir, "logs"),
  };
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    if (raw.trim().length === 0) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function writeJsonAtomic(path: string, record: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function writeExclusive(path: string, record: unknown, conflictMessage: string): Promise<void> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, "wx");
    await file.writeFile(JSON.stringify(record), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(conflictMessage);
    }
    if (file) {
      await file.close();
      file = undefined;
      await unlink(path).catch(() => undefined);
    }
    throw error;
  } finally {
    await file?.close();
  }
}

async function removeFile(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.pid === right.pid && left.startedAt === right.startedAt;
}

const LOG_TAIL_MAX_BYTES = 256 * 1024;
const secretAssignmentPattern = /(?:pass[\s_-]*word|secret|token|api[\s_-]*key|private[\s_-]*key|pass[\s_-]*phrase|pg[\s_-]*pass[\s_-]*word)\s*[:=]/i;

export class ControlRuntimeStore {
  constructor(readonly paths: ControlPaths) {}

  async ensure(): Promise<void> {
    await mkdir(this.paths.controlDir, { recursive: true });
    await mkdir(this.paths.logsDir, { recursive: true });
  }

  async acquireControllerLock(identity: ProcessIdentity): Promise<void> {
    await writeExclusive(this.paths.controllerLock, identity, "Controller lock already exists.");
  }

  readControllerLock(): Promise<ProcessIdentity | null> {
    return readJson(this.paths.controllerLock);
  }

  async releaseControllerLock(identity: ProcessIdentity): Promise<boolean> {
    const current = await this.readControllerLock();
    if (!current || !sameIdentity(current, identity)) return false;
    return removeFile(this.paths.controllerLock);
  }

  async createActiveRun(record: ActiveRunRecord): Promise<void> {
    await writeExclusive(this.paths.activeRun, record, "Active run already exists.");
  }

  readActiveRun(): Promise<ActiveRunRecord | null> {
    return readJson(this.paths.activeRun);
  }

  writeActiveRun(record: ActiveRunRecord): Promise<void> {
    return writeJsonAtomic(this.paths.activeRun, record);
  }

  async clearActiveRun(runId: string): Promise<boolean> {
    const current = await this.readActiveRun();
    if (!current || current.runId !== runId) return false;
    return removeFile(this.paths.activeRun);
  }

  readHeartbeat(): Promise<BotHeartbeat | null> {
    return readJson(this.paths.heartbeat);
  }

  writeHeartbeat(record: BotHeartbeat): Promise<void> {
    return writeJsonAtomic(this.paths.heartbeat, record);
  }

  readStopRequest(): Promise<StopRequest | null> {
    return readJson(this.paths.stopRequest);
  }

  writeStopRequest(record: StopRequest): Promise<void> {
    return writeJsonAtomic(this.paths.stopRequest, record);
  }

  async clearStopRequest(runId: string): Promise<boolean> {
    const current = await this.readStopRequest();
    if (!current || current.runId !== runId) return false;
    return removeFile(this.paths.stopRequest);
  }

  readWrapperResult(): Promise<WrapperResult | null> {
    return readJson(this.paths.wrapperResult);
  }

  writeWrapperResult(record: WrapperResult): Promise<void> {
    return writeJsonAtomic(this.paths.wrapperResult, record);
  }

  readControllerState(): Promise<PersistedControllerState | null> {
    return readJson(this.paths.controllerState);
  }

  writeControllerState(record: PersistedControllerState): Promise<void> {
    return writeJsonAtomic(this.paths.controllerState, record);
  }

  appendAudit(record: ControlAuditRecord): Promise<void> {
    return appendFile(this.paths.audit, `${JSON.stringify(record)}\n`, "utf8");
  }

  async readLogTail(path: string, maxLines = 200): Promise<string[]> {
    const limit = Number.isFinite(maxLines) ? Math.max(0, Math.floor(maxLines)) : 200;
    if (limit === 0) return [];

    let file: FileHandle;
    try {
      file = await open(path, "r");
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    try {
      const size = (await file.stat()).size;
      const bytesToRead = Math.min(size, LOG_TAIL_MAX_BYTES);
      const start = size - bytesToRead;
      const buffer = Buffer.alloc(bytesToRead);
      let totalBytesRead = 0;
      while (totalBytesRead < bytesToRead) {
        const { bytesRead } = await file.read(
          buffer,
          totalBytesRead,
          bytesToRead - totalBytesRead,
          start + totalBytesRead,
        );
        if (bytesRead === 0) break;
        totalBytesRead += bytesRead;
      }

      let content = buffer.subarray(0, totalBytesRead).toString("utf8");
      if (start > 0) {
        const firstLineEnd = content.indexOf("\n");
        if (firstLineEnd < 0) return [];
        content = content.slice(firstLineEnd + 1);
      }

      return content
        .split(/\r?\n/)
        .filter((line) => line.length > 0 && !secretAssignmentPattern.test(line))
        .slice(-limit);
    } finally {
      await file.close();
    }
  }
}
