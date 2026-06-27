import * as fs from "fs";
import * as readline from "readline";
import { buildTransitionDiagnostics, isTransitionRelatedEvent } from "./evaluation_transition";
import { resolveTelemetryFile } from "./telemetry_paths";

type TelemetryEvent = {
  type?: string;
  timestamp?: string;
  botId?: string;
  sessionId?: string;
  sessionStartedAt?: string;
  payload?: Record<string, unknown>;
};

const DEFAULT_BOT_ID = "polymarket-bot-v5";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function hasNumber(value: unknown): boolean {
  return Number.isFinite(typeof value === "number" ? value : Number(value));
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv: string[]): { botId: string; sessionId: string | null; telemetryFile: string } {
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

function printCheck(label: string, passed: boolean, details: string, status: "PASS" | "FAIL" | "SKIP" = passed ? "PASS" : "FAIL"): void {
  console.log(`[${status}] ${label}: ${details}`);
}

function asReason(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "unknown";
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function minRawValue(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  let min = values[0];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < min) {
      min = values[index];
    }
  }
  return min;
}

function maxValue(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  let max = values[0];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > max) {
      max = values[index];
    }
  }
  return round(max, 4);
}

function maxRawValue(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  let max = values[0];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > max) {
      max = values[index];
    }
  }
  return max;
}

async function loadEvents(botId: string, telemetryFile: string): Promise<TelemetryEvent[]> {
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

function pickSession(events: TelemetryEvent[], explicitSessionId: string | null): string | null {
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const candidates = events
    .filter((event) => event.sessionId && event.sessionStartedAt)
    .sort((a, b) => String(a.sessionStartedAt).localeCompare(String(b.sessionStartedAt)));

  return candidates.length ? (candidates[candidates.length - 1].sessionId ?? null) : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const events = await loadEvents(args.botId, args.telemetryFile);
  const sessionId = pickSession(events, args.sessionId);

  if (!sessionId) {
    console.log(`No session found for bot ${args.botId}.`);
    return;
  }

  const sessionEvents = events.filter((event) => event.sessionId === sessionId);
  const paperBuys = sessionEvents.filter((event) => event.type === "paper_trade.buy");
  const paperSells = sessionEvents.filter((event) => event.type === "paper_trade.sell");
  const liveBuys = sessionEvents.filter((event) => event.type === "live_trade.buy");
  const liveSells = sessionEvents.filter((event) => event.type === "live_trade.sell");
  const rejections = sessionEvents.filter((event) => event.type === "trade.signal_rejected");
  const fallbacks = sessionEvents.filter((event) => event.type === "feed.fallback");
  const fallbackRecoveries = sessionEvents.filter((event) => event.type === "feed.fallback_recovered");
  const momentumEvents = sessionEvents.filter((event) => event.type === "signal.momentum");
  const monteCarloEvents = sessionEvents.filter((event) => event.type === "signal.montecarlo");
  const marketSelections = sessionEvents.filter((event) => event.type === "market.selected");
  const transitionDiagnostics = buildTransitionDiagnostics(sessionEvents);
  const adjustedFallbacks = fallbacks.filter((event) => !isTransitionRelatedEvent(event, transitionDiagnostics));
  const adjustedFallbackRecoveries = fallbackRecoveries.filter((event) => !isTransitionRelatedEvent(event, transitionDiagnostics));
  const adjustedRejections = rejections.filter((event) => !isTransitionRelatedEvent(event, transitionDiagnostics));

  const timestamps = sessionEvents
    .map((event) => Date.parse(event.timestamp ?? ""))
    .filter((value) => Number.isFinite(value));
  const minTimestamp = minRawValue(timestamps);
  const maxTimestamp = maxRawValue(timestamps);
  const sessionDurationHours = minTimestamp !== null && maxTimestamp !== null && timestamps.length >= 2
    ? (maxTimestamp - minTimestamp) / (1000 * 60 * 60)
    : null;
  const uniqueMarketSlugs = new Set(
    marketSelections
      .map((event) => asString(event.payload?.slug))
      .filter((slug): slug is string => slug !== null),
  );
  const fallbackRecoveryDurationsMs = fallbackRecoveries
    .map((event) => asNumber(event.payload?.fallbackDurationMs))
    .filter((value): value is number => value !== null);
  const adjustedFallbackRecoveryDurationsMs = adjustedFallbackRecoveries
    .map((event) => asNumber(event.payload?.fallbackDurationMs))
    .filter((value): value is number => value !== null);
  const fallbackEventsPerHour = sessionDurationHours && sessionDurationHours > 0
    ? round(fallbacks.length / sessionDurationHours, 2)
    : null;
  const fallbackEventsPerMarket = uniqueMarketSlugs.size > 0
    ? round(fallbacks.length / uniqueMarketSlugs.size, 2)
    : null;
  const adjustedFallbackEventsPerHour = sessionDurationHours && sessionDurationHours > 0
    ? round(adjustedFallbacks.length / sessionDurationHours, 2)
    : null;
  const adjustedFallbackEventsPerMarket = uniqueMarketSlugs.size > 0
    ? round(adjustedFallbacks.length / uniqueMarketSlugs.size, 2)
    : null;
  const avgFallbackRecoveryMs = average(fallbackRecoveryDurationsMs);
  const maxFallbackRecoveryMs = maxValue(fallbackRecoveryDurationsMs);
  const adjustedAvgFallbackRecoveryMs = average(adjustedFallbackRecoveryDurationsMs);
  const adjustedMaxFallbackRecoveryMs = maxValue(adjustedFallbackRecoveryDurationsMs);

  console.log(`Bot: ${args.botId}`);
  console.log(`Session: ${sessionId}`);
  console.log(`Telemetry file: ${args.telemetryFile}`);
  console.log(`Paper buys: ${paperBuys.length}`);
  console.log(`Paper sells: ${paperSells.length}`);
  console.log(`Live buys: ${liveBuys.length}`);
  console.log(`Live sells: ${liveSells.length}`);
  console.log(`Fallback events: raw=${fallbacks.length} adjusted=${adjustedFallbacks.length}`);
  console.log(`Fallback recoveries: raw=${fallbackRecoveries.length} adjusted=${adjustedFallbackRecoveries.length}`);
  if (sessionDurationHours !== null || uniqueMarketSlugs.size > 0 || fallbacks.length > 0) {
    console.log("Fallback diagnostics:");
    if (sessionDurationHours !== null) {
      console.log(`  sessionHours: ${round(sessionDurationHours, 4)}`);
    }
    if (uniqueMarketSlugs.size > 0) {
      console.log(`  marketsCovered: ${uniqueMarketSlugs.size}`);
    }
    if (fallbackEventsPerHour !== null) {
      console.log(`  fallbackEventsPerHourRaw: ${fallbackEventsPerHour}`);
    }
    if (fallbackEventsPerMarket !== null) {
      console.log(`  fallbackEventsPerMarketRaw: ${fallbackEventsPerMarket}`);
    }
    if (adjustedFallbackEventsPerHour !== null) {
      console.log(`  fallbackEventsPerHourAdjusted: ${adjustedFallbackEventsPerHour}`);
    }
    if (adjustedFallbackEventsPerMarket !== null) {
      console.log(`  fallbackEventsPerMarketAdjusted: ${adjustedFallbackEventsPerMarket}`);
    }
    if (fallbackRecoveryDurationsMs.length > 0) {
      console.log(`  avgFallbackRecoveryMsRaw: ${avgFallbackRecoveryMs}`);
      console.log(`  maxFallbackRecoveryMsRaw: ${maxFallbackRecoveryMs}`);
    }
    if (adjustedFallbackRecoveryDurationsMs.length > 0) {
      console.log(`  avgFallbackRecoveryMsAdjusted: ${adjustedAvgFallbackRecoveryMs}`);
      console.log(`  maxFallbackRecoveryMsAdjusted: ${adjustedMaxFallbackRecoveryMs}`);
    }
  }

  console.log("Transition diagnostics:");
  console.log(`  transitionWindowMs: ${transitionDiagnostics.transitionWindowMs}`);
  console.log(`  transitionMarkers: ${transitionDiagnostics.markers.length}`);
  console.log(`  transitionRelatedFallbacks: ${transitionDiagnostics.transitionRelatedFallbacks}`);
  console.log(`  transitionRelatedRecoveries: ${transitionDiagnostics.transitionRelatedRecoveries}`);
  console.log(`  transitionRelatedRejects: ${transitionDiagnostics.transitionRelatedRejects}`);

  const fallbackReasonCounts = new Map<string, number>();
  for (const event of fallbacks) {
    const reason = asReason(event.payload?.reason);
    fallbackReasonCounts.set(reason, (fallbackReasonCounts.get(reason) ?? 0) + 1);
  }
  const adjustedFallbackReasonCounts = new Map<string, number>();
  for (const event of adjustedFallbacks) {
    const reason = asReason(event.payload?.reason);
    adjustedFallbackReasonCounts.set(reason, (adjustedFallbackReasonCounts.get(reason) ?? 0) + 1);
  }
  if (fallbackReasonCounts.size) {
    console.log("Fallback events by reason (raw):");
    for (const [reason, count] of [...fallbackReasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`);
    }
  }
  if (adjustedFallbackReasonCounts.size) {
    console.log("Fallback events by reason (adjusted):");
    for (const [reason, count] of [...adjustedFallbackReasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`);
    }
  }

  const recentWsFallbackRaw = rejections.filter((event) => asString(event.payload?.reason) === "recent_ws_fallback").length;
  const recentWsFallbackAdjusted = adjustedRejections.filter((event) => asString(event.payload?.reason) === "recent_ws_fallback").length;
  const marketTransitionGraceRaw = rejections.filter((event) => asString(event.payload?.reason) === "market_transition_grace").length;
  const marketTransitionGraceAdjusted = adjustedRejections.filter((event) => asString(event.payload?.reason) === "market_transition_grace").length;
  console.log("Transition-sensitive rejection counts:");
  console.log(`  recent_ws_fallback: raw=${recentWsFallbackRaw} adjusted=${recentWsFallbackAdjusted}`);
  console.log(`  market_transition_grace: raw=${marketTransitionGraceRaw} adjusted=${marketTransitionGraceAdjusted}`);

  const buyFieldCoverage = paperBuys.filter((event) => {
    const payload = event.payload ?? {};
    return hasNumber(payload.feedLatencyMs)
      && hasNumber(payload.momentumScore)
      && hasNumber(payload.mcConvergence);
  }).length;
  printCheck(
    "Every paper_trade.buy has feedLatencyMs, momentumScore, mcConvergence",
    paperBuys.length > 0 ? buyFieldCoverage === paperBuys.length : true,
    `${buyFieldCoverage}/${paperBuys.length} buys covered`,
    paperBuys.length > 0 ? (buyFieldCoverage === paperBuys.length ? "PASS" : "FAIL") : "SKIP",
  );

  const sellReasonCoverage = paperSells.filter((event) => {
    const reason = asString(event.payload?.reason);
    return reason !== null;
  }).length;
  printCheck(
    "Every paper_trade.sell has a reason",
    paperSells.length > 0 ? sellReasonCoverage === paperSells.length : true,
    `${sellReasonCoverage}/${paperSells.length} sells covered`,
    paperSells.length > 0 ? (sellReasonCoverage === paperSells.length ? "PASS" : "FAIL") : "SKIP",
  );

  const momentumMismatchCount = rejections.filter((event) => asString(event.payload?.reason) === "momentum_mismatch").length;
  printCheck(
    "momentum_mismatch rejection observed (optional)",
    momentumMismatchCount > 0,
    `${momentumMismatchCount} found`,
    momentumMismatchCount > 0 ? "PASS" : "SKIP",
  );

  const lowConvergenceCount = rejections.filter((event) => asString(event.payload?.reason) === "low_convergence").length;
  printCheck(
    "low_convergence rejection observed (optional)",
    lowConvergenceCount > 0,
    `${lowConvergenceCount} found`,
    lowConvergenceCount > 0 ? "PASS" : "SKIP",
  );

  printCheck(
    "Fallback events <= 20 (adjusted for transition noise)",
    adjustedFallbacks.length <= 20,
    `${adjustedFallbacks.length} adjusted fallback events (raw=${fallbacks.length})`,
  );

  printCheck(
    "Fallback events per market <= 2 (adjusted for transition noise)",
    adjustedFallbackEventsPerMarket !== null ? adjustedFallbackEventsPerMarket <= 2 : true,
    adjustedFallbackEventsPerMarket !== null
      ? `${adjustedFallbackEventsPerMarket} adjusted fallbacks/market (raw=${fallbackEventsPerMarket ?? "n/a"})`
      : "n/a",
    adjustedFallbackEventsPerMarket !== null ? (adjustedFallbackEventsPerMarket <= 2 ? "PASS" : "FAIL") : "SKIP",
  );

  printCheck(
    "Average fallback recovery <= 1000ms (adjusted for transition noise)",
    adjustedAvgFallbackRecoveryMs !== null ? adjustedAvgFallbackRecoveryMs <= 1000 : true,
    adjustedAvgFallbackRecoveryMs !== null
      ? `${adjustedAvgFallbackRecoveryMs} ms adjusted (raw=${avgFallbackRecoveryMs ?? "n/a"})`
      : "n/a",
    adjustedAvgFallbackRecoveryMs !== null ? (adjustedAvgFallbackRecoveryMs <= 1000 ? "PASS" : "FAIL") : "SKIP",
  );

  printCheck(
    "Max fallback recovery <= 5000ms (adjusted for transition noise)",
    adjustedMaxFallbackRecoveryMs !== null ? adjustedMaxFallbackRecoveryMs <= 5000 : true,
    adjustedMaxFallbackRecoveryMs !== null
      ? `${adjustedMaxFallbackRecoveryMs} ms adjusted (raw=${maxFallbackRecoveryMs ?? "n/a"})`
      : "n/a",
    adjustedMaxFallbackRecoveryMs !== null ? (adjustedMaxFallbackRecoveryMs <= 5000 ? "PASS" : "FAIL") : "SKIP",
  );

  printCheck(
    "signal.momentum events present",
    momentumEvents.length > 0,
    `${momentumEvents.length} found`,
  );

  printCheck(
    "signal.montecarlo events present",
    monteCarloEvents.length > 0,
    `${monteCarloEvents.length} found`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
