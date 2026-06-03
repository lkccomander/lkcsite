import * as fs from "fs";
import * as path from "path";

const DEFAULT_EVENTS_PATH = path.resolve(__dirname, "..", "..", "polydb", "telemetry", "events.jsonl");
const DEFAULT_SESSIONS_DIR = path.resolve(__dirname, "..", "..", "polydb", "telemetry", "sessions");

export function defaultEventsPath(): string {
  return DEFAULT_EVENTS_PATH;
}

export function normalizeCliPath(input: string): string {
  if (process.platform === "win32" && /^\/mnt\/[a-zA-Z]\//.test(input)) {
    const [, drive, rest] = input.match(/^\/mnt\/([a-zA-Z])\/(.*)$/) ?? [];
    if (drive && rest) {
      return `${drive.toUpperCase()}:\\${rest.replace(/\//g, "\\")}`;
    }
  }
  if (process.platform !== "win32" && /^[a-zA-Z]:\\/.test(input)) {
    const drive = input[0].toLowerCase();
    const rest = input.slice(3).replace(/\\/g, "/");
    return `/mnt/${drive}/${rest}`;
  }
  return input;
}

export function resolveTelemetryFile(sessionId: string | null, telemetryFileArg?: string | null): string {
  if (telemetryFileArg) {
    return path.resolve(normalizeCliPath(telemetryFileArg));
  }

  if (sessionId) {
    const sessionFile = findSessionFile(sessionId);
    if (sessionFile) {
      return sessionFile;
    }
  }

  return DEFAULT_EVENTS_PATH;
}

export function findSessionFile(sessionId: string): string | null {
  if (!fs.existsSync(DEFAULT_SESSIONS_DIR)) {
    return null;
  }

  const targetSuffix = `__${sessionId}.jsonl`;
  const candidates = fs.readdirSync(DEFAULT_SESSIONS_DIR)
    .filter((entry) => entry.endsWith(targetSuffix))
    .sort();

  if (!candidates.length) {
    return null;
  }

  return path.resolve(DEFAULT_SESSIONS_DIR, candidates[candidates.length - 1]);
}
