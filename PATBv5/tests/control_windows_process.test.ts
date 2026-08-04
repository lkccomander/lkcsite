import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
  buildStartGatePath,
  buildRunBotArgs,
  sameProcessStart,
  WindowsProcessAdapter,
} from "../src/control/windowsProcessAdapter";

const request = {
  repoRoot: "C:\\Projects\\lkcsite\\PATBv5",
  controlDir: "C:\\Projects\\lkcsite\\PATBv5\\polydb\\runtime\\control",
  runId: "11111111-1111-4111-8111-111111111111",
  mode: "LIVE" as const,
  logPath: "C:\\temp\\run.log",
};

const startGatePath = buildStartGatePath(request.controlDir, request.runId);
const args = buildRunBotArgs(request, startGatePath);
assert.deepEqual(args, [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(request.repoRoot, "run_bot.ps1"),
  "-Mode", "LIVE",
  "-RunId", request.runId,
  "-ControlDirectory", request.controlDir,
  "-StartGatePath", startGatePath,
  "-NonInteractive", "-SkipBuild", "-DisableEmbeddedUi",
]);
assert.equal(sameProcessStart("2026-07-16T20:00:00.000Z", "2026-07-16T20:00:00.000Z"), true);
assert.equal(sameProcessStart("2026-07-16T20:00:00.000Z", "2026-07-16T20:00:00.900Z"), true);
assert.equal(sameProcessStart("2026-07-16T20:00:00.000Z", "2026-07-16T20:00:03.000Z"), false);

class FakeChild extends EventEmitter {
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  unrefCalled = false;
  killCalled = false;

  unref(): this {
    assert.ok(this.listenerCount("error") > 0, "error listener must be attached before unref");
    assert.ok(this.listenerCount("close") > 0, "close listener must be attached before unref");
    this.unrefCalled = true;
    return this;
  }

  kill(): boolean {
    this.killCalled = true;
    return true;
  }

  emitExit(code = 1): void {
    this.exitCode = code;
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }
}

async function run(): Promise<void> {
  const child = new FakeChild();
  let logClosed = false;
  let spawned: { command: string; args: readonly string[]; options: SpawnOptions } | null = null;
  const commandCalls: Array<{ command: string; args: readonly string[] }> = [];
  let wrapperLookupAttempts = 0;
  let identityWaits = 0;
  const gateOperations: string[] = [];
  const starts = new Map<number, string>([
    [99, "2026-07-16T19:59:00.000Z"],
    [42, "2026-07-16T20:00:00.500Z"],
    [43, "2026-07-16T20:00:03.000Z"],
    [4242, "2026-07-16T20:01:00.000Z"],
  ]);

  const adapter = new WindowsProcessAdapter({
    currentPid: 99,
    identityLookupAttempts: 3,
    identityLookupDelayMs: 1,
    wait: async (milliseconds) => {
      assert.equal(milliseconds, 1);
      identityWaits += 1;
    },
    removeFile: async (path) => { gateOperations.push(`remove:${path}`); },
    writeFileExclusive: async (path, contents) => {
      assert.equal(wrapperLookupAttempts, 3, "gate must publish only after PID + StartTime verification");
      const gate = JSON.parse(contents) as { schemaVersion: number; runId: string; released: boolean };
      assert.deepEqual(gate, { schemaVersion: 1, runId: request.runId, released: true });
      gateOperations.push(`write:${path}`);
    },
    renameFile: async (from, to) => { gateOperations.push(`rename:${from}->${to}`); },
    openLog: async (path, flags) => {
      assert.equal(path, request.logPath);
      assert.equal(flags, "a");
      return {
        fd: 88,
        close: async () => {
          assert.equal(wrapperLookupAttempts, 3, "log handle must stay open until wrapper identity verification completes");
          logClosed = true;
        },
      };
    },
    spawnProcess: (command, spawnArgs, options) => {
      spawned = { command, args: spawnArgs, options };
      return child as unknown as ChildProcess;
    },
    runCommand: async (command, commandArgs) => {
      commandCalls.push({ command, args: commandArgs });
      if (command === "taskkill.exe") return { stdout: "", stderr: "" };
      assert.equal(command, "powershell.exe");
      assert.deepEqual(commandArgs.slice(0, 2), ["-NoProfile", "-Command"]);
      const script = commandArgs[2] ?? "";
      const match = script.match(/Get-Process -Id (\d+)/);
      assert.ok(match, "process lookup must contain a numeric PID");
      const pid = Number(match[1]);
      if (pid === 4242) {
        wrapperLookupAttempts += 1;
        if (wrapperLookupAttempts < 3) throw Object.assign(new Error("process not visible yet"), { code: 3 });
      }
      const startedAt = starts.get(pid);
      if (!startedAt) throw Object.assign(new Error("process absent"), { code: 3 });
      return { stdout: `${startedAt}\r\n`, stderr: "" };
    },
  });

  const handle = await adapter.spawnRun(request);
  assert.equal(handle.identity.pid, 4242);
  assert.equal(handle.identity.startedAt, "2026-07-16T20:01:00.000Z");
  assert.equal(logClosed, true);
  assert.equal(child.unrefCalled, true);
  assert.equal(child.killCalled, false);
  assert.deepEqual(gateOperations, [
    `remove:${startGatePath}`,
    `remove:${startGatePath}.tmp`,
  ]);
  await handle.releaseStart();
  assert.deepEqual(gateOperations.slice(0, 4), [
    `remove:${startGatePath}`,
    `remove:${startGatePath}.tmp`,
    `write:${startGatePath}.tmp`,
    `rename:${startGatePath}.tmp->${startGatePath}`,
  ]);
  assert.equal(wrapperLookupAttempts, 3);
  assert.equal(identityWaits, 2);
  assert.equal(spawned?.command, "powershell.exe");
  assert.deepEqual(spawned?.args, args);
  assert.equal(spawned?.options.cwd, request.repoRoot);
  assert.equal(spawned?.options.detached, false);
  assert.equal(spawned?.options.windowsHide, true);
  assert.deepEqual(spawned?.options.stdio, ["ignore", 88, 88]);
  child.emit("close", 0, null);
  assert.deepEqual(await handle.completion, { exitCode: 0, signal: null });
  assert.deepEqual(gateOperations.slice(-2), [
    `remove:${startGatePath}`,
    `remove:${startGatePath}.tmp`,
  ]);

  assert.deepEqual(await adapter.currentIdentity(), {
    pid: 99,
    startedAt: "2026-07-16T19:59:00.000Z",
  });
  assert.equal(await adapter.inspect({ pid: 42, startedAt: "2026-07-16T20:00:00.000Z" }), "alive");
  assert.equal(await adapter.inspect({ pid: 43, startedAt: "2026-07-16T20:00:00.000Z" }), "identity_mismatch");
  assert.equal(await adapter.inspect({ pid: 44, startedAt: "2026-07-16T20:00:00.000Z" }), "absent");

  await assert.rejects(
    adapter.forceKillTree({ pid: 43, startedAt: "2026-07-16T20:00:00.000Z" }),
    /identity/i,
  );
  assert.equal(commandCalls.filter((call) => call.command === "taskkill.exe").length, 0);

  await adapter.forceKillTree({ pid: 42, startedAt: "2026-07-16T20:00:00.000Z" });
  const kill = commandCalls.find((call) => call.command === "taskkill.exe");
  assert.deepEqual(kill?.args, ["/PID", "42", "/T", "/F"]);

  const unverifiedChild = new FakeChild();
  let failedLookups = 0;
  let failedWaits = 0;
  let failedLogClosed = false;
  const failedGateOperations: string[] = [];
  const unverifiedAdapter = new WindowsProcessAdapter({
    identityLookupAttempts: 3,
    identityLookupDelayMs: 2,
    wait: async (milliseconds) => {
      assert.equal(milliseconds, 2);
      failedWaits += 1;
    },
    removeFile: async (path) => { failedGateOperations.push(`remove:${path}`); },
    writeFileExclusive: async (path) => { failedGateOperations.push(`write:${path}`); },
    renameFile: async (from, to) => { failedGateOperations.push(`rename:${from}->${to}`); },
    openLog: async () => ({ fd: 89, close: async () => { failedLogClosed = true; } }),
    spawnProcess: () => unverifiedChild as unknown as ChildProcess,
    runCommand: async (command) => {
      assert.equal(command, "powershell.exe", "unverified cleanup must never call taskkill by PID");
      failedLookups += 1;
      throw Object.assign(new Error("process not visible"), { code: 3 });
    },
  });
  await assert.rejects(unverifiedAdapter.spawnRun(request), /identity verification/i);
  assert.equal(failedLookups, 3);
  assert.equal(failedWaits, 2);
  assert.equal(failedLogClosed, true);
  assert.equal(unverifiedChild.killCalled, true);
  assert.equal(unverifiedChild.unrefCalled, false);
  assert.equal(failedGateOperations.some((operation) => operation.startsWith("write:")), false);
  assert.equal(failedGateOperations.some((operation) => operation.startsWith("rename:")), false);
  assert.deepEqual(failedGateOperations, [
    `remove:${startGatePath}`,
    `remove:${startGatePath}.tmp`,
    `remove:${startGatePath}`,
    `remove:${startGatePath}.tmp`,
  ]);

  const unpublishedChild = new FakeChild();
  const unpublishedGateOperations: string[] = [];
  const unpublishedAdapter = new WindowsProcessAdapter({
    identityLookupAttempts: 1,
    removeFile: async (path) => { unpublishedGateOperations.push(`remove:${path}`); },
    writeFileExclusive: async (path) => {
      unpublishedGateOperations.push(`write:${path}`);
      throw new Error("gate publication failed");
    },
    renameFile: async (from, to) => { unpublishedGateOperations.push(`rename:${from}->${to}`); },
    openLog: async () => ({ fd: 90, close: async () => undefined }),
    spawnProcess: () => unpublishedChild as unknown as ChildProcess,
    runCommand: async () => ({ stdout: "2026-07-16T20:01:00.000Z\r\n", stderr: "" }),
  });
  const unpublishedHandle = await unpublishedAdapter.spawnRun(request);
  await assert.rejects(unpublishedHandle.releaseStart(), /gate publication failed/i);
  await unpublishedHandle.abortStart();
  assert.equal(unpublishedChild.killCalled, true);
  assert.equal(unpublishedChild.unrefCalled, true);
  assert.equal(unpublishedGateOperations.some((operation) => operation.startsWith("rename:")), false);
  assert.deepEqual(unpublishedGateOperations, [
    `remove:${startGatePath}`,
    `remove:${startGatePath}.tmp`,
    `write:${startGatePath}.tmp`,
    `remove:${startGatePath}`,
    `remove:${startGatePath}.tmp`,
    `remove:${startGatePath}`,
    `remove:${startGatePath}.tmp`,
  ]);

  const exitedChild = new FakeChild();
  const exitedAdapter = new WindowsProcessAdapter({
    identityLookupAttempts: 1,
    removeFile: async () => undefined,
    openLog: async () => ({ fd: 91, close: async () => undefined }),
    spawnProcess: () => exitedChild as unknown as ChildProcess,
    runCommand: async () => {
      exitedChild.emitExit();
      return { stdout: "2026-07-16T20:01:01.000Z\r\n", stderr: "" };
    },
  });
  await assert.rejects(exitedAdapter.spawnRun(request), /exited before identity verification/i);
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
