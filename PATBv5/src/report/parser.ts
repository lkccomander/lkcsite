// src/report/parser.ts
import { createReadStream, openSync, closeSync, readSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { SessionReport, TradeRecord, FeedWindow, RejectionBucket, Anomaly, GateCheck, RejectionPayloadRecord } from './types';
import { classifyTransportError } from '../feed/transportError';

const CAPTURED_REJECTION_REASONS = new Set([
  'entry_price_window',
  'up_bias_filter',
  'entry_latency_gate',
]);

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function incrementCounter(counter: Record<string, number>, key: unknown): void {
  const normalized = key === undefined || key === null || String(key).length === 0
    ? 'unknown'
    : String(key);
  counter[normalized] = (counter[normalized] || 0) + 1;
}

function updateFeedWindowStatus(window: FeedWindow): void {
  window.status = window.fallbacks >= 20 ? 'SPIKE' : window.fallbacks >= 7 ? 'ELEVATED' : 'OK';
}

function getOrCreateFeedWindow(report: SessionReport, slugValue: unknown, timestampValue: unknown): FeedWindow {
  const slug = typeof slugValue === 'string' && slugValue.length > 0 ? slugValue : 'unknown';
  const timestamp = typeof timestampValue === 'string' && timestampValue.length > 0
    ? timestampValue
    : new Date(0).toISOString();
  let window = report.feedWindows.find((candidate) => candidate.slug === slug);
  if (!window) {
    window = {
      slug,
      status: 'OK',
      fallbacks: 0,
      rttAvg: 0,
      rttMax: 0,
      rttP95: 0,
      start: timestamp,
      end: timestamp,
      reconnectEvents: 0,
      scheduledReconnects: 0,
      forcedReconnects: 0,
      disconnects: 0,
      fallbackReasons: {},
      disconnectCodes: {},
      websocketErrorCategories: {},
    };
    report.feedWindows.push(window);
  } else {
    if (timestamp < window.start) window.start = timestamp;
    if (timestamp > window.end) window.end = timestamp;
  }
  return window;
}

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

function processLine(line: string, report: SessionReport): void {
  try {
    const event = JSON.parse(line);
    processEvent(event, report);
  } catch {
    // Skip malformed JSON lines.
  }
}

async function processFullFile(filePath: string, report: SessionReport): Promise<void> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.length === 0) continue;
    report.totalEvents++;
    processLine(line, report);
  }
}

// Parse telemetry events into a SessionReport
export async function parseTelemetry(files: string[], tailLines?: number): Promise<SessionReport> {
  if (tailLines !== undefined && (!Number.isInteger(tailLines) || tailLines <= 0)) {
    throw new Error(`tailLines must be a positive integer; received ${tailLines}`);
  }

  // Initialize report structure
  const report: SessionReport = {
    sessionIds: [],
    files: files,
    totalEvents: 0,
    analysisScope: tailLines === undefined ? 'full' : 'tail',
    tailLines: tailLines ?? null,
    strategy: '',
    mode: '',
    startBalance: 0,
    buys: 0,
    sells: 0,
    rejectionCount: 0,
    fallbackCount: 0,
    reconnectScheduledCount: 0,
    forcedReconnectCount: 0,
    disconnectCount: 0,
    fallbackReasons: {},
    disconnectCodes: {},
    websocketErrorCategories: {},
    momEventCount: 0,
    mcEventCount: 0,
    shadowEventCount: 0,
    shadowResolvedEventCount: 0,
    shadowUnresolvedEventCount: 0,
    shadowWinCount: 0,
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
    momUsableEventCount: 0,
    momMissingFieldEventCount: 0,
    trades: [],
    rejectionBreakdown: [],
    rejectionPayloads: {},
    entryLatencyGateBreakdown: {
      age: 0,
      latency: 0,
      rtt: 0,
      unknown: 0,
    },
    acceptedTradeMcConvAvg: 0,
    acceptedTradeMcConvMin: 0,
    acceptedTradeMcConvMax: 0,
    anomalies: [],
    gateChecks: [],
    rttSamples: [],
    seenShadowSignalIds: new Set<string>(),
  };
  Object.defineProperty(report, 'rttSamples', { enumerable: false, writable: true, value: [] });
  Object.defineProperty(report, 'seenShadowSignalIds', { enumerable: false, writable: true, value: new Set<string>() });

  // Process each file
  for (const file of files) {
    try {
      if (tailLines === undefined) {
        await processFullFile(file, report);
      } else {
        const lines = await readLastLines(file, tailLines);
        report.totalEvents += lines.length;

        for (const line of lines) {
          processLine(line, report);
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
function processEvent(event: any, report: SessionReport): void {
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
      if (reason === 'entry_latency_gate') {
        const feedAgeMs = toFiniteNumber(payload.feedAgeMs);
        const maxEntryFeedAgeMs = toFiniteNumber(payload.maxEntryFeedAgeMs);
        const feedLatencyMs = toFiniteNumber(payload.feedLatencyMs);
        const maxEntryFeedLatencyMs = toFiniteNumber(payload.maxEntryFeedLatencyMs);
        const feedRttMs = toFiniteNumber(payload.feedRttMs);
        const maxEntryFeedRttMs = toFiniteNumber(payload.maxEntryFeedRttMs);
        const ageExceeded = feedAgeMs !== null && maxEntryFeedAgeMs !== null && feedAgeMs > maxEntryFeedAgeMs;
        const latencyExceeded = feedLatencyMs !== null && maxEntryFeedLatencyMs !== null && feedLatencyMs > maxEntryFeedLatencyMs;
        const rttExceeded = feedRttMs !== null && maxEntryFeedRttMs !== null && feedRttMs > maxEntryFeedRttMs;

        if (ageExceeded) report.entryLatencyGateBreakdown.age++;
        if (latencyExceeded) report.entryLatencyGateBreakdown.latency++;
        if (rttExceeded) report.entryLatencyGateBreakdown.rtt++;
        if (!ageExceeded && !latencyExceeded && !rttExceeded) {
          report.entryLatencyGateBreakdown.unknown++;
        }
      }
      break;
      
    case 'trade.shadow_pnl':
      if (typeof payload.signalId === 'string' && payload.signalId.length > 0) {
        if (report.seenShadowSignalIds.has(payload.signalId)) {
          break;
        }
        report.seenShadowSignalIds.add(payload.signalId);
      }
      report.shadowEventCount++;
      if (typeof payload.hypotheticalPnlUsd === 'number' && Number.isFinite(payload.hypotheticalPnlUsd)) {
        report.shadowResolvedEventCount++;
        report.shadowTotalHypothetical += payload.hypotheticalPnlUsd;
        if (payload.hypotheticalPnlUsd > 0) {
          report.shadowWinCount++;
        }
      } else {
        report.shadowUnresolvedEventCount++;
      }
      break;
      
    case 'signal.momentum':
      report.momEventCount++;
      const rawDirection = payload.direction ?? payload.momentumDirection;
      const rawScore = payload.score ?? payload.momentumScore;
      const rawConfidence = payload.confidence ?? payload.momentumConfidence;
      const hasDirection = typeof rawDirection === 'string' && rawDirection.trim().length > 0;
      const hasScore = typeof rawScore === 'number' && Number.isFinite(rawScore);
      const hasConfidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence);

      if (hasDirection && hasScore && hasConfidence) {
        const direction = rawDirection.trim();
        const score = rawScore;
        const confidence = rawConfidence;
        report.momUsableEventCount++;
        report.momDirections[direction] = (report.momDirections[direction] || 0) + 1;

        if (report.momUsableEventCount === 1) {
          report.momScoreMin = score;
          report.momScoreMax = score;
        } else {
          report.momScoreMin = Math.min(report.momScoreMin, score);
          report.momScoreMax = Math.max(report.momScoreMax, score);
        }
        report.momConfAvg = (
          (report.momConfAvg * (report.momUsableEventCount - 1)) + confidence
        ) / report.momUsableEventCount;
      } else {
        report.momMissingFieldEventCount++;
      }
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
      const feedWindow = getOrCreateFeedWindow(report, payload.slug, event.timestamp);
      if (feedWindow.fallbacks === 0) {
        feedWindow.fallbacks = toFiniteNumber(payload.fallbackCount) ?? 0;
      }
      feedWindow.rttAvg = toFiniteNumber(payload.averageRttMs) ?? toFiniteNumber(payload.rttAvg) ?? feedWindow.rttAvg;
      feedWindow.rttMax = toFiniteNumber(payload.maxRttMs) ?? toFiniteNumber(payload.rttMax) ?? feedWindow.rttMax;
      feedWindow.rttP95 = toFiniteNumber(payload.p95RttMs) ?? toFiniteNumber(payload.rttP95) ?? feedWindow.rttP95;
      if (feedWindow.scheduledReconnects === 0) {
        feedWindow.scheduledReconnects = toFiniteNumber(payload.reconnectEvents) ?? 0;
        feedWindow.reconnectEvents = feedWindow.scheduledReconnects;
      }
      if (Object.keys(feedWindow.fallbackReasons).length === 0 && payload.fallbackReasons && typeof payload.fallbackReasons === 'object') {
        feedWindow.fallbackReasons = { ...payload.fallbackReasons };
      }
      updateFeedWindowStatus(feedWindow);
      break;
      
    case 'feed.rtt':
      // Track RTT metrics
      const rtt = toFiniteNumber(payload.rttMs) ?? 0;
      if (rtt > report.rttMax) report.rttMax = rtt;
      if (rtt > 0) {
        report.rttSamples.push(rtt);
      }
      break;
      
    case 'feed.fallback':
      report.fallbackCount += (payload.count || 1);
      incrementCounter(report.fallbackReasons, payload.reason);
      const fallbackWindow = getOrCreateFeedWindow(report, payload.slug, event.timestamp);
      fallbackWindow.fallbacks += (payload.count || 1);
      incrementCounter(fallbackWindow.fallbackReasons, payload.reason);
      updateFeedWindowStatus(fallbackWindow);
      break;

    case 'feed.reconnect_scheduled':
      report.reconnectScheduledCount++;
      const reconnectWindow = getOrCreateFeedWindow(report, payload.slug, event.timestamp);
      reconnectWindow.scheduledReconnects++;
      reconnectWindow.reconnectEvents = reconnectWindow.scheduledReconnects;
      break;

    case 'feed.reconnect_forced':
      report.forcedReconnectCount++;
      getOrCreateFeedWindow(report, payload.slug, event.timestamp).forcedReconnects++;
      break;

    case 'feed.disconnected':
      report.disconnectCount++;
      incrementCounter(report.disconnectCodes, payload.code);
      const disconnectWindow = getOrCreateFeedWindow(report, payload.slug, event.timestamp);
      disconnectWindow.disconnects++;
      incrementCounter(disconnectWindow.disconnectCodes, payload.code);
      break;

    case 'feed.error':
      if (payload.source === 'websocket') {
        const category = payload.category || classifyTransportError({
          message: payload.error,
          code: payload.errorCode,
          cause: { code: payload.causeCode },
        }).category;
        incrementCounter(report.websocketErrorCategories, category);
        incrementCounter(
          getOrCreateFeedWindow(report, payload.slug, event.timestamp).websocketErrorCategories,
          category,
        );
      }
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
  report.feedWindows.sort((left, right) => left.start.localeCompare(right.start));
  if (report.fallbackCount === 0 && report.feedWindows.length > 0) {
    report.fallbackCount = report.feedWindows.reduce((sum, window) => sum + window.fallbacks, 0);
    for (const window of report.feedWindows) {
      for (const [reason, count] of Object.entries(window.fallbackReasons)) {
        report.fallbackReasons[reason] = (report.fallbackReasons[reason] || 0) + count;
      }
    }
  }
  // Calculate net PnL and total fees
  for (const trade of report.trades) {
    report.grossPnl += trade.grossPnl;
    report.totalFees += trade.feeUsd;
  }
  report.netPnl = report.grossPnl - report.totalFees;
  
  if (report.rttSamples.length > 0) {
    const sorted = [...report.rttSamples].sort((left, right) => left - right);
    const totalRtt = sorted.reduce((sum, sample) => sum + sample, 0);
    report.rttAvg = totalRtt / sorted.length;
    report.rttMax = sorted[sorted.length - 1];
    const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
    report.rttP95 = sorted[p95Index];
  } else if (report.feedWindows.length > 0) {
    const totalRtt = report.feedWindows.reduce((sum, window) => sum + window.rttAvg, 0);
    report.rttAvg = totalRtt / report.feedWindows.length;
    report.rttMax = Math.max(...report.feedWindows.map((window) => window.rttMax));
    report.rttP95 = Math.max(...report.feedWindows.map((window) => window.rttP95));
  }

  if (report.shadowResolvedEventCount > 0) {
    report.shadowWinRate = Math.round(
      (report.shadowWinCount / report.shadowResolvedEventCount) * 1000,
    ) / 10;
  }

  const acceptedTradeConvergences = report.trades
    .map((trade) => trade.mcConvergence)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (acceptedTradeConvergences.length > 0) {
    report.acceptedTradeMcConvAvg = acceptedTradeConvergences.reduce((sum, value) => sum + value, 0) / acceptedTradeConvergences.length;
    report.acceptedTradeMcConvMin = Math.min(...acceptedTradeConvergences);
    report.acceptedTradeMcConvMax = Math.max(...acceptedTradeConvergences);
  }
}
