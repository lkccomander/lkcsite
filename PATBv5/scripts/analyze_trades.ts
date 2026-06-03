import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { resolveTelemetryFile } from "./telemetry_paths";

type TelemetryEvent = {
  type?: string;
  timestamp?: string;
  botId?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

type FallbackSummary = {
  reason: string;
  count: number;
};

type FallbackRecoverySummary = {
  reason: string;
  durationMs: number | null;
};

type StopLossEvalEvent = {
  spread: number | null;
  slippageEstimate: number | null;
};

type StopLossWaitResultEvent = {
  recovered: boolean | null;
  executed: boolean | null;
  spreadAfterWait: number | null;
};

type BuySnapshot = {
  botId: string | null;
  sessionId: string | null;
  side: string;
  tokenId: string;
  marketSlug: string | null;
  timestamp: string | null;
  entryPrice: number | null;
  usd: number | null;
  totalCostUsd: number | null;
  feeUsd: number | null;
  feedLatencyMs: number | null;
  feedRttMs: number | null;
  feedAgeMs: number | null;
  btcDelta30s: number | null;
  btcTrendDirection: string | null;
  feedHealthy: number | null;
  feedTicksLast10s: number | null;
  feedFallbackActive: string | null;
  momentumDirection: string | null;
  momentumScore: number | null;
  momentumConfidence: number | null;
  mcConvergence: number | null;
  mcSimulatedDirection: string | null;
  mcBullPaths: number | null;
  mcBearPaths: number | null;
  askPriceAtDecision: number | null;
  bidPriceAtDecision: number | null;
  slippageVsMid: number | null;
};

type CompletedTrade = {
  botId: string | null;
  sessionId: string | null;
  side: string;
  tokenId: string;
  marketSlug: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  holdSeconds: number | null;
  reason: string | null;
  feedLatencyMs: number | null;
  feedRttMs: number | null;
  feedAgeMs: number | null;
  btcDelta30s: number | null;
  btcTrendDirection: string | null;
  feedHealthy: number | null;
  feedTicksLast10s: number | null;
  momentumDirection: string | null;
  momentumScore: number | null;
  momentumConfidence: number | null;
  mcConvergence: number | null;
  mcSimulatedDirection: string | null;
  mcBullPaths: number | null;
  mcBearPaths: number | null;
  askPriceAtEntry: number | null;
  bidPriceAtEntry: number | null;
  askPriceAtExit: number | null;
  bidPriceAtExit: number | null;
  slippageVsMidEntry: number | null;
  slippageVsMidExit: number | null;
};

const DEFAULT_BOT_ID = "polymarket-bot-v5";

function parseArgs(argv: string[]): { botId: string | null; allBots: boolean; sessionId: string | null; telemetryFile: string } {
  const allBots = argv.includes("--all-bots");
  const botIndex = argv.findIndex((arg) => arg === "--bot-id");
  const sessionIndex = argv.findIndex((arg) => arg === "--session-id");
  const telemetryIndex = argv.findIndex((arg) => arg === "--telemetry-file");
  const sessionId = sessionIndex >= 0 && argv[sessionIndex + 1] ? argv[sessionIndex + 1] : null;
  const telemetryFileArg = telemetryIndex >= 0 && argv[telemetryIndex + 1] ? argv[telemetryIndex + 1] : null;
  const botId = botIndex >= 0 && argv[botIndex + 1] ? argv[botIndex + 1] : DEFAULT_BOT_ID;
  return {
    botId: allBots ? null : botId,
    allBots,
    sessionId,
    telemetryFile: resolveTelemetryFile(sessionId, telemetryFileArg),
  };
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asBooleanNumber(value: unknown): number | null {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed === 0 ? 0 : 1;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!nums.length) {
    return null;
  }
  return round(nums.reduce((sum, value) => sum + value, 0) / nums.length, 4);
}

function maxValue(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!nums.length) {
    return null;
  }
  let max = nums[0];
  for (let index = 1; index < nums.length; index += 1) {
    if (nums[index] > max) {
      max = nums[index];
    }
  }
  return round(max, 4);
}

function percent(numerator: number, denominator: number): number | null {
  if (!denominator) {
    return null;
  }
  return round((numerator / denominator) * 100, 2);
}

function keyForTrade(sessionId: string | null, tokenId: string, side: string): string {
  return `${sessionId ?? "no-session"}:${tokenId}:${side}`;
}

function reportMetric(label: string, value: string | number | null): string {
  return `${label}: ${value === null ? "n/a" : value}`;
}

async function loadTrades(botIdFilter: string | null, sessionIdFilter: string | null, telemetryFile: string): Promise<{
  completedTrades: CompletedTrade[];
  buyEvents: TelemetryEvent[];
  sellEvents: TelemetryEvent[];
  rejectionEvents: TelemetryEvent[];
  momentumEvents: TelemetryEvent[];
  monteCarloEvents: TelemetryEvent[];
  fallbackEvents: TelemetryEvent[];
  fallbackRecoveries: TelemetryEvent[];
  stopLossEvalEvents: TelemetryEvent[];
  stopLossWaitResultEvents: TelemetryEvent[];
}> {
  if (!fs.existsSync(telemetryFile)) {
    throw new Error(`Telemetry file not found: ${telemetryFile}`);
  }

  const buySnapshots = new Map<string, BuySnapshot[]>();
  const completedTrades: CompletedTrade[] = [];
  const buyEvents: TelemetryEvent[] = [];
  const sellEvents: TelemetryEvent[] = [];
  const rejectionEvents: TelemetryEvent[] = [];
  const momentumEvents: TelemetryEvent[] = [];
  const monteCarloEvents: TelemetryEvent[] = [];
  const fallbackEvents: TelemetryEvent[] = [];
  const fallbackRecoveries: TelemetryEvent[] = [];
  const stopLossEvalEvents: TelemetryEvent[] = [];
  const stopLossWaitResultEvents: TelemetryEvent[] = [];

  const stream = fs.createReadStream(telemetryFile, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let event: TelemetryEvent;
    try {
      event = JSON.parse(line) as TelemetryEvent;
    } catch {
      continue;
    }

    if (botIdFilter && event.botId !== botIdFilter) {
      continue;
    }

    if (!sessionIdFilter && typeof event.sessionId === "string" && event.sessionId.startsWith("synthetic-")) {
      continue;
    }

    if (sessionIdFilter && event.sessionId !== sessionIdFilter) {
      continue;
    }

    const payload = event.payload ?? {};
    if (event.type === "trade.signal_rejected") {
      rejectionEvents.push(event);
      continue;
    }

    if (event.type === "signal.momentum") {
      momentumEvents.push(event);
      continue;
    }

    if (event.type === "signal.montecarlo") {
      monteCarloEvents.push(event);
      continue;
    }

    if (event.type === "feed.fallback") {
      fallbackEvents.push(event);
      continue;
    }

    if (event.type === "feed.fallback_recovered") {
      fallbackRecoveries.push(event);
      continue;
    }

    if (event.type === "exit.stop_loss_eval") {
      stopLossEvalEvents.push(event);
      continue;
    }

    if (event.type === "exit.sl_spread_wait_result") {
      stopLossWaitResultEvents.push(event);
      continue;
    }

    if (event.type === "paper_trade.buy" || event.type === "live_trade.buy") {
      buyEvents.push(event);
      const side = asString(payload.side);
      const tokenId = asString(payload.tokenId);
      if (!side || !tokenId) {
        continue;
      }
      const key = keyForTrade(event.sessionId ?? null, tokenId, side);
      const snapshot: BuySnapshot = {
        botId: event.botId ?? null,
        sessionId: event.sessionId ?? null,
        side,
        tokenId,
        marketSlug: asString(payload.marketSlug),
        timestamp: asString(payload.executionTimestamp) ?? asString(payload.orderFilledAt) ?? event.timestamp ?? null,
        entryPrice: asNumber(payload.entryPrice) ?? asNumber(payload.price),
        usd: asNumber(payload.usd) ?? asNumber(payload.requestedUsd),
        totalCostUsd: asNumber(payload.totalCostUsd),
        feeUsd: asNumber(payload.feeUsd),
        feedLatencyMs: asNumber(payload.feedLatencyMs),
        feedRttMs: asNumber(payload.feedRttMs),
        feedAgeMs: asNumber(payload.feedAgeMs),
        btcDelta30s: asNumber(payload.btcDelta30s),
        btcTrendDirection: asString(payload.btcTrendDirection),
        feedHealthy: asBooleanNumber(payload.feedHealthy),
        feedTicksLast10s: asNumber(payload.feedTicksLast10s),
        feedFallbackActive: asString(payload.feedFallbackActive),
        momentumDirection: asString(payload.momentumDirection),
        momentumScore: asNumber(payload.momentumScore),
        momentumConfidence: asNumber(payload.momentumConfidence),
        mcConvergence: asNumber(payload.mcConvergence),
        mcSimulatedDirection: asString(payload.mcSimulatedDirection),
        mcBullPaths: asNumber(payload.mcBullPaths),
        mcBearPaths: asNumber(payload.mcBearPaths),
        askPriceAtDecision: asNumber(payload.askPriceAtDecision),
        bidPriceAtDecision: asNumber(payload.bidPriceAtDecision),
        slippageVsMid: asNumber(payload.slippageVsMid),
      };
      const queue = buySnapshots.get(key) ?? [];
      queue.push(snapshot);
      buySnapshots.set(key, queue);
      continue;
    }

    if (event.type === "paper_trade.sell" || event.type === "live_trade.sell") {
      sellEvents.push(event);
      const side = asString(payload.side);
      const tokenId = asString(payload.tokenId);
      if (!side || !tokenId) {
        continue;
      }
      const key = keyForTrade(event.sessionId ?? null, tokenId, side);
      const queue = buySnapshots.get(key) ?? [];
      const buy = queue.shift() ?? null;
      if (queue.length) {
        buySnapshots.set(key, queue);
      } else {
        buySnapshots.delete(key);
      }

      const entryPrice = asNumber(payload.entryPrice) ?? buy?.entryPrice ?? null;
      const exitPrice = asNumber(payload.exitPrice) ?? asNumber(payload.price);
      const shares = asNumber(payload.shares);
      const feeUsd = asNumber(payload.feeUsd) ?? 0;
      const rebateUsd = asNumber(payload.rebateUsd) ?? 0;
      const grossProceeds = asNumber(payload.grossProceeds) ?? asNumber(payload.proceeds) ?? (
        shares !== null && exitPrice !== null ? round(shares * exitPrice, 4) : null
      );
      const netProceeds = asNumber(payload.netProceeds) ?? (
        grossProceeds !== null ? round(grossProceeds - feeUsd + rebateUsd, 4) : null
      );
      const costBasisUsd = asNumber(payload.costBasisUsd) ?? buy?.totalCostUsd ?? buy?.usd ?? (
        shares !== null && entryPrice !== null ? round(shares * entryPrice, 4) : null
      );
      const pnlUsd = asNumber(payload.realizedTradePnl) ?? asNumber(payload.pnlUsd) ?? (
        netProceeds !== null && costBasisUsd !== null ? round(netProceeds - costBasisUsd, 4) : null
      );
      const pnlPct = asNumber(payload.pnlPct) ?? (
        pnlUsd !== null && costBasisUsd !== null && costBasisUsd > 0 ? round((pnlUsd / costBasisUsd) * 100, 4) : null
      );
      const holdSeconds = asNumber(payload.holdSeconds) ?? (
        buy?.timestamp && (asString(payload.orderFilledAt) ?? event.timestamp)
          ? round(
              (Date.parse(asString(payload.orderFilledAt) ?? event.timestamp ?? "") - Date.parse(buy.timestamp)) / 1000,
              4,
            )
          : null
      );

      completedTrades.push({
        botId: event.botId ?? null,
        sessionId: event.sessionId ?? null,
        side,
        tokenId,
        marketSlug: asString(payload.marketSlug) ?? buy?.marketSlug ?? null,
        entryPrice,
        exitPrice,
        pnlUsd,
        pnlPct,
        holdSeconds,
        reason: asString(payload.reason),
        feedLatencyMs: asNumber(payload.feedLatencyMs) ?? buy?.feedLatencyMs ?? null,
        feedRttMs: asNumber(payload.feedRttMs) ?? buy?.feedRttMs ?? null,
        feedAgeMs: asNumber(payload.feedAgeMs) ?? buy?.feedAgeMs ?? null,
        btcDelta30s: asNumber(payload.btcDelta30s) ?? buy?.btcDelta30s ?? null,
        btcTrendDirection: asString(payload.btcTrendDirection) ?? buy?.btcTrendDirection ?? null,
        feedHealthy: asBooleanNumber(payload.feedHealthy) ?? buy?.feedHealthy ?? null,
        feedTicksLast10s: asNumber(payload.feedTicksLast10s) ?? buy?.feedTicksLast10s ?? null,
        momentumDirection: asString(payload.momentumDirection) ?? buy?.momentumDirection ?? null,
        momentumScore: asNumber(payload.momentumScore) ?? buy?.momentumScore ?? null,
        momentumConfidence: asNumber(payload.momentumConfidence) ?? buy?.momentumConfidence ?? null,
        mcConvergence: asNumber(payload.mcConvergence) ?? buy?.mcConvergence ?? null,
        mcSimulatedDirection: asString(payload.mcSimulatedDirection) ?? buy?.mcSimulatedDirection ?? null,
        mcBullPaths: asNumber(payload.mcBullPaths) ?? buy?.mcBullPaths ?? null,
        mcBearPaths: asNumber(payload.mcBearPaths) ?? buy?.mcBearPaths ?? null,
        askPriceAtEntry: buy?.askPriceAtDecision ?? null,
        bidPriceAtEntry: buy?.bidPriceAtDecision ?? null,
        askPriceAtExit: asNumber(payload.askPriceAtDecision),
        bidPriceAtExit: asNumber(payload.bidPriceAtDecision),
        slippageVsMidEntry: buy?.slippageVsMid ?? null,
        slippageVsMidExit: asNumber(payload.slippageVsMid),
      });
    }
  }

  return {
    completedTrades,
    buyEvents,
    sellEvents,
    rejectionEvents,
    momentumEvents,
    monteCarloEvents,
    fallbackEvents,
    fallbackRecoveries,
    stopLossEvalEvents,
    stopLossWaitResultEvents,
  };
}

function printBreakdown(
  title: string,
  rows: Array<{ label: string; trades: CompletedTrade[] }>,
): void {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log("  n/a");
    return;
  }
  for (const row of rows) {
    const wins = row.trades.filter((trade) => (trade.pnlUsd ?? 0) > 0).length;
    const winRate = percent(wins, row.trades.length);
    const avgPnl = average(row.trades.map((trade) => trade.pnlUsd));
    console.log(`  ${row.label}: trades=${row.trades.length} winRate=${winRate ?? "n/a"}% avgPnl=${avgPnl ?? "n/a"}`);
  }
}

function printPnlBreakdown(
  title: string,
  rows: Array<{ label: string; trades: CompletedTrade[] }>,
): void {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log("  n/a");
    return;
  }
  for (const row of rows) {
    const avgPnl = average(row.trades.map((trade) => trade.pnlUsd));
    const avgPnlPct = average(row.trades.map((trade) => trade.pnlPct));
    console.log(`  ${row.label}: trades=${row.trades.length} avgPnl=${avgPnl ?? "n/a"} avgPnlPct=${avgPnlPct ?? "n/a"}`);
  }
}

function printFallbackReasonBreakdown(title: string, rows: FallbackSummary[]): void {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log("  n/a");
    return;
  }
  for (const row of rows) {
    console.log(`  ${row.reason}: count=${row.count}`);
  }
}

function printFallbackRecoveryBreakdown(title: string, rows: FallbackRecoverySummary[]): void {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log("  n/a");
    return;
  }
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.reason) ?? [];
    if (row.durationMs !== null) {
      bucket.push(row.durationMs);
    }
    grouped.set(row.reason, bucket);
  }
  for (const [reason, durations] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${reason}: recoveries=${durations.length} avgDurationMs=${average(durations) ?? "n/a"} maxDurationMs=${maxValue(durations) ?? "n/a"}`
    );
  }
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function countRejectionsByReason(events: TelemetryEvent[], reason: string): number {
  return events.filter((event) => asString(event.payload?.reason) === reason).length;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const {
    completedTrades,
    buyEvents,
    sellEvents,
    rejectionEvents,
    momentumEvents,
    monteCarloEvents,
    fallbackEvents,
    fallbackRecoveries,
    stopLossEvalEvents,
    stopLossWaitResultEvents,
  } = await loadTrades(args.botId, args.sessionId, args.telemetryFile);
  const downBlockedNeutralMomentumCount = countRejectionsByReason(rejectionEvents, "down_blocked_neutral_momentum");
  const downTradesWithNeutralMomentum = completedTrades.filter((trade) =>
    trade.side === "DOWN" && trade.momentumDirection === "NEUTRAL"
  );

  console.log(reportMetric("Bot filter", args.botId ?? "all"));
  console.log(reportMetric("Session filter", args.sessionId));
  console.log(reportMetric("Telemetry file", args.telemetryFile));
  console.log(reportMetric("Total trades", completedTrades.length));
  console.log(reportMetric("BUY events", buyEvents.length));
  console.log(reportMetric("SELL events", sellEvents.length));
  console.log(reportMetric("Signal rejection events", rejectionEvents.length));
  console.log(reportMetric("Momentum events", momentumEvents.length));
  console.log(reportMetric("Monte Carlo events", monteCarloEvents.length));
  console.log(reportMetric("Fallback events", fallbackEvents.length));
  console.log(reportMetric("Fallback recoveries", fallbackRecoveries.length));
  console.log(reportMetric("Stop-loss eval events", stopLossEvalEvents.length));
  console.log(reportMetric("Stop-loss wait results", stopLossWaitResultEvents.length));
  console.log(reportMetric("down_blocked_neutral_momentum count", downBlockedNeutralMomentumCount));
  console.log(reportMetric("DOWN trades executed with momentum NEUTRAL count", downTradesWithNeutralMomentum.length));

  if (!completedTrades.length) {
    console.log(`\nNo trades found for ${args.sessionId ? `session ${args.sessionId}` : "the selected filter"}.`);
    const rejectionCounts = new Map<string, number>();
    const entryPriceWindowStatusCounts = new Map<string, number>();
    const entryPriceWindowStatusBySideCounts = new Map<string, number>();
    for (const event of rejectionEvents) {
      const reason = asString(event.payload?.reason) ?? "unknown";
      rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
      if (reason === "entry_price_window") {
        const status = asString(event.payload?.entryPriceWindowStatus) ?? "unknown";
        const side = asString(event.payload?.preferredSide) ?? asString(event.payload?.selectedSide) ?? "unknown";
        entryPriceWindowStatusCounts.set(status, (entryPriceWindowStatusCounts.get(status) ?? 0) + 1);
        const sideKey = `${status} / ${side}`;
        entryPriceWindowStatusBySideCounts.set(sideKey, (entryPriceWindowStatusBySideCounts.get(sideKey) ?? 0) + 1);
      }
    }
    if (rejectionCounts.size) {
      console.log("\nSignal Rejection Breakdown");
      for (const [reason, count] of [...rejectionCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${reason}: count=${count}`);
      }
      if (entryPriceWindowStatusCounts.size) {
        console.log("\nEntry Price Window Breakdown");
        for (const [status, count] of [...entryPriceWindowStatusCounts.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`  ${status}: count=${count}`);
        }
        if (entryPriceWindowStatusBySideCounts.size) {
          console.log("\nEntry Price Window Breakdown By Side");
          for (const [label, count] of [...entryPriceWindowStatusBySideCounts.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${label}: count=${count}`);
          }
        }
      }
    }
    return;
  }

  const winners = completedTrades.filter((trade) => (trade.pnlUsd ?? 0) > 0);
  const losers = completedTrades.filter((trade) => (trade.pnlUsd ?? 0) < 0);
  const flats = completedTrades.filter((trade) => (trade.pnlUsd ?? 0) === 0);

  const reasonGroups = new Map<string, CompletedTrade[]>();
  const sideGroups = new Map<string, CompletedTrade[]>();
  const btcTrendGroups = new Map<string, CompletedTrade[]>();
  const momentumGroups = new Map<string, CompletedTrade[]>();
  const mcDirectionGroups = new Map<string, CompletedTrade[]>();
  const fallbackReasonGroups = new Map<string, number>();

  for (const trade of completedTrades) {
    const reason = trade.reason ?? "unknown";
    const side = trade.side;
    const trend = trade.btcTrendDirection ?? "UNKNOWN";
    const momentum = trade.momentumDirection ?? "UNKNOWN";
    const mcDirection = trade.mcSimulatedDirection ?? "UNKNOWN";
    reasonGroups.set(reason, [...(reasonGroups.get(reason) ?? []), trade]);
    sideGroups.set(side, [...(sideGroups.get(side) ?? []), trade]);
    btcTrendGroups.set(trend, [...(btcTrendGroups.get(trend) ?? []), trade]);
    momentumGroups.set(momentum, [...(momentumGroups.get(momentum) ?? []), trade]);
    mcDirectionGroups.set(mcDirection, [...(mcDirectionGroups.get(mcDirection) ?? []), trade]);
  }

  for (const event of fallbackEvents) {
    const reason = asString(event.payload?.reason) ?? "unknown";
    fallbackReasonGroups.set(reason, (fallbackReasonGroups.get(reason) ?? 0) + 1);
  }

  const fallbackRecoveryRows: FallbackRecoverySummary[] = fallbackRecoveries.map((event) => ({
    reason: asString(event.payload?.reason) ?? "unknown",
    durationMs: asNumber(event.payload?.fallbackDurationMs),
  }));
  const stopLossEvalRows: StopLossEvalEvent[] = stopLossEvalEvents.map((event) => ({
    spread: asNumber(event.payload?.spread),
    slippageEstimate: asNumber(event.payload?.slippageEstimate),
  }));
  const stopLossWaitRows: StopLossWaitResultEvent[] = stopLossWaitResultEvents.map((event) => ({
    recovered: asBoolean(event.payload?.recovered),
    executed: asBoolean(event.payload?.executed),
    spreadAfterWait: asNumber(event.payload?.spreadAfterWait),
  }));
  const stopLossTrades = reasonGroups.get("stop_loss") ?? [];
  const stopLossTradeExitSpreads = stopLossTrades.map((trade) => {
    if (trade.askPriceAtExit === null || trade.bidPriceAtExit === null) {
      return null;
    }
    return round(trade.askPriceAtExit - trade.bidPriceAtExit, 4);
  });

  console.log(reportMetric("Win rate", `${percent(winners.length, completedTrades.length) ?? "n/a"}%`));
  console.log(reportMetric("Winning trades", winners.length));
  console.log(reportMetric("Losing trades", losers.length));
  console.log(reportMetric("Flat trades", flats.length));
  console.log(reportMetric("Net PnL after fees", average([completedTrades.reduce((sum, trade) => sum + (trade.pnlUsd ?? 0), 0)]) ?? "n/a"));
  console.log(reportMetric("Avg hold time (s)", average(completedTrades.map((trade) => trade.holdSeconds))));
  console.log(reportMetric("Avg entry latency winners (ms)", average(winners.map((trade) => trade.feedLatencyMs))));
  console.log(reportMetric("Avg entry latency losers (ms)", average(losers.map((trade) => trade.feedLatencyMs))));
  console.log(reportMetric("Max latency on losers (ms)", maxValue(losers.map((trade) => trade.feedLatencyMs))));
  console.log(reportMetric("Avg spread at entry", average(completedTrades.map((trade) => {
    if (trade.askPriceAtEntry === null || trade.bidPriceAtEntry === null) {
      return null;
    }
    return round(trade.askPriceAtEntry - trade.bidPriceAtEntry, 4);
  }))));
  console.log(reportMetric("Avg spread at exit", average(completedTrades.map((trade) => {
    if (trade.askPriceAtExit === null || trade.bidPriceAtExit === null) {
      return null;
    }
    return round(trade.askPriceAtExit - trade.bidPriceAtExit, 4);
  }))));
  console.log(reportMetric("Avg slippage at entry", average(completedTrades.map((trade) => trade.slippageVsMidEntry))));
  console.log(reportMetric("Avg slippage at exit", average(completedTrades.map((trade) => trade.slippageVsMidExit))));
  console.log(reportMetric("Avg momentum score", average(completedTrades.map((trade) => trade.momentumScore))));
  console.log(reportMetric("Avg momentum confidence", average(completedTrades.map((trade) => trade.momentumConfidence))));
  console.log(reportMetric("Avg MC convergence", average(completedTrades.map((trade) => trade.mcConvergence))));
  console.log(reportMetric("Avg feed ticks last 10s", average(completedTrades.map((trade) => trade.feedTicksLast10s))));
  console.log(reportMetric("Feed healthy entries", completedTrades.filter((trade) => trade.feedHealthy === 1).length));
  console.log(reportMetric("Forced exits", reasonGroups.get("forced_exit")?.length ?? 0));
  console.log(reportMetric("Stop losses", reasonGroups.get("stop_loss")?.length ?? 0));
  console.log(reportMetric("Take profits", reasonGroups.get("take_profit")?.length ?? 0));
  console.log(reportMetric("Stop-loss avg spread at eval", average(stopLossEvalRows.map((event) => event.spread))));
  console.log(reportMetric("Stop-loss avg spread at exit", average(stopLossTradeExitSpreads)));
  console.log(reportMetric("Stop-loss avg slippage estimate", average(stopLossEvalRows.map((event) => event.slippageEstimate))));
  console.log(reportMetric("Stop-loss wait recovery rate", `${percent(stopLossWaitRows.filter((event) => event.recovered === true).length, stopLossWaitRows.length) ?? "n/a"}%`));
  console.log(reportMetric("Stop-loss avg spread after wait", average(stopLossWaitRows.map((event) => event.spreadAfterWait))));

  printBreakdown(
    "Win Rate By Exit Reason",
    [...reasonGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([label, trades]) => ({ label, trades })),
  );

  printFallbackReasonBreakdown(
    "Fallback Events By Reason",
    [...fallbackReasonGroups.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
  );

  printFallbackRecoveryBreakdown("Fallback Recovery Durations", fallbackRecoveryRows);

  printBreakdown(
    "Win Rate By Side",
    [...sideGroups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, trades]) => ({ label, trades })),
  );

  printBreakdown(
    "Win Rate By BTC Trend Direction",
    [...btcTrendGroups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, trades]) => ({ label, trades })),
  );

  printBreakdown(
    "Win Rate By Momentum Direction",
    [...momentumGroups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, trades]) => ({ label, trades })),
  );

  printBreakdown(
    "Win Rate By Monte Carlo Direction",
    [...mcDirectionGroups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, trades]) => ({ label, trades })),
  );

  const trendComparisons = [
    {
      label: "UP trades when btcDelta30s > 0",
      trades: completedTrades.filter((trade) => trade.side === "UP" && (trade.btcDelta30s ?? 0) > 0),
    },
    {
      label: "UP trades when btcDelta30s < 0",
      trades: completedTrades.filter((trade) => trade.side === "UP" && (trade.btcDelta30s ?? 0) < 0),
    },
    {
      label: "DOWN trades when btcDelta30s < 0",
      trades: completedTrades.filter((trade) => trade.side === "DOWN" && (trade.btcDelta30s ?? 0) < 0),
    },
    {
      label: "DOWN trades when btcDelta30s > 0",
      trades: completedTrades.filter((trade) => trade.side === "DOWN" && (trade.btcDelta30s ?? 0) > 0),
    },
  ];
  printBreakdown("BTC Delta 30s Correlation", trendComparisons);

  const convergenceRows = [
    {
      label: "MC convergence >= 0.62",
      trades: completedTrades.filter((trade) => (trade.mcConvergence ?? 0) >= 0.62),
    },
    {
      label: "MC convergence < 0.62",
      trades: completedTrades.filter((trade) => trade.mcConvergence !== null && trade.mcConvergence < 0.62),
    },
  ];
  printBreakdown("Win Rate By Monte Carlo Convergence", convergenceRows);

  const sideTrendRows = [
    {
      label: "UP trades when BTC trending UP",
      trades: completedTrades.filter((trade) => trade.side === "UP" && trade.btcTrendDirection === "UP"),
    },
    {
      label: "UP trades when BTC trending DOWN",
      trades: completedTrades.filter((trade) => trade.side === "UP" && trade.btcTrendDirection === "DOWN"),
    },
    {
      label: "DOWN trades when BTC trending DOWN",
      trades: completedTrades.filter((trade) => trade.side === "DOWN" && trade.btcTrendDirection === "DOWN"),
    },
    {
      label: "DOWN trades when BTC trending UP",
      trades: completedTrades.filter((trade) => trade.side === "DOWN" && trade.btcTrendDirection === "UP"),
    },
  ];
  printBreakdown("Win Rate By Side And BTC Trend", sideTrendRows);
  printPnlBreakdown("Average PnL By Side And BTC Trend", sideTrendRows);

  const momentumAlignedRows = [
    {
      label: "Momentum aligned with side",
      trades: completedTrades.filter((trade) => trade.momentumDirection !== null && trade.momentumDirection === trade.side),
    },
    {
      label: "Momentum neutral",
      trades: completedTrades.filter((trade) => trade.momentumDirection === "NEUTRAL"),
    },
  ];
  printBreakdown("Win Rate By Momentum Alignment", momentumAlignedRows);

  if (downTradesWithNeutralMomentum.length) {
    console.log("\nDOWN Trades Executed With Momentum NEUTRAL");
    for (const trade of downTradesWithNeutralMomentum) {
      console.log(
        `  session=${trade.sessionId ?? "n/a"} token=${trade.tokenId} entry=${trade.entryPrice ?? "n/a"} pnl=${trade.pnlUsd ?? "n/a"} mc=${trade.mcConvergence ?? "n/a"}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
