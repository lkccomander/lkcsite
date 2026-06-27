// src/report/parser.ts
import { openSync, closeSync, readSync, statSync } from 'fs';
import { SessionReport, TradeRecord, FeedWindow, RejectionBucket, Anomaly, GateCheck, RejectionPayloadRecord } from './types';

const CAPTURED_REJECTION_REASONS = new Set([
  'entry_price_window',
  'up_bias_filter',
]);

// Utility function to read last N lines from a file
async function readLastLines(filePath: string, n: number): Promise<string[]> {
  const chunkSize = 64 * 1024;
  const fileSize = statSync(filePath).size;
  const fd = openSync(filePath, 'r');

  try {
    let position = fileSize;
    let buffer = '';
    let lines: string[] = [];

    while (position > 0 && lines.length <= n + 1) {
      const bytesToRead = Math.min(chunkSize, position);
      position -= bytesToRead;

      const chunkBuffer = Buffer.alloc(bytesToRead);
      readSync(fd, chunkBuffer, 0, bytesToRead, position);
      buffer = chunkBuffer.toString('utf8') + buffer;
      lines = buffer.split(/\r?\n/);
    }

    return lines.filter((line) => line.length > 0).slice(-n);
  } finally {
    closeSync(fd);
  }
}

// Parse telemetry events into a SessionReport
export async function parseTelemetry(files: string[], tailLines: number = 50000): Promise<SessionReport> {
  // Initialize report structure
  const report: SessionReport = {
    sessionIds: [],
    files: files,
    totalEvents: 0,
    strategy: '',
    mode: '',
    startBalance: 0,
    buys: 0,
    sells: 0,
    rejectionCount: 0,
    fallbackCount: 0,
    momEventCount: 0,
    mcEventCount: 0,
    shadowEventCount: 0,
    netPnl: 0,
    grossPnl: 0,
    totalFees: 0,
    shadowWinRate: 0,
    shadowTotalHypothetical: 0,
    rttAvg: 0,
    rttMax: 0,
    rttP95: 0,
    feedWindows: [],
    mcConvAvg: 0,
    mcConvMin: 0,
    mcConvMax: 0,
    mcBelow062: 0,
    mcBelow068: 0,
    momDirections: {},
    momScoreMin: 0,
    momScoreMax: 0,
    momConfAvg: 0,
    trades: [],
    rejectionBreakdown: [],
    rejectionPayloads: {},
    anomalies: [],
    gateChecks: []
  };

  // Process each file
  for (const file of files) {
    try {
      const lines = await readLastLines(file, tailLines);
      report.totalEvents += lines.length;
      
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          await processEvent(event, report);
        } catch (e) {
          // Skip malformed JSON lines
          continue;
        }
      }
    } catch (error) {
      console.error(`Error reading file ${file}:`, error);
    }
  }

  // Calculate derived metrics
  calculateDerivedMetrics(report);
  
  return report;
}

// Process individual telemetry events
async function processEvent(event: any, report: SessionReport): Promise<void> {
  const eventType = event.type || event.event;
  const payload = event.payload || {};

  if (event.sessionId && !report.sessionIds.includes(event.sessionId)) {
    report.sessionIds.push(event.sessionId);
  }
  if (!report.strategy && payload.strategy) {
    report.strategy = payload.strategy;
  }
  if (!report.mode && payload.mode) {
    report.mode = payload.mode;
  }
  
  switch (eventType) {
    case 'bot.startup':
      report.strategy = payload.strategy || report.strategy;
      report.mode = payload.mode || report.mode;
      if (payload.paperStartingUsd !== undefined) {
        report.startBalance = payload.paperStartingUsd;
      }
      break;
      
    case 'paper_trade.buy':
      report.buys++;
      const trade: TradeRecord = {
        tokenId: payload.tokenId || '',
        side: payload.side || payload.tradeSide || '',
        entryPrice: payload.entryPrice ?? payload.price ?? 0,
        exitPrice: null,
        holdSeconds: payload.holdSeconds || 0,
        grossPnl: 0, // Will be updated when sell event is found
        sellReason: '',
        mcConvergence: payload.mcConvergence || 0,
        mcSimulatedDirection: payload.mcSimulatedDirection || payload.mcSimDirection || '',
        momentumDirection: payload.momentumDirection || '',
        momentumScore: payload.momentumScore || 0,
        momentumConfidence: payload.momentumConfidence || 0,
        momentumDelta1m: payload.momentumDelta1m || payload.btcDelta1m || 0,
        feedLatencyMs: payload.feedLatencyMs || 0,
        feedRttMs: payload.feedRttMs || 0,
        makerMode: payload.makerMode || false,
        feeUsd: payload.feeUsd || 0,
        btcAtEntry: payload.externalBtcPriceAtEntry ?? payload.externalPriceUsd ?? null,
        btcAtExit: null,
        missingFields: getMissingTradeFields(payload),
        shares: payload.shares || 0,
        cashBefore: payload.cashBefore || null,
        cashAfter: payload.cashAfter || null,
        rebateUsd: payload.rebateUsd || 0,
        decisionSource: payload.decisionSource || '',
        feedAgeMs: payload.feedAgeMs || 0,
        feedSnapshotSource: payload.feedSnapshotSource || '',
        positionState: payload.positionState || '',
        holdingStatus: payload.holdingStatus || '',
        exitPriceActual: null,
        sharesSold: null,
        avgPrice: null
      };
      report.trades.push(trade);
      break;
      
    case 'paper_trade.sell':
      report.sells++;
      // Find matching buy trade and update with sell data
      const matchingTrade = report.trades.find(t => t.tokenId === payload.tokenId);
      if (matchingTrade) {
        matchingTrade.exitPrice = payload.exitPrice ?? matchingTrade.entryPrice;
        matchingTrade.sellReason = payload.reason || '';
        matchingTrade.holdSeconds = payload.holdSeconds || matchingTrade.holdSeconds;
        matchingTrade.grossPnl = payload.pnlUsd || 0;
        matchingTrade.btcAtExit = payload.externalPriceUsd || matchingTrade.btcAtEntry;
        matchingTrade.exitPriceActual = payload.exitPrice || null;
        matchingTrade.sharesSold = payload.shares || null;
        matchingTrade.avgPrice = payload.avgPrice || null;
      }
      break;
      
    case 'trade.signal_rejected':
      report.rejectionCount++;
      const reason = payload.reason || 'unknown';
      let bucket = report.rejectionBreakdown.find(b => b.reason === reason);
      if (!bucket) {
        bucket = {
          reason: reason,
          count: 0,
          isNewSignalReason: isNewSignalReason(reason)
        };
        report.rejectionBreakdown.push(bucket);
      }
      bucket.count++;
      if (CAPTURED_REJECTION_REASONS.has(reason)) {
        const records = report.rejectionPayloads[reason] ?? [];
        const capturedPayload: RejectionPayloadRecord = {
          reason,
          payload: { ...payload },
        };
        records.push(capturedPayload);
        report.rejectionPayloads[reason] = records;
      }
      break;
      
    case 'trade.shadow_pnl':
      report.shadowEventCount++;
      // Track shadow PnL for win rate calculation
      if (payload.hypotheticalPnlUsd !== undefined) {
        report.shadowTotalHypothetical += payload.hypotheticalPnlUsd;
        if (payload.hypotheticalPnlUsd > 0) {
          // This would need to be tracked separately for win rate calculation
        }
      }
      break;
      
    case 'signal.momentum':
      report.momEventCount++;
      const direction = payload.momentumDirection || 'NEUTRAL';
      report.momDirections[direction] = (report.momDirections[direction] || 0) + 1;
      // Track min/max scores and confidence
      const score = payload.momentumScore || 0;
      if (score < report.momScoreMin || report.momScoreMin === 0) report.momScoreMin = score;
      if (score > report.momScoreMax) report.momScoreMax = score;
      report.momConfAvg = ((report.momConfAvg * (report.momEventCount - 1)) + (payload.momentumConfidence || 0)) / report.momEventCount;
      break;
      
    case 'signal.montecarlo':
      report.mcEventCount++;
      const convergence = payload.convergence ?? payload.mcConvergence ?? 0;
      if (convergence < report.mcConvMin || report.mcConvMin === 0) report.mcConvMin = convergence;
      if (convergence > report.mcConvMax) report.mcConvMax = convergence;
      report.mcConvAvg = ((report.mcConvAvg * (report.mcEventCount - 1)) + convergence) / report.mcEventCount;
      if (convergence < 0.62) report.mcBelow062++;
      if (convergence < 0.68) report.mcBelow068++;
      break;
      
    case 'feed.summary':
      // Process feed window data
      const feedWindow: FeedWindow = {
        slug: payload.slug || '',
        status: 'OK', // Will be updated based on fallbacks
        fallbacks: payload.fallbackCount || 0,
        rttAvg: payload.rttAvg || 0,
        rttMax: payload.rttMax || 0,
        rttP95: payload.rttP95 || 0,
        start: event.timestamp || new Date().toISOString(),
        end: event.timestamp || new Date().toISOString(),
        reconnectEvents: payload.reconnectEvents || 0,
        fallbackReasons: payload.fallbackReasons || {}
      };
      
      // Determine status based on fallbacks
      if (feedWindow.fallbacks >= 20) {
        feedWindow.status = 'SPIKE';
      } else if (feedWindow.fallbacks >= 7) {
        feedWindow.status = 'ELEVATED';
      } else {
        feedWindow.status = 'OK';
      }
      
      report.feedWindows.push(feedWindow);
      break;
      
    case 'feed.rtt':
      // Track RTT metrics
      const rtt = payload.rttMs || 0;
      if (rtt > report.rttMax) report.rttMax = rtt;
      // RTT average and P95 would need more complex calculation
      break;
      
    case 'feed.fallback':
      report.fallbackCount += (payload.count || 1);
      break;
  }
}

function getMissingTradeFields(payload: Record<string, unknown>): string[] {
  const expectedFields = [
    'tokenId',
    'side',
    'entryPrice',
    'mcConvergence',
    'mcSimulatedDirection',
    'momentumDirection',
    'momentumScore',
    'momentumConfidence',
    'feedLatencyMs',
    'feedRttMs',
    'makerMode',
    'feeUsd',
    'externalPriceUsd'
  ];

  return expectedFields.filter((field) => payload[field] === null || payload[field] === undefined);
}

// Check if a rejection reason is considered "new"
function isNewSignalReason(reason: string): boolean {
  const newReasons = [
    'up_bias_filter',
    'mc_direction_mismatch',
    'low_convergence',
    'momentum_mismatch',
    'feed_age_too_high'
  ];
  return newReasons.includes(reason);
}

// Calculate derived metrics after processing all events
function calculateDerivedMetrics(report: SessionReport): void {
  // Calculate net PnL and total fees
  for (const trade of report.trades) {
    report.grossPnl += trade.grossPnl;
    report.totalFees += trade.feeUsd;
  }
  report.netPnl = report.grossPnl - report.totalFees;
  
  // Calculate RTT average (simplified)
  if (report.feedWindows.length > 0) {
    const totalRtt = report.feedWindows.reduce((sum, window) => sum + window.rttAvg, 0);
    report.rttAvg = totalRtt / report.feedWindows.length;
  }
  
  // Calculate shadow win rate (simplified)
  if (report.shadowEventCount > 0) {
    report.shadowWinRate = (report.shadowTotalHypothetical > 0) ? 
      Math.round((report.shadowTotalHypothetical / report.shadowEventCount) * 100) : 0;
  }
}
