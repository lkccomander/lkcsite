export type TapeTone = "positive" | "negative" | "warning" | "info";

export interface HeaderData {
  botId: string;
  strategyLabel: string;
  btcPrice: number;
  btcChange: number;
  ethPrice: number;
  trades30d: number;
  winRate: number;
  utcTime: string;
  runtimeMode: "PAPER" | "LIVE";
}

export interface WalletData {
  alias: string;
  walletAddress: string;
  venue: string;
  pnl30d: number;
  trades30d: number;
  winRate: number;
  avgRiskReward: number;
  balance: number;
  liveBadge: string;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  marker?: "UP" | "DOWN";
}

export interface VolumeBar {
  time: string;
  value: number;
  color?: string;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface OrderBookData {
  spread: number;
  bidShare: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export type ForceNodeType =
  | "BEARSIGNAL"
  | "BULLSIGNAL"
  | "MEDIANPATH"
  | "CATALYST"
  | "CLUSTER"
  | "COLLISION";

export interface ForceNode {
  id: string;
  label: string;
  type: ForceNodeType;
  weight: number;
  connections: number;
  xBias: number;
  yBias: number;
}

export interface ForceLink {
  source: string;
  target: string;
  tone: "bull" | "bear" | "neutral";
}

export interface ForceGraphData {
  nodes: ForceNode[];
  links: ForceLink[];
  convergence: number;
  bearPaths: number;
  bullPaths: number;
  hubNodes: number;
  signal: string;
  streakMinutes: number;
  profitPace: number;
  nextTradeSeconds: number;
  tradeNumber: number;
  ci: number;
  pathCount: number;
  referencePrice: number;
  priceLevels: number[];
}

export interface TradeRow {
  id: string;
  offset: string;
  side: "UP" | "DOWN";
  price: number;
  confidence: number;
  pnl: number | null;
  status: "OPEN" | "WIN" | "LOSS";
}

export interface PnLPoint {
  time: string;
  value: number;
}

export type SessionRuntimeMode = "PAPER" | "LIVE" | "UNKNOWN";
export type SessionStatus = "ok" | "degraded" | "stale";

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  runtimeMode: SessionRuntimeMode;
  startingBalance: number | null;
  currentBalance: number | null;
  realizedPnl: number;
  settledTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pnlHistory: PnLPoint[];
  dataAgeSeconds: number;
  status: SessionStatus;
}

export type ActivityCategory = "trade" | "settlement" | "rejection" | "gate" | "feed";
export type ActivityAction = "BUY" | "SELL" | "FILL" | "SETTLED" | "REJECT" | "GATE" | "FEED";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  action: ActivityAction;
  market: string | null;
  detail: string;
  amountUsd: number | null;
  pnlUsd: number | null;
  tone: TapeTone;
}

export interface AnalyticsWidget {
  label: string;
  value: string;
  tone: TapeTone;
  ratio?: number;
}

export interface AnalyticsData {
  widgets: AnalyticsWidget[];
}

export interface CycleStep {
  id: string;
  title: string;
  sublabel: string;
  metric: string;
  durationMs: number;
  state: "done" | "active" | "idle";
}

export interface CycleData {
  cycleId: string;
  budget: number;
  elapsedSeconds: number;
  fillTimeSeconds: number;
  statusText: string;
  steps: CycleStep[];
}

export interface TapeItem {
  id: string;
  text: string;
  tone: TapeTone;
}

export interface BestTradeDay {
  label: string;
  pnl: number;
  trades: number;
}

export interface BestTradeData {
  title: string;
  timeframeLabel: string;
  lastBigPnl: number;
  lastBigTrades: number;
  featuredPnl: number;
  days: BestTradeDay[];
}

export interface TerminalMeta {
  requestedMode: "mock" | "live";
  sourceMode: "mock" | "live";
  generatedAt: string;
  stale: boolean;
  status: "ok" | "degraded";
  note?: string;
}

export interface TerminalState {
  meta: TerminalMeta;
  header: HeaderData;
  wallet: WalletData;
  btcChart: Candle[];
  btcVolume: VolumeBar[];
  orderBook: OrderBookData;
  forceGraph: ForceGraphData;
  recentTrades: TradeRow[];
  pnlHistory: PnLPoint[];
  sessionSummary: SessionSummary;
  activityFeed: ActivityEvent[];
  analytics: AnalyticsData;
  executionCycle: CycleData;
  liveTape: TapeItem[];
  bestTrade: BestTradeData;
}
