// src/report/types.ts
export interface FeedWindow {
  slug: string;
  status: 'OK' | 'ELEVATED' | 'SPIKE';
  fallbacks: number;
  rttAvg: number;
  rttMax: number;
  rttP95: number;
  start: string;
  end: string;
  reconnectEvents: number;
  fallbackReasons: Record<string, number>;
}

export interface RejectionBucket {
  reason: string;
  count: number;
  isNewSignalReason: boolean;
}

export interface RejectionPayloadRecord {
  reason: string;
  payload: Record<string, unknown>;
}

export interface Anomaly {
  priority: number;
  type: 'BUG' | 'FIX' | 'TUNE' | 'MONITOR' | 'PASS';
  severity: 'red' | 'amber' | 'gray' | 'green';
  title: string;
  detail: string;
}

export interface GateCheck {
  id: string;
  label: string;
  pass: boolean;
  note: string;
}

export interface TradeRecord {
  tokenId: string;
  side: string;
  entryPrice: number;
  exitPrice: number | null;
  holdSeconds: number;
  grossPnl: number;
  sellReason: string;
  mcConvergence: number;
  mcSimulatedDirection: string;
  momentumDirection: string;
  momentumScore: number;
  momentumConfidence: number;
  momentumDelta1m: number;
  feedLatencyMs: number;
  feedRttMs: number;
  makerMode: boolean;
  feeUsd: number;
  btcAtEntry: number | null;
  btcAtExit: number | null;
  missingFields: string[];
  // Additional fields from paper_trade.sell
  shares: number;
  cashBefore: number | null;
  cashAfter: number | null;
  rebateUsd: number;
  // Additional fields from trade.entry_filled
  decisionSource: string;
  feedAgeMs: number;
  feedSnapshotSource: string;
  positionState: string;
  holdingStatus: string;
  // Additional fields from live_trade.sell
  exitPriceActual: number | null;
  sharesSold: number | null;
  avgPrice: number | null;
}

export interface SessionReport {
  // Session identity
  sessionIds: string[];
  files: string[];
  totalEvents: number;
  strategy: string;
  mode: string;
  startBalance: number;
  
  // Event counts
  buys: number;
  sells: number;
  rejectionCount: number;
  fallbackCount: number;
  momEventCount: number;
  mcEventCount: number;
  shadowEventCount: number;
  
  // PnL metrics
  netPnl: number;
  grossPnl: number;
  totalFees: number;
  shadowWinRate: number;
  shadowTotalHypothetical: number;
  
  // Feed metrics
  rttAvg: number;
  rttMax: number;
  rttP95: number;
  feedWindows: FeedWindow[];
  
  // Monte Carlo metrics
  mcConvAvg: number;
  mcConvMin: number;
  mcConvMax: number;
  mcBelow062: number;
  mcBelow068: number;
  
  // Momentum metrics
  momDirections: Record<string, number>;
  momScoreMin: number;
  momScoreMax: number;
  momConfAvg: number;
  
  // Trades and analysis
  trades: TradeRecord[];
  rejectionBreakdown: RejectionBucket[];
  rejectionPayloads: Record<string, RejectionPayloadRecord[]>;
  anomalies: Anomaly[];
  gateChecks: GateCheck[];
}
