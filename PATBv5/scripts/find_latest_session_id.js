#!/usr/bin/env node

const fs = require("fs");
const readline = require("readline");

async function main() {
  const eventsPath = process.argv[2];
  const botId = process.argv[3];

  if (!eventsPath || !botId) {
    console.error("Usage: node scripts/find_latest_session_id.js <events.jsonl> <botId>");
    process.exit(1);
  }

  const stream = fs.createReadStream(eventsPath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let latestSessionId = "";
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line);
      if (event.botId === botId && event.sessionId) {
        latestSessionId = String(event.sessionId);
      }
    } catch {
      // Ignore malformed telemetry lines and keep scanning.
    }
  }

  if (latestSessionId) {
    process.stdout.write(latestSessionId);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
