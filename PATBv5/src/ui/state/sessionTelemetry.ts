import type { ActivityEvent, PnLPoint, SessionRuntimeMode, SessionSummary, TradeRow } from "../types";
import type { TelemetryEvent } from "./telemetryEvent";

export type { TelemetryEvent } from "./telemetryEvent";

export interface RealizedTradeRecord {
  id: string;
  timestamp: string;
  side: TradeRow["side"];
  price: number;
  pnl: number | null;
  confidence: number;
  status: TradeRow["status"];
  label: string;
}

export interface ActiveSessionTelemetry {
  sessionEvents: TelemetryEvent[];
  realizedTrades: RealizedTradeRecord[];
  sessionSummary: SessionSummary;
  activityFeed: ActivityEvent[];
}

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

export function buildRealizedTradeRecords(events: TelemetryEvent[]): RealizedTradeRecord[] {
  return events
    .filter((event) => ["paper_trade.buy", "paper_trade.sell", "live_trade.buy", "live_trade.sell", "trade.entry_filled", "trade.exit_filled"].includes(event.type))
    .map((event, index) => {
      const side = (asString(event.payload.side)?.toUpperCase() === "DOWN" ? "DOWN" : "UP") as TradeRow["side"];
      const price = asNumber(event.payload.entryPrice) ?? asNumber(event.payload.exitPrice) ?? asNumber(event.payload.price) ?? 0;
      const pnl = asNumber(event.payload.pnlUsd) ?? asNumber(event.payload.realizedTradePnl);
      const confidence = Math.max(50, Math.min(99, 100 - (asNumber(event.payload.feedLatencyMs) ?? 0) / 35 - (asNumber(event.payload.feedRttMs) ?? 0) / 45));
      const isExit = event.type.includes("sell") || event.type === "trade.exit_filled";
      const status: TradeRow["status"] = !isExit || pnl == null ? "OPEN" : pnl >= 0 ? "WIN" : "LOSS";
      return {
        id: `${event.type}-${event.timestamp}-${index}`,
        timestamp: event.timestamp,
        side,
        price,
        pnl: isExit ? pnl : null,
        confidence: round(confidence, 1),
        status,
        label: isExit ? "FILLED EXIT" : "FILLED ENTRY",
      };
    });
}

function toActivityEvent(event: TelemetryEvent, index: number): ActivityEvent | null {
  const market = asString(event.payload.market) ?? asString(event.payload.slug);
  const amountUsd = asNumber(event.payload.amountUsd) ?? asNumber(event.payload.tradeUsd);
  const pnlUsd = asNumber(event.payload.pnlUsd) ?? asNumber(event.payload.realizedTradePnl) ?? asNumber(event.payload.hypotheticalPnlUsd);
  const detail = asString(event.payload.reason) ?? asString(event.payload.decisionSource) ?? event.type.replace(/[._]/g, " ");
  const base = { id: `${event.type}-${event.timestamp}-${index}`, timestamp: event.timestamp, market, detail, amountUsd, pnlUsd };
  if (["paper_trade.buy", "live_trade.buy", "trade.entry_filled"].includes(event.type)) return { ...base, category: "trade", action: "BUY", tone: "info" };
  if (["paper_trade.sell", "live_trade.sell"].includes(event.type)) return { ...base, category: "trade", action: "SELL", tone: pnlUsd == null ? "warning" : pnlUsd >= 0 ? "positive" : "negative" };
  if (event.type === "trade.exit_filled") return { ...base, category: "settlement", action: "FILL", tone: pnlUsd == null ? "warning" : pnlUsd >= 0 ? "positive" : "negative" };
  if (event.type === "trade.shadow_pnl") return { ...base, category: "settlement", action: "SETTLED", tone: (pnlUsd ?? 0) >= 0 ? "positive" : "negative" };
  if (event.type === "trade.signal_rejected") return { ...base, category: "rejection", action: "REJECT", tone: "negative" };
  if (event.type.includes("gate")) return { ...base, category: "gate", action: "GATE", tone: "warning" };
  if (event.type.startsWith("feed.")) return { ...base, category: "feed", action: "FEED", tone: "warning" };
  return null;
}

export function buildActiveSessionTelemetry(events: TelemetryEvent[], nowMs = Date.now()): ActiveSessionTelemetry {
  if (events.length === 0) {
    const now = new Date(nowMs).toISOString();
    return {
      sessionEvents: [],
      realizedTrades: [],
      sessionSummary: {
        sessionId: "unknown",
        startedAt: now,
        runtimeMode: "UNKNOWN",
        startingBalance: null,
        currentBalance: null,
        realizedPnl: 0,
        settledTrades: 0,
        wins: 0,
        losses: 0,
        winRate: null,
        pnlHistory: [{ time: now, value: 0 }],
        dataAgeSeconds: 0,
        status: "stale",
      },
      activityFeed: [],
    };
  }

  const latestSessionId = [...events].reverse().find((event) => event.sessionId)?.sessionId ?? "unknown";
  const sessionEvents = events.filter((event) => event.sessionId === latestSessionId);
  const startedAt = sessionEvents[0]?.sessionStartedAt ?? sessionEvents[0]?.timestamp ?? new Date(nowMs).toISOString();
  const startup = sessionEvents.find((event) => event.type === "bot.startup");
  const declaredMode = typeof startup?.payload.mode === "string" ? startup.payload.mode.toUpperCase() : "";
  const runtimeMode: SessionRuntimeMode = declaredMode === "PAPER" || declaredMode === "LIVE" ? declaredMode : "UNKNOWN";
  const realizedTrades = buildRealizedTradeRecords(sessionEvents);
  const settled = realizedTrades.filter((trade) => trade.status === "WIN" || trade.status === "LOSS");
  const wins = settled.filter((trade) => trade.status === "WIN").length;
  const losses = settled.filter((trade) => trade.status === "LOSS").length;
  const realizedPnl = round(settled.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0), 2);
  let runningPnl = 0;
  const pnlHistory: PnLPoint[] = [{ time: startedAt, value: 0 }];
  for (const trade of settled) {
    runningPnl = round(runningPnl + (trade.pnl ?? 0), 2);
    pnlHistory.push({ time: trade.timestamp, value: runningPnl });
  }
  const checkpoints = sessionEvents.filter((event) => event.type === "paper_balance.checkpoint");
  const startingBalance = asNumber(startup?.payload.paperStartingUsd) ?? asNumber(checkpoints[0]?.payload.balance);
  const currentBalance = asNumber(checkpoints.at(-1)?.payload.balance) ?? startingBalance;
  const latestTimestamp = sessionEvents.at(-1)?.timestamp ?? startedAt;
  const dataAgeSeconds = Math.max(0, Math.round((nowMs - Date.parse(latestTimestamp)) / 1000));
  const status = dataAgeSeconds > 20 ? "stale" : dataAgeSeconds > 6 ? "degraded" : "ok";
  const sessionSummary: SessionSummary = {
    sessionId: latestSessionId,
    startedAt,
    runtimeMode,
    startingBalance,
    currentBalance,
    realizedPnl,
    settledTrades: settled.length,
    wins,
    losses,
    winRate: settled.length ? round((wins / settled.length) * 100, 1) : null,
    pnlHistory,
    dataAgeSeconds,
    status,
  };
  const activityFeed = sessionEvents
    .map(toActivityEvent)
    .filter((event): event is ActivityEvent => event !== null)
    .reverse();
  return { sessionEvents, realizedTrades, sessionSummary, activityFeed };
}
