import * as fs from "fs";
import * as readline from "readline";
import { resolveTelemetryFile } from "./telemetry_paths";

type TelemetryEvent = {
  type?: string;
  timestamp?: string;
  botId?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

type Args = {
  botId: string;
  sessionId: string | null;
  telemetryFile: string;
};

const DEFAULT_BOT_ID = "polymarket-bot-v5";

function parseArgs(argv: string[]): Args {
  const botIndex = argv.findIndex((arg) => arg === "--bot-id");
  const sessionIndex = argv.findIndex((arg) => arg === "--session-id");
  const telemetryIndex = argv.findIndex((arg) => arg === "--telemetry-file");
  const sessionId = sessionIndex >= 0 && argv[sessionIndex + 1] ? argv[sessionIndex + 1] : null;
  const telemetryFileArg = telemetryIndex >= 0 && argv[telemetryIndex + 1] ? argv[telemetryIndex + 1] : null;
  return {
    botId: botIndex >= 0 && argv[botIndex + 1] ? argv[botIndex + 1] : DEFAULT_BOT_ID,
    sessionId,
    telemetryFile: resolveTelemetryFile(sessionId, telemetryFileArg),
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

type CheckResult = {
  label: string;
  passed: boolean;
  details: string;
};

function printCheck(label: string, passed: boolean, details: string): CheckResult {
  console.log(`[${passed ? "PASS" : "FAIL"}] ${label}: ${details}`);
  return { label, passed, details };
}

function pickSession(events: TelemetryEvent[], explicitSessionId: string | null): string | null {
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const candidates = events
    .filter((event) => typeof event.sessionId === "string" && typeof event.timestamp === "string")
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

  return candidates.length ? (candidates[candidates.length - 1].sessionId ?? null) : null;
}

function tradeKey(event: TelemetryEvent): string | null {
  const payload = event.payload ?? {};
  const sessionId = event.sessionId ?? "no-session";
  const side = asString(payload.side);
  const tokenId = asString(payload.tokenId);
  if (!side || !tokenId) {
    return null;
  }
  return `${sessionId}:${tokenId}:${side}`;
}

async function loadEvents(telemetryFile: string, botId: string): Promise<TelemetryEvent[]> {
  if (!fs.existsSync(telemetryFile)) {
    throw new Error(`Telemetry file not found: ${telemetryFile}`);
  }

  const events: TelemetryEvent[] = [];
  const stream = fs.createReadStream(telemetryFile, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line) as TelemetryEvent;
      if (event.botId === botId) {
        events.push(event);
      }
    } catch {
      continue;
    }
  }

  return events;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const events = await loadEvents(args.telemetryFile, args.botId);
  const sessionId = pickSession(events, args.sessionId);

  if (!sessionId) {
    console.log(`No session found for bot ${args.botId}.`);
    return;
  }

  const sessionEvents = events.filter((event) => event.sessionId === sessionId);
  const liveBuys = sessionEvents.filter((event) => event.type === "live_trade.buy");
  const liveSells = sessionEvents.filter((event) => event.type === "live_trade.sell");
  const paperBuys = sessionEvents.filter((event) => event.type === "paper_trade.buy");
  const paperSells = sessionEvents.filter((event) => event.type === "paper_trade.sell");
  const accepted = sessionEvents.filter((event) => event.type === "trade.signal_accepted");
  const rejections = sessionEvents.filter((event) => event.type === "trade.signal_rejected");
  const momentum = sessionEvents.filter((event) => event.type === "signal.momentum");
  const monteCarlo = sessionEvents.filter((event) => event.type === "signal.montecarlo");
  const fallback = sessionEvents.filter((event) => event.type === "feed.fallback");
  const fallbackRecovered = sessionEvents.filter((event) => event.type === "feed.fallback_recovered");
  const exitPending = sessionEvents.filter((event) => event.type === "trade.exit_pending");
  const exitSkippedExisting = sessionEvents.filter((event) => event.type === "trade.exit_skipped_existing_live_order");
  const exitFilled = sessionEvents.filter((event) => event.type === "trade.exit_filled");
  const exitFailed = sessionEvents.filter((event) => event.type === "trade.exit_failed");
  const positionResolved = sessionEvents.filter((event) => event.type === "trade.position_resolved");
  const positionUnresolved = sessionEvents.filter((event) => event.type === "trade.position_unresolved");

  const fallbackDurations = fallbackRecovered
    .map((event) => asNumber(event.payload?.fallbackDurationMs))
    .filter((value): value is number => value !== null);

  const requiredRawMomentumFields = [
    "rawDelta1m",
    "rawDelta5m",
    "rawVolRatio",
    "rawLatestOneMinuteClose",
    "rawFiveMinutesAgoClose",
    "rawLatestFiveMinuteClose",
    "rawFifteenMinutesAgoClose",
  ];
  const momentumWithRawFields = momentum.filter((event) =>
    requiredRawMomentumFields.every((field) => event.payload && field in event.payload),
  ).length;

  const openLots = new Map<string, number>();
  const lotLifecycleEvents = [
    ...paperBuys,
    ...liveBuys,
    ...paperSells,
    ...liveSells,
    ...exitFilled,
    ...positionResolved,
  ].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  for (const event of lotLifecycleEvents) {
    let key = tradeKey(event);
    if (!key && event.type === "trade.position_resolved") {
      const payload = event.payload ?? {};
      const sessionId = event.sessionId ?? "no-session";
      const sideBefore = asString(payload.sideBefore);
      let tokenId: string | null = null;
      if (sideBefore === "UP") {
        tokenId = asString(payload.upTokenId) ?? null;
      } else if (sideBefore === "DOWN") {
        tokenId = asString(payload.downTokenId) ?? null;
      }
      if (!tokenId) {
        tokenId = asString(payload.tokenId);
      }
      if (sideBefore && tokenId) {
        key = `${sessionId}:${tokenId}:${sideBefore}`;
      }
    }
    if (!key) {
      continue;
    }
    const current = openLots.get(key) ?? 0;
    if (event.type === "paper_trade.buy" || event.type === "live_trade.buy") {
      openLots.set(key, current + 1);
    } else {
      openLots.set(key, Math.max(0, current - 1));
    }
  }
  const unresolvedTradeKeys = [...openLots.entries()].filter(([, count]) => count > 0);
  const unresolvedSummary = unresolvedTradeKeys
    .slice(0, 5)
    .map(([key, count]) => `${key} x${count}`)
    .join("; ");

  console.log(`Bot: ${args.botId}`);
  console.log(`Session: ${sessionId}`);
  console.log(`Telemetry file: ${args.telemetryFile}`);
  console.log(`Accepted signals: ${accepted.length}`);
  console.log(`Rejected signals: ${rejections.length}`);
  console.log(`Live buys: ${liveBuys.length}`);
  console.log(`Live sells: ${liveSells.length}`);
  console.log(`Paper buys: ${paperBuys.length}`);
  console.log(`Paper sells: ${paperSells.length}`);
  console.log(`Momentum events: ${momentum.length}`);
  console.log(`Monte Carlo events: ${monteCarlo.length}`);
  console.log(`Fallback events: ${fallback.length}`);
  console.log(`Fallback recoveries: ${fallbackRecovered.length}`);
  console.log(`Exit pending events: ${exitPending.length}`);
  console.log(`Exit skipped existing live order: ${exitSkippedExisting.length}`);
  console.log(`Exit filled events: ${exitFilled.length}`);
  console.log(`Exit failed events: ${exitFailed.length}`);
  console.log(`Position resolved events: ${positionResolved.length}`);
  console.log(`Position unresolved events: ${positionUnresolved.length}`);

  console.log("\nReadiness Checks");
  const checks: CheckResult[] = [];
  checks.push(printCheck(
    "Momentum events present",
    momentum.length > 0,
    `${momentum.length} signal.momentum events`,
  ));
  checks.push(printCheck(
    "Monte Carlo events present",
    monteCarlo.length > 0,
    `${monteCarlo.length} signal.montecarlo events`,
  ));
  checks.push(printCheck(
    "Momentum raw telemetry present",
    momentum.length > 0 && momentumWithRawFields === momentum.length,
    `${momentumWithRawFields}/${momentum.length} signal.momentum events include raw fields`,
  ));
  checks.push(printCheck(
    "No unresolved buy/sell mismatches in telemetry",
    unresolvedTradeKeys.length === 0,
    unresolvedTradeKeys.length === 0
      ? "all buy lots matched by sell lots inside telemetry"
      : `${unresolvedTradeKeys.length} unresolved trade keys remain${unresolvedSummary ? ` | ${unresolvedSummary}` : ""}`,
  ));
  checks.push(printCheck(
    "No exit failures",
    exitFailed.length === 0,
    `${exitFailed.length} exit failure events`,
  ));
  checks.push(printCheck(
    "No explicit unresolved positions at market close",
    positionUnresolved.length === 0,
    `${positionUnresolved.length} position_unresolved events`,
  ));
  checks.push(printCheck(
    "Fallback recovery average <= 1000ms",
    fallbackDurations.length === 0 || (average(fallbackDurations) ?? 0) <= 1000,
    fallbackDurations.length ? `${average(fallbackDurations)} ms average` : "no fallback recoveries observed",
  ));
  checks.push(printCheck(
    "Exit skipped existing live order is controlled",
    exitSkippedExisting.length <= Math.max(1, exitFilled.length + liveSells.length),
    `${exitSkippedExisting.length} skip events vs ${exitFilled.length + liveSells.length} filled/closed exit events`,
  ));
  checks.push(printCheck(
    "At least one completion path exists when entries exist",
    liveBuys.length + paperBuys.length === 0 || liveSells.length + paperSells.length + exitFilled.length > 0,
    `${liveBuys.length + paperBuys.length} buys vs ${liveSells.length + paperSells.length + exitFilled.length} sell/exit-filled events`,
  ));

  const passedChecks = checks.filter((check) => check.passed).length;
  const failedChecks = checks.length - passedChecks;
  console.log("\nVerdict");
  console.log(`Passed checks: ${passedChecks}`);
  console.log(`Failed checks: ${failedChecks}`);
  console.log(`LIVE readiness verdict: ${failedChecks === 0 ? "READY" : "NOT READY"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
