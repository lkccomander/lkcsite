export type EvaluatorVerdict = "PASS" | "WARNING" | "FAIL" | "INCOMPLETE" | "UNKNOWN";

export type VersionContext = {
  strategyVersionId: string;
  strategyConfigHash: string;
  botBuildVersionId: string;
  repoId: string;
  gitCommit: string;
  gitBranch: string;
  gitDirty: boolean;
};

export type TelemetryEvent = {
  type: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
  botId?: string;
  sessionId?: string;
  sessionStartedAt?: string;
  versionContext?: Partial<VersionContext>;
};

export type TradeSide = "PAPER_BUY" | "PAPER_SELL" | "LIVE_BUY" | "LIVE_SELL";

export type TradeRecord = {
  side: TradeSide;
  tokenId: string | null;
  marketSlug: string | null;
  timestamp: string | null;
  price: number | null;
  shares: number | null;
  pnl: number | null;
  reason: string | null;
};

export type SessionEvaluation = {
  sessionId: string;
  sourceFile: string;
  status: "COMPLETED" | "INCOMPLETE";
  botId: string;
  mode: "PAPER" | "LIVE" | "UNKNOWN";
  strategyName: string;
  strategyVersionId: string;
  strategyConfigHash: string;
  botBuildVersionId: string;
  repoId: string;
  gitCommit: string;
  gitBranch: string;
  gitDirty: boolean;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  totalEvents: number;
  totalTrades: number;
  paperBuys: number;
  paperSells: number;
  liveBuys: number;
  liveSells: number;
  startBalance: number | null;
  endBalance: number | null;
  netPnl: number | null;
  fallbackEvents: number;
  fallbackRecoveries: number;
  momentumEvents: number;
  monteCarloEvents: number;
  exitPendingEvents: number;
  exitFailedEvents: number;
  exitSkippedExistingLiveOrder: number;
  positionResolvedEvents: number;
  positionUnresolvedEvents: number;
  rejectionBreakdown: Record<string, number>;
  warnings: string[];
  failures: string[];
  evaluatorVerdict: EvaluatorVerdict;
  trades: TradeRecord[];
};

export type ScoreboardRow = {
  strategyVersionId: string;
  botBuildVersionId: string;
  gitCommit: string;
  mode: "PAPER" | "LIVE" | "UNKNOWN";
  sessions: number;
  completedSessions: number;
  incompleteSessions: number;
  totalTrades: number;
  paperBuys: number;
  paperSells: number;
  liveBuys: number;
  liveSells: number;
  netPnl: number;
  wins: number;
  losses: number;
  flats: number;
  winRate: number | null;
  profitFactor: number | null;
  fallbackEvents: number;
  fallbackRecoveries: number;
  evaluatorVerdict: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
};
