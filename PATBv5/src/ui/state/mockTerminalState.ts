import { getTelemetryBotId, getTelemetryDbPath, loadPersistedPaperBalance } from "../../telemetry";
import { TerminalState, ForceNode, ForceLink, TradeRow, Candle, VolumeBar } from "../types";

const BOT_STRATEGY_LABEL = "V4.2 · POLYMARKET BTC UP/DOWN 5MIN";

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function seededWave(seed: number, amplitude: number, phase = 0): number {
  return Math.sin(seed + phase) * amplitude;
}

function formatUtcTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function buildCandles(basePrice: number, seed: number) {
  const candles = [];
  let lastClose = basePrice - 220;

  for (let index = 0; index < 20; index += 1) {
    const drift = seededWave(seed / 3 + index * 0.42, 85, 0.4);
    const open = lastClose;
    const close = round(open + drift);
    const wick = 32 + Math.abs(seededWave(seed / 4 + index * 0.29, 46));
    candles.push({
      time: new Date(Date.now() - (19 - index) * 5 * 60_000).toISOString(),
      open: round(open),
      close,
      high: round(Math.max(open, close) + wick),
      low: round(Math.min(open, close) - wick),
      marker: index % 7 === 0 ? (close >= open ? "UP" : "DOWN") : undefined,
    });
    lastClose = close;
  }

  return candles;
}

function buildOrderBook(basePrice: number, seed: number) {
  const bids = [];
  const asks = [];

  for (let index = 0; index < 12; index += 1) {
    const bidSize = round(8 + Math.abs(seededWave(seed + index * 0.3, 18)));
    const askSize = round(7 + Math.abs(seededWave(seed + index * 0.34, 16, 1.6)));
    bids.push({
      price: round(basePrice - 0.4 - index * 0.37),
      size: bidSize,
      total: round(bidSize * (index + 1)),
    });
    asks.push({
      price: round(basePrice + 0.4 + index * 0.37),
      size: askSize,
      total: round(askSize * (index + 1)),
    });
  }

  return {
    spread: round(asks[0].price - bids[0].price),
    bidShare: 48 + Math.round(seededWave(seed / 10, 6)),
    bids,
    asks,
  };
}

function buildVolumeBars(candles: Candle[], seed: number): VolumeBar[] {
  return candles.map((candle, index) => {
    const magnitude = Math.abs(candle.close - candle.open);
    const value = round(0.8 + magnitude / 18 + Math.abs(seededWave(seed / 5 + index * 0.41, 1.9)), 4);
    return {
      time: candle.time,
      value,
      color: candle.close >= candle.open ? "#00c08788" : "#ff5b4f88",
    };
  });
}

function buildGraph(seed: number, basePrice: number): { nodes: ForceNode[]; links: ForceLink[] } {
  const types: ForceNode["type"][] = [
    "BEARSIGNAL",
    "BULLSIGNAL",
    "MEDIANPATH",
    "CATALYST",
    "CLUSTER",
    "COLLISION",
  ];
  const nodes: ForceNode[] = [];
  const links: ForceLink[] = [];

  for (let index = 0; index < 96; index += 1) {
    const type = types[index % types.length];
    const weight = round(0.55 + Math.abs(seededWave(seed / 12 + index * 0.37, 1.4)), 3);
    const xBias = round(((index % 12) - 5.5) * 28 + seededWave(seed + index, 16), 3);
    const yBias = round((Math.floor(index / 12) - 3.5) * 22 + seededWave(seed / 2 + index, 14), 3);
    nodes.push({
      id: `node-${index + 1}`,
      label: `${type.slice(0, 4)}-${index + 1}`,
      type,
      weight,
      connections: type === "CATALYST" ? 8 : 3 + (index % 5),
      xBias,
      yBias,
    });
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index];
    const next = nodes[(index + 1) % nodes.length];
    links.push({
      source: current.id,
      target: next.id,
      tone: current.type === "BEARSIGNAL" ? "bear" : current.type === "BULLSIGNAL" ? "bull" : "neutral",
    });

    if (index % 3 === 0) {
      const tertiary = nodes[(index + 9) % nodes.length];
      links.push({
        source: current.id,
        target: tertiary.id,
        tone: index % 2 === 0 ? "bear" : "bull",
      });
    }
  }

  return { nodes, links };
}

function buildRecentTrades(basePrice: number, seed: number): TradeRow[] {
  return Array.from({ length: 8 }, (_, index) => {
    const pnl = index === 0 ? null : round(seededWave(seed / 5 + index * 0.91, 182), 2);
    return {
      id: `trade-${index + 1}`,
      offset: `+${20 - index * 2}`,
      side: (index % 2 === 0 ? "UP" : "DOWN") as "UP" | "DOWN",
      price: round(basePrice + seededWave(seed / 7 + index * 0.61, 380)),
      confidence: round(78 + Math.abs(seededWave(seed / 9 + index, 18)), 1),
      pnl,
      status: (pnl == null ? "OPEN" : pnl >= 0 ? "WIN" : "LOSS") as "OPEN" | "WIN" | "LOSS",
    };
  });
}

function buildPnlHistory(seed: number) {
  let current = 164_000;
  return Array.from({ length: 28 }, (_, index) => {
    current += seededWave(seed / 8 + index * 0.41, 14_200) + 7_500;
    return {
      time: new Date(Date.now() - (27 - index) * 24 * 60_000).toISOString(),
      value: round(current, 0),
    };
  });
}

function buildTape(basePrice: number, seed: number) {
  return [
    { id: "tape-1", text: `WIN · BTC UP · +$${round(2.19 + Math.abs(seededWave(seed, 6)), 2)}`, tone: "positive" as const },
    { id: "tape-2", text: `BTC · UP · -${Math.round(620 + Math.abs(seededWave(seed / 2, 540)))} · entry_time_ratio`, tone: "negative" as const },
    { id: "tape-3", text: `MIROFISH SIGNAL · ${round(91 + Math.abs(seededWave(seed / 3, 7)), 1)}% conf`, tone: "warning" as const },
    { id: "tape-4", text: `BTC PRINT · $${basePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, tone: "info" as const },
    { id: "tape-5", text: `REJECTED · SLIPPAGE · ${round(0.08 + Math.abs(seededWave(seed / 4, 0.14)), 2)}%`, tone: "negative" as const },
    { id: "tape-6", text: `WIN · BTC DOWN · +$${round(5.12 + Math.abs(seededWave(seed / 6, 7)), 2)}`, tone: "positive" as const },
  ];
}

export async function buildMockTerminalState(requestedMode: "mock" | "live"): Promise<TerminalState> {
  const now = new Date();
  const nowIso = now.toISOString();
  const seed = now.getTime() / 1000;
  const botId = getTelemetryBotId();
  const liveRequested = requestedMode === "live";
  const basePrice = round(77_502.07 + seededWave(seed / 10, 480), 2);
  const ethPrice = round(3_670.99 + seededWave(seed / 11, 44), 2);
  const paperBalance = round(await loadPersistedPaperBalance(2_500), 2);
  const graph = buildGraph(seed, basePrice);
  const btcChart = buildCandles(basePrice, seed);
  const recentTrades = buildRecentTrades(basePrice, seed);
  const pnlHistory = buildPnlHistory(seed);
  const liveTape = buildTape(basePrice, seed);

  return {
    meta: {
      requestedMode,
      sourceMode: "mock",
      generatedAt: nowIso,
      stale: false,
      status: liveRequested ? "degraded" : "ok",
      note: liveRequested ? `Live telemetry adapter not wired yet. Serving generated state from ${getTelemetryDbPath()}.` : "Generated terminal state",
    },
    sessionSummary: {
      sessionId: "mock",
      startedAt: nowIso,
      runtimeMode: liveRequested ? "UNKNOWN" : "PAPER",
      startingBalance: paperBalance,
      currentBalance: paperBalance,
      realizedPnl: 0,
      settledTrades: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      pnlHistory: [{ time: nowIso, value: 0 }],
      dataAgeSeconds: 0,
      status: liveRequested ? "degraded" : "ok",
    },
    activityFeed: [],
    header: {
      botId,
      strategyLabel: BOT_STRATEGY_LABEL,
      btcPrice: basePrice,
      btcChange: round(seededWave(seed / 9, 1.8), 2),
      ethPrice,
      trades30d: 1350,
      winRate: round(78.4 + seededWave(seed / 13, 2.1), 1),
      utcTime: formatUtcTime(now),
      runtimeMode: liveRequested ? "LIVE" : "PAPER",
    },
    wallet: {
      alias: "nj23adsknml3",
      walletAddress: "0x8745f3a2be90c89f7a80d8b1d0f1fa57d0ae13d9",
      venue: "POLYMARKET",
      pnl30d: round(250_000 + seededWave(seed / 7, 18_500), 0),
      trades30d: 1350,
      winRate: round(78.4 + seededWave(seed / 13, 2.1), 1),
      avgRiskReward: round(2.41 + seededWave(seed / 15, 0.16), 2),
      balance: paperBalance,
      liveBadge: liveRequested ? "LIVE" : "PAPER",
    },
    btcChart,
    btcVolume: buildVolumeBars(btcChart, seed),
    orderBook: buildOrderBook(basePrice, seed),
    forceGraph: {
      ...graph,
      convergence: round(94.5 + seededWave(seed / 18, 2.3), 1),
      bearPaths: Math.round(3264 + seededWave(seed / 15, 220)),
      bullPaths: Math.round(783 + seededWave(seed / 17, 180)),
      hubNodes: 4,
      signal: seededWave(seed / 12, 1) > 0 ? "STRONG DOWN" : "REVERSAL BUILD",
      streakMinutes: Math.max(12, Math.round(48 + seededWave(seed / 20, 8))),
      profitPace: round(347 + seededWave(seed / 13, 41), 0),
      nextTradeSeconds: Math.max(1, 7 - Math.floor(seed % 7)),
      tradeNumber: 16,
      ci: round(0.48 + Math.abs(seededWave(seed / 22, 0.18)), 2),
      pathCount: Math.round(2048 + seededWave(seed / 19, 180)),
      referencePrice: round(basePrice - 322.07, 2),
      priceLevels: Array.from({ length: 5 }, (_, index) => round(basePrice + (2 - index) * 140, 0)),
    },
    recentTrades,
    pnlHistory,
    analytics: {
      widgets: [
        { label: "MONTE CARLO", value: `${Math.round(2053 + seededWave(seed / 14, 90))}`, tone: "info" },
        { label: "VOLUME PROFILE", value: `${round(890 + seededWave(seed / 15, 70), 0)}K`, tone: "positive" },
        { label: "SENTIMENT", value: `${round(-0.55 + seededWave(seed / 16, 0.18), 2)}`, tone: "negative", ratio: 0.74 },
        { label: "INVENTORY", value: `${round(-4.28 + seededWave(seed / 17, 1.4), 2)}`, tone: "warning", ratio: 0.56 },
      ],
    },
    executionCycle: {
      cycleId: "#1 285",
      budget: 2.75,
      elapsedSeconds: round(1.56 + seededWave(seed / 21, 0.2), 2),
      fillTimeSeconds: round(1.56 + seededWave(seed / 22, 0.17), 2),
      statusText: "FILL TIME UNDER BUDGET",
      steps: [
        { id: "scan", title: "01 Scan", sublabel: "BTC TICK·09", metric: "188ms", durationMs: 188, state: "done" },
        { id: "detect", title: "02 Detect", sublabel: "YES-NO·+1", metric: "99ms", durationMs: 99, state: "done" },
        { id: "validate", title: "03 Validate", sublabel: "DEPTH·RISK", metric: "167ms", durationMs: 167, state: "done" },
        { id: "size", title: "04 Size", sublabel: "KELLY·CAP", metric: "80ms", durationMs: 80, state: "done" },
        { id: "fill", title: "05 Fill", sublabel: "DUAL-LEG", metric: "477ms", durationMs: 477, state: "active" },
        { id: "settle", title: "06 Settle", sublabel: "CONFIRM", metric: "609ms", durationMs: 609, state: "idle" },
      ],
    },
    liveTape,
    bestTrade: {
      title: "#1 BTC TRADER",
      timeframeLabel: "BEST 3 DAY",
      lastBigPnl: 1436,
      lastBigTrades: 16,
      featuredPnl: 27845,
      days: [
        { label: "7 MAY", pnl: 22056, trades: 1124 },
        { label: "6 MAY", pnl: 32544, trades: 1699 },
        { label: "5 MAY", pnl: 27845, trades: 1332 },
      ],
    },
  };
}
