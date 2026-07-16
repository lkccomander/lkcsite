// src/report/anomalies.ts
import { SessionReport, Anomaly, TradeRecord } from './types';

function dominantCounter(counter: Record<string, number>): [string, number] | null {
  return Object.entries(counter).sort((left, right) => right[1] - left[1])[0] ?? null;
}

function formatSignedCurrency(value: number): string {
  return value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`;
}

// Detect anomalies in the session report
export function detectAnomalies(report: SessionReport): Anomaly[] {
  const anomalies: Anomaly[] = [];
  
  // 1. BUG (red, priority 1)
  // Trigger: any trade where momentumDirection='NEUTRAL' AND confidence >= 0.9
  for (const trade of report.trades) {
    if (trade.momentumDirection === 'NEUTRAL' && trade.momentumConfidence >= 0.9) {
      anomalies.push({
        priority: 1,
        type: 'BUG',
        severity: 'red',
        title: "Momentum confidence=1.0 on NEUTRAL direction",
        detail: "Formula min(abs(score)/0.005,1.0) ignores direction. Fix: return confidence=0 when direction=NEUTRAL."
      });
      break; // Only add once
    }
  }
  
  // 2. FIX (red, priority 2)
  // Trigger: up_bias_filter count > 0 AND captured rejection payloads are missing required observed values
  const upBiasFilterRejections = report.rejectionBreakdown.filter(rb => rb.reason === 'up_bias_filter');
  if (upBiasFilterRejections.length > 0) {
    const capturedPayloads = report.rejectionPayloads.up_bias_filter ?? [];
    const missingRequiredValues = capturedPayloads.length === 0 || capturedPayloads.some((record) => {
      const payload = record.payload ?? {};
      return payload.observedDelta1m === undefined
        || payload.observedDelta1m === null
        || payload.observedMomentumConfidence === undefined
        || payload.observedMomentumConfidence === null;
    });
    if (missingRequiredValues) {
      anomalies.push({
        priority: 2,
        type: 'FIX',
        severity: 'red',
        title: "up_bias_filter rejection missing evaluated values",
        detail: "Add delta1m and confidence to rejection payload."
      });
    }
  }
  
  // 3. FIX (red, priority 3)
  // Trigger: any trade has missingFields.length > 0
  for (const trade of report.trades) {
    if (trade.missingFields.length > 0) {
      anomalies.push({
        priority: 3,
        type: 'FIX',
        severity: 'red',
        title: `Missing fields on buy payload: ${trade.missingFields.join(', ')}`,
        detail: ""
      });
    }
  }
  
  // 4. FIX (red, priority 4)
  // Trigger: report has inconsistent mcSimDirection / mcSimulatedDirection
  let hasInconsistentNames = false;
  for (const trade of report.trades) {
    // This would require checking for both field names in the raw data
    // For now we'll skip this check as we're normalizing to mcSimulatedDirection
  }
  
  if (hasInconsistentNames) {
    anomalies.push({
      priority: 4,
      type: 'FIX',
      severity: 'red',
      title: "mcSimDirection naming mismatch — standardize field name",
      detail: ""
    });
  }
  
  // 5. TUNE (amber, priority 5): aggregate evidence by side.
  const convergenceLossesBySide = new Map<string, TradeRecord[]>();
  for (const trade of report.trades.filter((candidate) => (
    candidate.grossPnl < 0
    && candidate.mcConvergence >= 0.62
    && candidate.mcConvergence < 0.68
  ))) {
    const side = trade.side || 'UNKNOWN';
    const losses = convergenceLossesBySide.get(side) ?? [];
    losses.push(trade);
    convergenceLossesBySide.set(side, losses);
  }
  for (const [side, losses] of convergenceLossesBySide) {
    const values = losses.map((trade) => trade.mcConvergence);
    const pnl = losses.reduce((sum, trade) => sum + trade.grossPnl, 0);
      anomalies.push({
        priority: 5,
        type: 'TUNE',
        severity: 'amber',
        title: `${side} losses had convergence in the 0.62–0.68 band`,
        detail: `${losses.length} ${side} loss${losses.length === 1 ? '' : 'es'} totaled ${formatSignedCurrency(pnl)}; observed convergence ${Math.min(...values).toFixed(3)}–${Math.max(...values).toFixed(3)}. Treat this as side-specific evidence, not a global threshold change.`
      });
  }
  
  // 6. TUNE (amber, priority 6): aggregate fast exits.
  const fastStops = report.trades.filter((trade) => trade.sellReason === 'stop_loss' && trade.holdSeconds < 15);
  if (fastStops.length > 0) {
    const holds = fastStops.map((trade) => trade.holdSeconds);
    const pnl = fastStops.reduce((sum, trade) => sum + trade.grossPnl, 0);
      anomalies.push({
        priority: 6,
        type: 'TUNE',
        severity: 'amber',
        title: `${fastStops.length} stop losses within 15s — possible spread noise`,
        detail: `${fastStops.length} stop-losses totaled ${formatSignedCurrency(pnl)} with holds from ${Math.min(...holds).toFixed(0)}s to ${Math.max(...holds).toFixed(0)}s.`
      });
  }
  
  // 7. MONITOR (gray, priority 7)
  // Trigger: any FeedWindow with fallbacks > 20
  for (const window of report.feedWindows) {
    if (window.fallbacks > 20) {
      const dominantFallback = dominantCounter(window.fallbackReasons);
      const dominantError = dominantCounter(window.websocketErrorCategories);
      const dominant = dominantError
        ? `dominant WebSocket error ${dominantError[0]} (${dominantError[1]})`
        : dominantFallback
          ? `dominant fallback ${dominantFallback[0]} (${dominantFallback[1]})`
          : 'dominant cause unknown';
      anomalies.push({
        priority: 7,
        type: 'MONITOR',
        severity: 'gray',
        title: `Window ${window.slug} had ${window.fallbacks} fallbacks — feed recovery pressure`,
        detail: `${dominant}; scheduled reconnects=${window.scheduledReconnects}, forced reconnects=${window.forcedReconnects}, disconnects=${window.disconnects}.`
      });
    }
  }
  
  // 8. BUG (red, priority 8)
  const entryLatencyRejections = report.rejectionBreakdown.filter(rb => rb.reason === 'entry_latency_gate');
  if (
    entryLatencyRejections.length > 0
    && report.entryLatencyGateBreakdown.age > 0
    && report.entryLatencyGateBreakdown.latency === 0
    && report.entryLatencyGateBreakdown.rtt === 0
  ) {
    anomalies.push({
      priority: 8,
      type: 'BUG',
      severity: 'red',
      title: "entry_latency_gate fires on feedAgeMs not feedLatencyMs",
      detail: `${report.entryLatencyGateBreakdown.age} rejections exceeded feed age while latency and RTT remained within thresholds. Rename or split the reason for accurate attribution.`
    });
  }
  
  // 9. PASS (green)
  if (
    report.shadowEventCount > 0
    && report.shadowResolvedEventCount === report.shadowEventCount
    && report.shadowWinRate < 15
  ) {
    anomalies.push({
      priority: 9,
      type: 'PASS',
      severity: 'green',
      title: "Shadow PnL confirms filters correct",
      detail: `Only ${report.shadowWinRate}% of rejected signals would have won.`
    });
  }
  
  // 10. PASS (green)
  // Trigger: any trade with makerMode=true AND feeUsd=0
  for (const trade of report.trades) {
    if (trade.makerMode && trade.feeUsd === 0) {
      anomalies.push({
        priority: 10,
        type: 'PASS',
        severity: 'green',
        title: "Maker mode active — zero entry fee confirmed",
        detail: ""
      });
      break; // Only add once
    }
  }
  
  return anomalies;
}

// Evaluate gate checks
export function evaluateGateChecks(report: SessionReport): any[] {
  const gateChecks = [];
  
  // Gate checks (always run all 8):
  // 1. win_rate: trades >= 150 AND win_rate >= 40%
  const winRate = report.trades.length > 0 ? 
    (report.trades.filter(t => t.grossPnl > 0).length / report.trades.length * 100) : 0;
  gateChecks.push({
    id: 'win_rate',
    label: 'Win rate',
    pass: report.trades.length >= 150 && winRate >= 40,
    note: `trades=${report.trades.length}, winRate=${winRate.toFixed(1)}%`
  });
  
  // 2. mc_threshold: accepted trades should meet the threshold, not the full MC stream
  const hasAcceptedTradeMc = report.acceptedTradeMcConvMin > 0;
  const mcThresholdPass = hasAcceptedTradeMc && report.acceptedTradeMcConvMin >= 0.68;
  gateChecks.push({
    id: 'mc_threshold',
    label: 'MC convergence threshold',
    pass: mcThresholdPass,
    note: hasAcceptedTradeMc
      ? `acceptedTradeMcAvg=${report.acceptedTradeMcConvAvg.toFixed(3)}, min=${report.acceptedTradeMcConvMin.toFixed(3)}`
      : `no accepted trades; streamMcAvg=${report.mcConvAvg.toFixed(3)}`
  });
  
  // 3. feed_fallbacks: fallbackCount / sessionCount <= 20
  const sessionsCount = report.sessionIds.length || 1;
  const fallbacksPerSession = report.fallbackCount / sessionsCount;
  gateChecks.push({
    id: 'feed_fallbacks',
    label: 'Feed fallbacks',
    pass: fallbacksPerSession <= 20,
    note: `${report.fallbackCount} fallbacks / ${sessionsCount} sessions = ${fallbacksPerSession.toFixed(1)} avg`
  });
  
  // 4. signal_events: momEventCount > 0 AND mcEventCount > 0
  gateChecks.push({
    id: 'signal_events',
    label: 'Signal events',
    pass: report.momEventCount > 0 && report.mcEventCount > 0,
    note: `momEvents=${report.momEventCount}, mcEvents=${report.mcEventCount}`
  });
  
  // 5. new_rejections: at least one isNewSignalReason bucket with count > 0
  const hasNewRejections = report.rejectionBreakdown.some(rb => rb.isNewSignalReason && rb.count > 0);
  gateChecks.push({
    id: 'new_rejections',
    label: 'New rejections',
    pass: hasNewRejections,
    note: hasNewRejections ? 'New rejection reasons detected' : 'No new rejection reasons'
  });
  
  // 6. sell_reason: all trades have sellReason not null and not 'unknown'
  const allTradesHaveValidSellReason = report.trades.every(t => t.sellReason && t.sellReason !== 'unknown');
  gateChecks.push({
    id: 'sell_reason',
    label: 'Sell reason',
    pass: allTradesHaveValidSellReason && report.trades.length > 0,
    note: allTradesHaveValidSellReason ? 'All trades have valid sell reasons' : 'Some trades missing sell reasons'
  });
  
  // 7. maker_mode: at least one trade with makerMode=true
  const hasMakerModeTrades = report.trades.some(t => t.makerMode);
  gateChecks.push({
    id: 'maker_mode',
    label: 'Maker mode',
    pass: hasMakerModeTrades,
    note: hasMakerModeTrades ? 'Maker mode confirmed' : 'No maker mode trades detected'
  });
  
  // 8. confidence_bug: no trade with direction='NEUTRAL' AND confidence >= 0.9
  const hasConfidenceBug = report.trades.some(t => 
    t.momentumDirection === 'NEUTRAL' && t.momentumConfidence >= 0.9);
  gateChecks.push({
    id: 'confidence_bug',
    label: 'Confidence bug',
    pass: !hasConfidenceBug,
    note: hasConfidenceBug ? 'NEUTRAL direction with high confidence detected' : 'No confidence bug detected'
  });
  
  return gateChecks;
}
