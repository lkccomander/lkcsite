import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActiveSessionReader } from "../src/ui/state/activeSessionReader";

async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "patbv5-active-session-"));
  const sessionsDir = join(root, "sessions");
  mkdirSync(sessionsDir);
  try {
    const firstPath = join(sessionsDir, "2026-07-16T20-00-00-000Z__one.jsonl");
    const initial = Array.from({ length: 5001 }, (_, index) => ({
      type: index === 0 ? "bot.startup" : "feed.tick",
      timestamp: new Date(Date.parse("2026-07-16T20:00:00.000Z") + index).toISOString(),
      botId: "bot-v5",
      sessionId: "one",
      payload: index === 0 ? { mode: "LIVE" } : { sequence: index },
    }));
    writeFileSync(firstPath, `${initial.map((event) => JSON.stringify(event)).join("\n")}\n`);

    const readActiveSession = createActiveSessionReader(sessionsDir, "bot-v5");
    assert.equal((await readActiveSession()).length, 5001);

    appendFileSync(firstPath, `${JSON.stringify({ type: "feed.summary", timestamp: "2026-07-16T20:10:00.000Z", botId: "bot-v5", sessionId: "one", payload: {} })}\n`);
    assert.equal((await readActiveSession()).length, 5002);

    const secondPath = join(sessionsDir, "2026-07-16T21-00-00-000Z__two.jsonl");
    writeFileSync(secondPath, `${JSON.stringify({ type: "bot.startup", timestamp: "2026-07-16T21:00:00.000Z", botId: "bot-v5", sessionId: "two", payload: { mode: "PAPER" } })}\n`);
    const rolled = await readActiveSession();
    assert.equal(rolled.length, 1);
    assert.equal(rolled[0].sessionId, "two");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
