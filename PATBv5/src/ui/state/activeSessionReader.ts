import { open, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { TelemetryEvent } from "./telemetryEvent";

export function createActiveSessionReader(sessionsDir: string, botId: string): () => Promise<TelemetryEvent[]> {
  let activePath: string | null = null;
  let offset = 0;
  let remainder = "";
  let events: TelemetryEvent[] = [];

  return async () => {
    let names: string[];
    try {
      names = (await readdir(sessionsDir)).filter((name) => name.endsWith(".jsonl")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const latestName = names.at(-1);
    if (!latestName) return [];
    const latestPath = resolve(sessionsDir, latestName);
    const size = (await stat(latestPath)).size;
    if (activePath !== latestPath || size < offset) {
      activePath = latestPath;
      offset = 0;
      remainder = "";
      events = [];
    }
    if (size === offset) return [...events];

    const file = await open(latestPath, "r");
    try {
      const buffer = Buffer.alloc(size - offset);
      await file.read(buffer, 0, buffer.length, offset);
      offset = size;
      const lines = `${remainder}${buffer.toString("utf8")}`.split(/\r?\n/);
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as TelemetryEvent;
          if (event.botId === botId) events.push(event);
        } catch {
          continue;
        }
      }
      return [...events];
    } finally {
      await file.close();
    }
  };
}
