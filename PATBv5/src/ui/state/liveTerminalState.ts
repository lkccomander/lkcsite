import { open } from "fs/promises";
import { dirname, resolve } from "node:path";
import { getTelemetryBotId, getTelemetryDbPath, loadPersistedPaperBalance } from "../../telemetry";
import { TerminalState, TapeItem, TradeRow, PnLPoint, Candle, VolumeBar } from "../types";
import { createActiveSessionReader } from "./activeSessionReader";
import { buildMockTerminalState } from "./mockTerminalState";
import { buildActiveSessionTelemetry, buildRealizedTradeRecords } from "./sessionTelemetry";
import type { TelemetryEvent } from "./telemetryEvent";

type JsonRecord = Record<string, unknown>;

const TELEMETRY_TAIL_BYTES = 2 * 1024 * 1024;
const TELEMETRY_MAX_EVENTS = 4000;
const readActiveSessionEvents = createActiveSessionReader(
  resolve(dirname(getTelemetryDbPath()), "sessions"),
  getTelemetryBotId(),
);

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateMiddle(value: string, left = 10, right = 8): string {
  if (value.length <= left + right + 3) {
    return value;
  }
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function buildTapeItem(event: TelemetryEvent): TapeItem | null {
  const payload = event.payload;
  switch (event.type) {
    case "paper_trade.buy":
    case "live_trade.buy":
    case "trade.entry_filled": {
      const side = ((asString(payload.side) || "UP").toUpperCase() === "DOWN" ? "DOWN" : "UP");
      const entryPrice = asNumber(payload.entryPrice) ?? asNumber(payload.price) ?? 0;
      return {
        id: `${event.type}-${event.timestamp}`,
        text: `ENTRY · BTC ${side} · ${entryPrice.toFixed(2)}`,
        tone: "info",
      };
    }
    case "paper_trade.sell":
    case "live_trade.sell":
    case "trade.exit_filled": {
      const side = ((asString(payload.side) || "UP").toUpperCase() === "DOWN" ? "DOWN" : "UP");
      const pnl = asNumber(payload.pnlUsd) ?? asNumber(payload.realizedTradePnl) ?? null;
      return {
        id: `${event.type}-${event.timestamp}`,
        text: `EXIT · BTC ${side} · ${pnl == null ? "flat" : `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`}`,
        tone: pnl == null ? "warning" : pnl >= 0 ? "positive" : "negative",
      };
    }
    case "paper_balance.checkpoint": {
      const balance = asNumber(payload.balance);
      if (balance == null) {
        return null;
      }
      return {
        id: `${event.type}-${event.timestamp}`,
        text: `BALANCE CHECKPOINT · $${balance.toFixed(2)} · ${asString(payload.reason) || "checkpoint"}`,
        tone: "info",
      };
    }
    case "trade.signal_rejected": {
      const reason = asString(payload.reason) || "rejected";
      const source = asString(payload.decisionSource) || "unknown";
      return {
        id: `${event.type}-${event.timestamp}`,
        text: `REJECTED · ${reason.replace(/_/g, " ")} · ${source}`,
        tone: "negative",
      };
    }
    case "trade.shadow_pnl": {
      const pnl = asNumber(payload.hypotheticalPnlUsd) || 0;
      const side = asString(payload.preferredSide) || "UNKNOWN";
      return {
        id: `${event.type}-${event.timestamp}`,
        text: `SHADOW ${pnl >= 0 ? "WIN" : "LOSS"} · BTC ${side.toUpperCase()} · ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`,
        tone: pnl >= 0 ? "positive" : "negative",
      };
    }
    case "market.external_reference": {
      const price = asNumber(payload.priceUsd);
      if (price == null) {
        return null;
      }
      return {
        id: `${event.type}-${event.timestamp}`,
        text: `BTC PRINT · $${price.toFixed(2)} · ${asString(payload.source) || "reference"}`,
        tone: "info",
      };
    }
    case "feed.summary": {
      const avgLatency = asNumber(payload.averageLatencyMs);
      const ticks = asNumber(payload.tickCount);
      return {
        id: `${event.type}-${event.timestamp}`,
        text: `FEED SUMMARY · ${ticks ?? 0} ticks · avg ${avgLatency?.toFixed(0) ?? "0"}ms`,
        tone: "warning",
      };
    }
    default:
      return null;
  }
}

function inferStatusFromShadowPnl(value: number): TradeRow["status"] {
  return value >= 0 ? "WIN" : "LOSS";
}

function ensureRecentTrades(events: TelemetryEvent[]): TradeRow[] {
  const rows = events
    .filter((event) => event.type === "trade.shadow_pnl")
    .slice(-8)
    .reverse()
    .map((event, index) => {
      const payload = event.payload;
      const pnl = asNumber(payload.hypotheticalPnlUsd) || 0;
      const side = ((asString(payload.preferredSide) || "DOWN").toUpperCase() === "UP" ? "UP" : "DOWN") as TradeRow["side"];
      const price = asNumber(payload.preferredEntryPrice) || 0.5;
      const confidence = Math.max(50, Math.min(99, 100 - Math.abs(pnl) * 10 - index * 1.5));
      return {
        id: `shadow-${event.timestamp}-${index}`,
        offset: `+${20 - index * 2}`,
        side,
        price: round(price * 100000),
        confidence: round(confidence, 1),
        pnl: round(pnl, 2),
        status: inferStatusFromShadowPnl(pnl),
      };
    });

  return rows;
}

function buildPnlHistory(events: TelemetryEvent[], startingBalance: number): PnLPoint[] {
  const shadowEvents = events.filter((event) => event.type === "trade.shadow_pnl").slice(-28);
  let running = startingBalance;
  const points: PnLPoint[] = [];

  for (const event of shadowEvents) {
    const pnl = asNumber(event.payload.hypotheticalPnlUsd) || 0;
    running = round(running + pnl, 2);
    points.push({
      time: event.timestamp,
      value: running,
    });
  }

  return points;
}

function buildCheckpointHistory(events: TelemetryEvent[]): PnLPoint[] {
  return events
    .filter((event) => event.type === "paper_balance.checkpoint")
    .slice(-28)
    .map((event) => {
      const balance = asNumber(event.payload.balance);
      if (balance == null) {
        return null;
      }
      return {
        time: event.timestamp,
        value: round(balance, 2),
      };
    })
    .filter((point): point is PnLPoint => Boolean(point));
}

interface PricePoint {
  timestampMs: number;
  price: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildTelemetryCandles(events: TelemetryEvent[], fallbackCandles: Candle[]): Candle[] {
  const targetCount = Math.max(fallbackCandles.length, 1);
  const bucketMs = 60_000;
  const referencePoints = events
    .filter((event) => event.type === "market.external_reference")
    .map((event) => {
      const price = asNumber(event.payload.priceUsd);
      const timestamp = asString(event.payload.fetchedAt) || event.timestamp;
      const timestampMs = new Date(timestamp).getTime();
      if (price == null || Number.isNaN(timestampMs)) {
        return null;
      }
      return {
        timestampMs,
        price,
      };
    })
    .filter((point): point is PricePoint => Boolean(point))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  if (referencePoints.length < 2) {
    return fallbackCandles;
  }

  const firstPoint = referencePoints[0];
  const lastPoint = referencePoints[referencePoints.length - 1];
  const endBucketStartMs = Math.floor(lastPoint.timestampMs / bucketMs) * bucketMs;
  const startTimeMs = endBucketStartMs - bucketMs * (targetCount - 1);

  const buckets = Array.from({ length: targetCount }, (_, index) => {
    const bucketStartMs = startTimeMs + index * bucketMs;
    const bucketEndMs = bucketStartMs + bucketMs;
    const points = referencePoints.filter((point) => (
      point.timestampMs >= bucketStartMs
      && (index === targetCount - 1 ? point.timestampMs <= bucketEndMs : point.timestampMs < bucketEndMs)
    ));

    return {
      bucketStartMs,
      points,
    };
  });

  let previousClose = referencePoints[0].price;

  return buckets.map((bucket, index) => {
    const points = bucket.points;
    if (points.length === 0) {
      const time = new Date(bucket.bucketStartMs).toISOString();
      return {
        ...fallbackCandles[index],
        time,
        open: round(previousClose),
        high: round(previousClose),
        low: round(previousClose),
        close: round(previousClose),
      };
    }

    const open = points[0].price;
    const close = points[points.length - 1].price;
    const high = Math.max(...points.map((point) => point.price));
    const low = Math.min(...points.map((point) => point.price));
    previousClose = close;

    return {
      ...fallbackCandles[index],
      time: new Date(bucket.bucketStartMs).toISOString(),
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
    };
  });
}

function buildTelemetryVolumeBars(events: TelemetryEvent[], candles: Candle[]): VolumeBar[] {
  const volumeByMinute = new Map<number, number>();

  for (const event of events) {
    if (event.type !== "signal.momentum") {
      continue;
    }

    const rawFieldsAvailable = event.payload.rawFieldsAvailable;
    if (rawFieldsAvailable === false) {
      continue;
    }

    const volume = asNumber(event.payload.rawLatestVolume);
    const fetchedAt = asNumber(event.payload.fetchedAt);
    const timestampMs = fetchedAt ?? new Date(event.timestamp).getTime();
    if (volume == null || Number.isNaN(timestampMs)) {
      continue;
    }

    const minuteStartMs = Math.floor(timestampMs / 60_000) * 60_000;
    const current = volumeByMinute.get(minuteStartMs) ?? 0;
    volumeByMinute.set(minuteStartMs, Math.max(current, volume));
  }

  return candles.map((candle) => {
    const minuteStartMs = Math.floor(new Date(candle.time).getTime() / 60_000) * 60_000;
    const value = volumeByMinute.get(minuteStartMs) ?? 0;
    return {
      time: candle.time,
      value: round(value, 4),
      color: candle.close >= candle.open ? "#00c08788" : "#ff5b4f88",
    };
  });
}

async function readRecentTelemetryEvents(botId: string): Promise<TelemetryEvent[]> {
  let file;
  try {
    file = await open(getTelemetryDbPath(), "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    const stats = await file.stat();
    const start = Math.max(0, stats.size - TELEMETRY_TAIL_BYTES);
    const length = Math.max(0, stats.size - start);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, start);

    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    if (start > 0) {
      lines.shift();
    }

    return lines
      .filter(Boolean)
      .slice(-TELEMETRY_MAX_EVENTS)
      .map((line) => {
        try {
          return JSON.parse(line) as TelemetryEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is TelemetryEvent => Boolean(event) && event.botId === botId);
  } finally {
    await file.close();
  }
}

export async function buildLiveTerminalState(): Promise<TerminalState> {
  const base = await buildMockTerminalState("live");
  const botId = getTelemetryBotId();
  const recentEvents = await readRecentTelemetryEvents(botId);
  const completeSessionEvents = await readActiveSessionEvents();
  const events = recentEvents.length ? recentEvents : completeSessionEvents;

  if (events.length === 0) {
    return {
      ...base,
      meta: {
        ...base.meta,
        sourceMode: "mock",
        status: "degraded",
        note: "No telemetry events found for live mode.",
      },
      sessionSummary: {
        ...base.sessionSummary,
        runtimeMode: "UNKNOWN",
        settledTrades: 0,
      },
      activityFeed: [],
    };
  }

  const latestEvent = events[events.length - 1];
  const latestSessionId = latestEvent.sessionId;
  const sessionEvents = latestSessionId ? events.filter((event) => event.sessionId === latestSessionId) : events;
  const activeSession = buildActiveSessionTelemetry(
    completeSessionEvents,
    Date.now(),
  );

  const latestReference = [...sessionEvents].reverse().find((event) => event.type === "market.external_reference");
  const latestFeedTick = [...sessionEvents].reverse().find((event) => event.type === "feed.tick");
  const latestFeedSummary = [...sessionEvents].reverse().find((event) => event.type === "feed.summary");
  const latestRtt = [...sessionEvents].reverse().find((event) => event.type === "feed.rtt");
  const latestRejection = [...sessionEvents].reverse().find((event) => event.type === "trade.signal_rejected");
  const paperBalance = await loadPersistedPaperBalance(base.wallet.balance);
  const realizedTrades = buildRealizedTradeRecords(sessionEvents);

  const btcPrice = asNumber(latestReference?.payload.priceUsd) ?? base.header.btcPrice;
  const previousReference = [...sessionEvents]
    .reverse()
    .filter((event) => event.type === "market.external_reference")
    .slice(0, 2)[1];
  const prevPrice = asNumber(previousReference?.payload.priceUsd) ?? btcPrice;
  const rttMs = asNumber(latestRtt?.payload.rttMs);
  const avgLatencyMs = asNumber(latestFeedSummary?.payload.averageLatencyMs);
  const tickCount = asNumber(latestFeedSummary?.payload.tickCount);
  const staleSeconds = Math.max(0, Math.round((Date.now() - new Date(latestEvent.timestamp).getTime()) / 1000));
  const recentTrades = realizedTrades.length
    ? realizedTrades.slice(-8).reverse().map((trade, index) => ({
      id: trade.id,
      offset: `+${20 - index * 2}`,
      side: trade.side,
      price: round(trade.price * (trade.price < 2 ? 100000 : 1)),
      confidence: trade.confidence,
      pnl: trade.pnl,
      status: trade.status,
    }))
    : ensureRecentTrades(sessionEvents);
  const checkpointHistory = buildCheckpointHistory(events);
  const pnlHistory = checkpointHistory.length
    ? checkpointHistory
    : buildPnlHistory(sessionEvents, paperBalance);

  const liveTape = sessionEvents
    .slice(-24)
    .map(buildTapeItem)
    .filter((item): item is TapeItem => Boolean(item))
    .slice(-12);

  const latestPrices = latestFeedTick?.payload.prices as JsonRecord | undefined;
  const upBuy = asNumber(latestPrices?.upBuyPrice) ?? 0.5;
  const upSell = asNumber(latestPrices?.upSellPrice) ?? 0.49;
  const downBuy = asNumber(latestPrices?.downBuyPrice) ?? 0.5;
  const downSell = asNumber(latestPrices?.downSellPrice) ?? 0.49;
  const telemetryCandles = buildTelemetryCandles(sessionEvents, base.btcChart);
  const telemetryVolume = buildTelemetryVolumeBars(sessionEvents, telemetryCandles);

  const bidBase = btcPrice - 4;
  const askBase = btcPrice + 4;
  const orderBook = {
    spread: round(Math.abs(upBuy - upSell), 2),
    bidShare: Math.round((downBuy / Math.max(downBuy + upBuy, 0.01)) * 100),
    bids: Array.from({ length: 12 }, (_, index) => ({
      price: round(bidBase - index * 1.25, 2),
      size: round(Math.max(1, downBuy * 100 - index * 4), 2),
      total: round(Math.max(1, downBuy * 100 * (index + 1)), 2),
    })),
    asks: Array.from({ length: 12 }, (_, index) => ({
      price: round(askBase + index * 1.25, 2),
      size: round(Math.max(1, upBuy * 100 - index * 3), 2),
      total: round(Math.max(1, upBuy * 100 * (index + 1)), 2),
    })),
  };

  const rejectionReason = asString(latestRejection?.payload.reason)?.replace(/_/g, " ") || "tracking";
  const sessionStartedAt = latestEvent.sessionStartedAt || latestEvent.timestamp;
  const sessionClockMinutes = Math.max(1, Math.round((Date.now() - new Date(sessionStartedAt).getTime()) / 60000));
  const totalShadowPnL = recentTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
  const realizedWins = recentTrades.filter((trade) => trade.status === "WIN").length;
  const realizedClosed = recentTrades.filter((trade) => trade.status !== "OPEN").length;
  const strategy = asString(latestRejection?.payload.strategy) || "trade_4";

  const runtimeMode = activeSession.sessionSummary.runtimeMode === "UNKNOWN"
    ? base.header.runtimeMode
    : activeSession.sessionSummary.runtimeMode;
  const status: TerminalState["meta"]["status"] = staleSeconds > 20 || (rttMs != null && rttMs > 2500) ? "degraded" : "ok";

  return {
    ...base,
    sessionSummary: activeSession.sessionSummary,
    activityFeed: activeSession.activityFeed,
    meta: {
      requestedMode: "live",
      sourceMode: "live",
      generatedAt: new Date().toISOString(),
      stale: staleSeconds > 20,
      status,
      note: `Live telemetry session ${truncateMiddle(latestSessionId || "unknown", 8, 6)} · ${staleSeconds}s old`,
    },
    header: {
      ...base.header,
      botId,
      strategyLabel: `${strategy.toUpperCase()} · BTC UP/DOWN 5MIN`,
      btcPrice,
      btcChange: round(btcPrice - prevPrice, 2),
      trades30d: realizedTrades.length || events.filter((event) => event.type === "trade.shadow_pnl").length,
      winRate: realizedClosed
        ? round((realizedWins / realizedClosed) * 100, 1)
        : base.header.winRate,
      utcTime: new Date(latestEvent.timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC",
      runtimeMode,
    },
    wallet: {
      ...base.wallet,
      alias: truncateMiddle(latestSessionId || base.wallet.alias, 12, 6),
      walletAddress: base.wallet.walletAddress,
      pnl30d: round((checkpointHistory.at(-1)?.value ?? paperBalance) - (checkpointHistory[0]?.value ?? paperBalance), 2),
      trades30d: realizedTrades.length || events.filter((event) => event.type === "trade.shadow_pnl").length,
      winRate: realizedClosed
        ? round((realizedWins / realizedClosed) * 100, 1)
        : base.wallet.winRate,
      avgRiskReward: round(recentTrades.reduce((sum, trade) => sum + Math.abs(trade.pnl || 0), 0) / Math.max(realizedClosed || recentTrades.length, 1), 2),
      balance: paperBalance,
      liveBadge: status === "ok" ? "LIVE" : "DEGRADED",
    },
    btcChart: telemetryCandles.map((candle, index) => ({
      ...candle,
      marker: index === telemetryCandles.length - 1 ? (downBuy > upBuy ? "DOWN" : "UP") : candle.marker,
    })),
    btcVolume: telemetryVolume,
    orderBook,
    forceGraph: {
      ...base.forceGraph,
      convergence: round(Math.max(12, 100 - (avgLatencyMs || 0) / 80 - (rttMs || 0) / 120), 1),
      bearPaths: Math.round(downBuy * 4000),
      bullPaths: Math.round(upBuy * 4000),
      hubNodes: latestFeedSummary ? Math.max(0, Math.round((asNumber(latestFeedSummary.payload.fallbackCount) || 0) / 2)) : base.forceGraph.hubNodes,
      signal: downBuy > upBuy ? "STRONG DOWN" : "REVERSAL UP",
      streakMinutes: sessionClockMinutes,
      profitPace: round(totalShadowPnL / Math.max(sessionClockMinutes / 60, 1 / 60), 0),
      nextTradeSeconds: Math.max(1, 60 - (new Date(latestEvent.timestamp).getSeconds() % 60)),
      tradeNumber: recentTrades.length,
      ci: round(Math.abs(upBuy - downBuy), 2),
      pathCount: Math.round((tickCount || 0) + (events.length % 500)),
      referencePrice: btcPrice,
      priceLevels: Array.from({ length: 5 }, (_, index) => round(btcPrice + (2 - index) * 40, 0)),
    },
    recentTrades: recentTrades.length ? recentTrades : base.recentTrades,
    pnlHistory: pnlHistory.length ? pnlHistory : base.pnlHistory,
    analytics: {
      widgets: [
        { label: "MONTE CARLO", value: `${events.filter((event) => event.type.includes("signal")).length}`, tone: "info" },
        { label: "FEED RTT", value: `${Math.round(rttMs || 0)}ms`, tone: (rttMs || 0) > 2500 ? "negative" : "positive" },
        { label: "LATENCY", value: `${Math.round(avgLatencyMs || 0)}ms`, tone: (avgLatencyMs || 0) > 1200 ? "negative" : "warning", ratio: Math.min((avgLatencyMs || 0) / 5000, 1) },
        { label: "REJECT", value: rejectionReason.toUpperCase(), tone: "warning", ratio: Math.min((asNumber(latestRejection?.payload.feedLatencyMs) || 0) / 2000, 1) },
      ],
    },
    executionCycle: {
      ...base.executionCycle,
      elapsedSeconds: round(((avgLatencyMs || 0) + (rttMs || 0)) / 1000, 2),
      fillTimeSeconds: round(((avgLatencyMs || 0) + (rttMs || 0)) / 1000, 2),
      statusText: status === "ok" ? "LIVE TELEMETRY LOCKED" : "FEED HEALTH DEGRADED",
      steps: [
        { ...base.executionCycle.steps[0], state: "done", metric: `${Math.round((avgLatencyMs || 0) / 8)}ms` },
        { ...base.executionCycle.steps[1], state: "done", metric: `${Math.round((rttMs || 0) / 8)}ms` },
        { ...base.executionCycle.steps[2], state: "done", metric: `${Math.round((asNumber(latestRejection?.payload.feedAgeMs) || 0) + 50)}ms` },
        { ...base.executionCycle.steps[3], state: "active", metric: `${Math.round((asNumber(latestRejection?.payload.feedLatencyMs) || 0) + 80)}ms` },
        { ...base.executionCycle.steps[4], state: "idle", metric: `${Math.round((asNumber(latestRejection?.payload.feedRttMs) || 0) + 120)}ms` },
        { ...base.executionCycle.steps[5], state: "idle", metric: `${Math.round((rttMs || 0) + 160)}ms` },
      ],
    },
    liveTape: liveTape.length ? liveTape : base.liveTape,
    bestTrade: {
      ...base.bestTrade,
      title: `${botId.toUpperCase()} BEST`,
      timeframeLabel: `SESSION ${sessionClockMinutes}M`,
      lastBigPnl: round(recentTrades[0]?.pnl || 0, 2),
      lastBigTrades: realizedTrades.length || recentTrades.length,
      featuredPnl: round(totalShadowPnL, 2),
      days: [
        { label: "SESSION", pnl: round(totalShadowPnL, 2), trades: realizedTrades.length || recentTrades.length },
        { label: "AVG RTT", pnl: round(rttMs || 0, 0), trades: Math.round(tickCount || 0) },
        { label: "AVG LAT", pnl: round(avgLatencyMs || 0, 0), trades: Math.round(events.length) },
      ],
    },
  };
}
