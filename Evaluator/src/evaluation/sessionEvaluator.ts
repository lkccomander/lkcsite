import { basename, resolve } from "path";
import { readdir } from "fs/promises";
import { readJsonLines, writeJsonFile, ensureDir } from "../lib/fs";
import { DIAGNOSTICS_DIR, SESSION_EVALUATIONS_DIR, TELEMETRY_SESSIONS_DIR } from "../paths";
import { SessionEvaluation, TelemetryEvent, TradeRecord } from "../types";
import { normalizeVersionContext } from "./versionContext";

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getTradePrice(payload: Record<string, unknown>): number | null {
  return (
    toNumber(payload.price)
    ?? toNumber(payload.entryPrice)
    ?? toNumber(payload.exitPrice)
    ?? toNumber(payload.avgPrice)
  );
}

function getTradeSide(type: string): TradeRecord["side"] | null {
  switch (type) {
    case "paper_trade.buy":
      return "PAPER_BUY";
    case "paper_trade.sell":
      return "PAPER_SELL";
    case "live_trade.buy":
      return "LIVE_BUY";
    case "live_trade.sell":
      return "LIVE_SELL";
    default:
      return null;
  }
}

export async function resolveSessionFile(input: {
  sessionId?: string | null;
  telemetryFile?: string | null;
}): Promise<string> {
  if (input.telemetryFile) {
    return resolve(input.telemetryFile);
  }

  if (!input.sessionId) {
    throw new Error("Missing --session-id or --telemetry-file");
  }

  const entries = await readdir(TELEMETRY_SESSIONS_DIR, { withFileTypes: true });
  const match = entries.find(
    (entry) => entry.isFile() && entry.name.endsWith(`__${input.sessionId}.jsonl`)
  );

  if (!match) {
    throw new Error(`Session file not found for sessionId=${input.sessionId}`);
  }

  return resolve(TELEMETRY_SESSIONS_DIR, match.name);
}

export async function evaluateSessionFile(sessionFile: string): Promise<SessionEvaluation> {
  const lines = await readJsonLines(sessionFile);
  const events: TelemetryEvent[] = lines
    .map((line) => {
      try {
        return JSON.parse(line) as TelemetryEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is TelemetryEvent => Boolean(event));

  if (events.length === 0) {
    throw new Error(`No readable telemetry events found in ${sessionFile}`);
  }

  const firstEvent = events[0];
  const startup = events.find((event) => event.type === "bot.startup");
  const startupConfig = events.find((event) => event.type === "bot.startup_config");
  const shutdown = [...events].reverse().find((event) => event.type === "bot.shutdown");
  const botError = [...events].reverse().find((event) => event.type === "bot.error");
  const versionContext = normalizeVersionContext(
    events.find((event) => event.versionContext)?.versionContext
  );

  const trades: TradeRecord[] = [];
  let paperBuys = 0;
  let paperSells = 0;
  let liveBuys = 0;
  let liveSells = 0;
  let fallbackEvents = 0;
  let fallbackRecoveries = 0;
  let momentumEvents = 0;
  let monteCarloEvents = 0;
  let exitPendingEvents = 0;
  let exitFailedEvents = 0;
  let exitSkippedExistingLiveOrder = 0;
  let positionResolvedEvents = 0;
  let positionUnresolvedEvents = 0;
  let rejectionBreakdown: Record<string, number> = {};
  let startBalance: number | null = null;
  let endBalance: number | null = null;
  let netPnl: number | null = null;
  let openTradeCount = 0;

  for (const event of events) {
    const payload = event.payload ?? {};
    const tradeSide = getTradeSide(event.type);

    if (event.type === "paper_balance.checkpoint" && startBalance == null) {
      startBalance = toNumber(payload.balance) ?? toNumber(payload.paperBalance);
    }

    if (event.type === "bot.startup") {
      startBalance = startBalance ?? toNumber(payload.paperStartingUsd);
    }

    if (tradeSide) {
      const trade: TradeRecord = {
        side: tradeSide,
        tokenId: toStringValue(payload.tokenId),
        marketSlug: toStringValue(payload.slug) ?? toStringValue(payload.marketSlug),
        timestamp: event.timestamp ?? null,
        price: getTradePrice(payload),
        shares: toNumber(payload.shares),
        pnl: toNumber(payload.pnlUsd) ?? toNumber(payload.realizedTradePnl),
        reason: toStringValue(payload.reason),
      };
      trades.push(trade);
      if (tradeSide === "PAPER_BUY") paperBuys += 1;
      if (tradeSide === "PAPER_SELL") paperSells += 1;
      if (tradeSide === "LIVE_BUY") liveBuys += 1;
      if (tradeSide === "LIVE_SELL") liveSells += 1;
    }

    switch (event.type) {
      case "feed.fallback":
        fallbackEvents += 1;
        break;
      case "feed.fallback_recovered":
        fallbackRecoveries += 1;
        break;
      case "signal.momentum":
        momentumEvents += 1;
        break;
      case "signal.montecarlo":
        monteCarloEvents += 1;
        break;
      case "trade.exit_pending":
        exitPendingEvents += 1;
        break;
      case "trade.exit_failed":
        exitFailedEvents += 1;
        break;
      case "trade.exit_skipped_existing_live_order":
        exitSkippedExistingLiveOrder += 1;
        break;
      case "trade.position_resolved":
        positionResolvedEvents += 1;
        break;
      case "trade.position_unresolved":
        positionUnresolvedEvents += 1;
        break;
      case "trade.signal_rejected": {
        const reason = toStringValue(payload.reason) ?? "unknown";
        rejectionBreakdown[reason] = (rejectionBreakdown[reason] ?? 0) + 1;
        break;
      }
      case "bot.shutdown":
        endBalance = toNumber(payload.endBalance)
          ?? toNumber(payload.endTotalValue)
          ?? endBalance;
        netPnl = toNumber(payload.netPnl) ?? netPnl;
        break;
    }
  }

  const status: SessionEvaluation["status"] = shutdown ? "COMPLETED" : "INCOMPLETE";
  const startedAt = firstEvent.sessionStartedAt ?? firstEvent.timestamp ?? null;
  const endedAt = shutdown?.timestamp ?? botError?.timestamp ?? events[events.length - 1]?.timestamp ?? null;
  const durationSeconds = startedAt && endedAt
    ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
    : null;

  if (endBalance == null) {
    const lastSell = [...trades].reverse().find((trade) => trade.side === "PAPER_SELL" || trade.side === "LIVE_SELL");
    if (lastSell?.pnl != null && startBalance != null) {
      endBalance = startBalance + lastSell.pnl;
    }
  }

  if (netPnl == null && startBalance != null && endBalance != null) {
    netPnl = endBalance - startBalance;
  }

  openTradeCount = Math.max(0, paperBuys + liveBuys - paperSells - liveSells);

  const warnings: string[] = [];
  const failures: string[] = [];

  if (versionContext.gitDirty) {
    warnings.push("Session ran with gitDirty=true; reproducibility is degraded.");
  }
  if (versionContext.gitCommit === "unknown") {
    warnings.push("Git commit is unknown.");
  }
  if (status === "INCOMPLETE") {
    warnings.push("Session does not contain bot.shutdown and was reconstructed as incomplete_session.");
  }
  if (fallbackEvents > 20) {
    warnings.push(`High fallback count detected: ${fallbackEvents}.`);
  }
  if (exitFailedEvents > 0) {
    failures.push(`Exit failures detected: ${exitFailedEvents}.`);
  }
  if (positionUnresolvedEvents > 0) {
    failures.push(`Unresolved positions detected: ${positionUnresolvedEvents}.`);
  }
  if (openTradeCount > 0 && status === "COMPLETED") {
    failures.push(`Completed session still appears to have ${openTradeCount} open trade(s).`);
  }

  let evaluatorVerdict: SessionEvaluation["evaluatorVerdict"] = "PASS";
  if (status === "INCOMPLETE") {
    evaluatorVerdict = "INCOMPLETE";
  } else if (failures.length > 0) {
    evaluatorVerdict = "FAIL";
  } else if (warnings.length > 0) {
    evaluatorVerdict = "WARNING";
  } else if (!shutdown && !botError) {
    evaluatorVerdict = "UNKNOWN";
  }

  return {
    sessionId: firstEvent.sessionId ?? basename(sessionFile, ".jsonl"),
    sourceFile: sessionFile,
    status,
    botId: firstEvent.botId ?? "unknown_bot",
    mode: (toStringValue(startup?.payload?.mode) as SessionEvaluation["mode"]) || "UNKNOWN",
    strategyName: toStringValue(startup?.payload?.strategy)
      ?? toStringValue(startupConfig?.payload?.strategy)
      ?? "unknown_strategy",
    strategyVersionId: versionContext.strategyVersionId,
    strategyConfigHash: versionContext.strategyConfigHash,
    botBuildVersionId: versionContext.botBuildVersionId,
    repoId: versionContext.repoId,
    gitCommit: versionContext.gitCommit,
    gitBranch: versionContext.gitBranch,
    gitDirty: versionContext.gitDirty,
    startedAt,
    endedAt,
    durationSeconds,
    totalEvents: events.length,
    totalTrades: trades.length,
    paperBuys,
    paperSells,
    liveBuys,
    liveSells,
    startBalance,
    endBalance,
    netPnl,
    fallbackEvents,
    fallbackRecoveries,
    momentumEvents,
    monteCarloEvents,
    exitPendingEvents,
    exitFailedEvents,
    exitSkippedExistingLiveOrder,
    positionResolvedEvents,
    positionUnresolvedEvents,
    rejectionBreakdown,
    warnings,
    failures,
    evaluatorVerdict,
    trades,
  };
}

export async function persistSessionEvaluation(evaluation: SessionEvaluation): Promise<string> {
  const baseDir = evaluation.status === "COMPLETED" ? SESSION_EVALUATIONS_DIR : DIAGNOSTICS_DIR;
  await ensureDir(baseDir);
  const outputPath = resolve(baseDir, `${evaluation.sessionId}.json`);
  await writeJsonFile(outputPath, evaluation);
  return outputPath;
}
