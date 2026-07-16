import { Anomaly, GateCheck, SessionReport } from './types';

export type ActionSeverity = 'critical' | 'high' | 'medium' | 'info' | 'success';

export interface ReportActionItem {
  id: string;
  title: string;
  severity: ActionSeverity;
  evidence: string;
  impact: string;
  recommendation: string;
  verification: string;
  command?: string;
}

export interface ReportActions {
  whatWentWell: ReportActionItem[];
  problems: ReportActionItem[];
  recommendations: ReportActionItem[];
  nextSteps: ReportActionItem[];
}

const severityRank: Record<ActionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
  success: 4,
};

function sortBySeverity(items: ReportActionItem[]): ReportActionItem[] {
  return [...items].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

function pushUnique(items: ReportActionItem[], item: ReportActionItem): void {
  if (!items.some((existing) => existing.id === item.id)) {
    items.push(item);
  }
}

function commandFor(report: SessionReport, script: string): string {
  const telemetryFile = report.files[0];
  const fileFlag = script === 'report' ? '--file' : '--telemetry-file';
  return telemetryFile
    ? `npm run ${script} -- ${fileFlag} "${telemetryFile}"`
    : `npm run ${script}`;
}

function gateSeverity(gate: GateCheck): ActionSeverity {
  if (gate.id === 'confidence_bug') return 'critical';
  if (['feed_fallbacks', 'signal_events', 'sell_reason'].includes(gate.id)) return 'high';
  if (['mc_threshold', 'maker_mode'].includes(gate.id)) return 'medium';
  return 'info';
}

function anomalySeverity(anomaly: Anomaly): ActionSeverity {
  if (anomaly.severity === 'red') return 'high';
  if (anomaly.severity === 'amber') return 'medium';
  return 'info';
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function dominantCounter(counter: Record<string, number>): [string, number] | null {
  return Object.entries(counter).sort((left, right) => right[1] - left[1])[0] ?? null;
}

function buildWhatWentWell(report: SessionReport): ReportActionItem[] {
  const items: ReportActionItem[] = [];
  const completedTrades = report.trades.length;

  if (report.buys > 0 && report.buys === report.sells && completedTrades === report.sells) {
    pushUnique(items, {
      id: 'matched-trade-lifecycle',
      title: 'Executed trade lifecycle is matched',
      severity: 'success',
      evidence: `${report.buys} buys, ${report.sells} sells, and ${completedTrades} completed trade records`,
      impact: 'The analyzed slice has a coherent entry-to-exit record for every executed trade.',
      recommendation: 'Preserve this lifecycle instrumentation while changing strategy or feed behavior.',
      verification: 'Future reports continue to show equal non-zero buy, sell, and completed-trade counts.',
    });
  }

  if (completedTrades > 0 && report.netPnl > 0) {
    pushUnique(items, {
      id: 'positive-paper-pnl',
      title: 'The analyzed trade sample finished positive',
      severity: 'success',
      evidence: `${completedTrades} completed trades produced net PnL of $${report.netPnl.toFixed(2)}`,
      impact: 'The session produced positive PAPER evidence, although sample-size gates still apply.',
      recommendation: 'Keep the result as one data point and compare it with additional PAPER sessions.',
      verification: 'Positive net PnL persists across the required out-of-sample trade count.',
    });
  }

  if (
    report.momEventCount > 0
    && report.mcEventCount > 0
    && report.momUsableEventCount === report.momEventCount
    && report.momMissingFieldEventCount === 0
  ) {
    pushUnique(items, {
      id: 'signal-telemetry-present',
      title: 'Both signal modules emitted telemetry',
      severity: 'success',
      evidence: `${report.momEventCount} momentum events and ${report.mcEventCount} Monte Carlo events`,
      impact: 'Signal behavior can be analyzed instead of inferred from trades alone.',
      recommendation: 'Retain both telemetry streams in subsequent PAPER sessions.',
      verification: 'Both event counts remain non-zero in each analyzed session.',
    });
  }

  if (completedTrades > 0 && report.trades.every((trade) => trade.missingFields.length === 0)) {
    pushUnique(items, {
      id: 'trade-fields-complete',
      title: 'Executed trades contain the expected analysis fields',
      severity: 'success',
      evidence: `${completedTrades}/${completedTrades} completed trades have no reported missing fields`,
      impact: 'Trade-level comparisons can use consistent entry context.',
      recommendation: 'Keep field coverage checks enabled as the engine evolves.',
      verification: 'The missing-field count remains zero on future executed trades.',
    });
  }

  if (
    report.shadowEventCount > 0
    && report.shadowResolvedEventCount === report.shadowEventCount
    && report.shadowUnresolvedEventCount === 0
  ) {
    pushUnique(items, {
      id: 'shadow-labels-resolved',
      title: 'Shadow outcomes are fully resolved',
      severity: 'success',
      evidence: `${report.shadowResolvedEventCount}/${report.shadowEventCount} shadow outcomes resolved`,
      impact: 'Rejected-signal outcome analysis has authoritative labels for this slice.',
      recommendation: 'Preserve settlement metadata and resolution coverage.',
      verification: 'Unresolved shadow outcomes remain zero.',
    });
  }

  const feedGate = report.gateChecks.find((gate) => gate.id === 'feed_fallbacks');
  if (feedGate?.pass) {
    pushUnique(items, {
      id: 'feed-gate-passed',
      title: 'Configured feed fallback gate passed',
      severity: 'success',
      evidence: feedGate.note,
      impact: 'Fallback pressure stayed within the report\'s configured diagnostic limit.',
      recommendation: 'Continue monitoring repeated sessions rather than treating one pass as permanent.',
      verification: 'The feed fallback gate continues to pass in fresh PAPER sessions.',
    });
  }

  return items;
}

function buildProblems(report: SessionReport): ReportActionItem[] {
  const items: ReportActionItem[] = [];

  const dominantTransportError = dominantCounter(report.websocketErrorCategories);
  if (dominantTransportError || report.reconnectScheduledCount > 0 || report.disconnectCount > 0) {
    const [category, categoryCount] = dominantTransportError ?? ['unknown', 0];
    pushUnique(items, {
      id: 'feed-transport-incident',
      title: 'Feed transport recovery remained active',
      severity: category === 'tls_certificate_policy' ? 'high' : 'medium',
      evidence: `${category} errors=${categoryCount}; scheduled reconnects=${report.reconnectScheduledCount}; forced reconnects=${report.forcedReconnectCount}; disconnects=${report.disconnectCount}`,
      impact: 'Transport incidents can create fallback bursts and invalidate timing-sensitive feed evidence.',
      recommendation: category === 'tls_certificate_policy'
        ? 'Keep TLS verification enabled, run the readiness check, and wait for the certificate circuit breaker before another session.'
        : 'Inspect the dominant close code and fallback reason before another session.',
      verification: 'The readiness command passes and a fresh report shows no sustained transport-error burst.',
    });
  }

  if (report.shadowUnresolvedEventCount > 0) {
    const ratio = report.shadowEventCount > 0
      ? (report.shadowUnresolvedEventCount / report.shadowEventCount) * 100
      : 100;
    pushUnique(items, {
      id: 'unresolved-shadow-outcomes',
      title: 'Shadow outcomes are unresolved',
      severity: ratio === 100 ? 'critical' : 'high',
      evidence: `${report.shadowUnresolvedEventCount}/${report.shadowEventCount} shadow outcomes unresolved (${ratio.toFixed(1)}%)`,
      impact: 'Unresolved outcomes cannot be trusted as supervised-learning labels or filter-quality evidence.',
      recommendation: 'Repair settlement resolution before using shadow outcomes for ML or strategy claims.',
      verification: 'A fresh report shows authoritative resolved outcomes and no silent null-to-zero conversion.',
    });
  }

  if (report.trades.length < 150) {
    pushUnique(items, {
      id: 'insufficient-trade-sample',
      title: 'Trade sample is insufficient for strategy conclusions',
      severity: report.trades.length === 0 ? 'high' : 'medium',
      evidence: `${report.trades.length}/150 completed trades required by the existing report gate`,
      impact: 'Win rate and PnL can be dominated by a small number of outcomes.',
      recommendation: 'Collect additional PAPER evidence without treating this slice as proof of edge.',
      verification: 'The comparable out-of-sample dataset reaches at least 150 completed trades.',
    });
  }

  if (report.momEventCount === 0 || report.mcEventCount === 0) {
    pushUnique(items, {
      id: 'missing-signal-telemetry',
      title: 'Signal telemetry is incomplete',
      severity: 'high',
      evidence: `${report.momEventCount} momentum events and ${report.mcEventCount} Monte Carlo events`,
      impact: 'The report cannot explain signal quality or build a complete feature dataset.',
      recommendation: 'Restore the missing signal event stream before evaluating the session.',
      verification: 'Signal validation reports non-zero events for both modules.',
    });
  }

  if (report.momEventCount > 0 && report.momUsableEventCount < report.momEventCount) {
    pushUnique(items, {
      id: 'incomplete-momentum-telemetry',
      title: 'Momentum telemetry fields are incomplete',
      severity: report.momUsableEventCount === 0 ? 'high' : 'medium',
      evidence: `${report.momUsableEventCount}/${report.momEventCount} momentum events contain direction, score, and confidence`,
      impact: 'Missing signal fields can fabricate neutral directions and zero-valued metrics in downstream analysis.',
      recommendation: 'Repair or migrate the momentum payload contract before treating the signal stream as healthy evidence.',
      verification: 'A fresh report shows complete momentum field coverage with non-fabricated aggregate values.',
    });
  }

  const tradesWithMissingFields = report.trades.filter((trade) => trade.missingFields.length > 0);
  if (tradesWithMissingFields.length > 0) {
    const fields = [...new Set(tradesWithMissingFields.flatMap((trade) => trade.missingFields))];
    pushUnique(items, {
      id: 'missing-trade-fields',
      title: 'Executed trades are missing analysis fields',
      severity: 'high',
      evidence: `${tradesWithMissingFields.length}/${report.trades.length} trades missing: ${fields.join(', ')}`,
      impact: 'Incomplete entry context weakens comparisons and ML feature construction.',
      recommendation: 'Repair the event emitter or parser field mapping before collecting more training data.',
      verification: 'The next report shows zero trades with missing fields.',
    });
  }

  for (const gate of report.gateChecks) {
    if (gate.pass || gate.id === 'win_rate' || gate.id === 'new_rejections') {
      continue;
    }
    pushUnique(items, {
      id: `failed-gate-${gate.id}`,
      title: `${gate.label} gate failed`,
      severity: gateSeverity(gate),
      evidence: gate.note,
      impact: 'The session does not satisfy this configured diagnostic condition.',
      recommendation: `Address the evidence behind the ${gate.label.toLowerCase()} gate before relying on this session.`,
      verification: `The ${gate.label} gate passes on a fresh PAPER report.`,
    });
  }

  for (const anomaly of report.anomalies) {
    if (anomaly.type === 'PASS') {
      continue;
    }
    const anomalyId = `anomaly-${slug(anomaly.title)}`;
    pushUnique(items, {
      id: anomalyId,
      title: anomaly.title,
      severity: anomalySeverity(anomaly),
      evidence: anomaly.detail || `${anomaly.type} anomaly at priority ${anomaly.priority}`,
      impact: 'The configured report analysis identified behavior that needs review.',
      recommendation: anomaly.detail || 'Inspect the triggering events and correct the underlying condition.',
      verification: 'The anomaly no longer appears in a fresh report with equivalent telemetry coverage.',
    });
  }

  return sortBySeverity(items);
}

function buildRecommendations(report: SessionReport, problems: ReportActionItem[]): ReportActionItem[] {
  const items: ReportActionItem[] = [];
  const problemIds = new Set(problems.map((problem) => problem.id));

  if (problemIds.has('unresolved-shadow-outcomes')) {
    pushUnique(items, {
      id: 'repair-shadow-settlement',
      title: 'Repair authoritative shadow settlement labels first',
      severity: 'critical',
      evidence: `${report.shadowUnresolvedEventCount} unresolved shadow outcomes block label-quality claims`,
      impact: 'Training or tuning against unresolved labels would encode unknown outcomes as evidence.',
      recommendation: 'Validate Gamma settlement lookup, cache behavior, and shadow outcome persistence before ML dataset construction.',
      verification: 'Shadow settlement tests pass and a fresh session produces resolved hypothetical PnL values.',
      command: 'npm run test:shadow-settlement',
    });
  }

  if (
    problemIds.has('failed-gate-feed_fallbacks')
    || problemIds.has('anomaly-window-had-fallbacks-close-1006-spike')
  ) {
    pushUnique(items, {
      id: 'stabilize-feed',
      title: 'Reduce feed fallback pressure before trusting timing-sensitive evidence',
      severity: 'high',
      evidence: `${report.fallbackCount} fallback events and ${report.feedWindows.filter((window) => window.status !== 'OK').length} stressed feed windows`,
      impact: 'Fallback bursts can distort candidate timing, prices, and rejection attribution.',
      recommendation: 'Inspect fallback reasons and the worst windows, then validate another fresh PAPER session.',
      verification: 'The configured feed gate passes and stressed-window counts fall on a fresh session.',
      command: commandFor(report, 'validate:signals'),
    });
  }

  if (
    problemIds.has('missing-signal-telemetry')
    || problemIds.has('incomplete-momentum-telemetry')
    || problemIds.has('failed-gate-signal_events')
  ) {
    pushUnique(items, {
      id: 'restore-signal-telemetry',
      title: 'Restore complete signal telemetry',
      severity: 'high',
      evidence: `${report.momEventCount} momentum events and ${report.mcEventCount} Monte Carlo events`,
      impact: 'Incomplete signal streams prevent reliable feature and rejection analysis.',
      recommendation: 'Trace the missing emitter and confirm both modules write session-scoped events.',
      verification: 'Signal validation passes presence and field-coverage checks for both modules.',
      command: commandFor(report, 'validate:signals'),
    });
  }

  if (problemIds.has('missing-trade-fields')) {
    pushUnique(items, {
      id: 'repair-trade-schema',
      title: 'Repair trade telemetry field coverage',
      severity: 'high',
      evidence: problems.find((problem) => problem.id === 'missing-trade-fields')?.evidence ?? 'Missing trade fields detected',
      impact: 'Incomplete trade records weaken analysis and model feature consistency.',
      recommendation: 'Correct the emitter/parser mapping for every reported field before the next data-collection run.',
      verification: 'The generated report shows no missing fields on completed trades.',
      command: commandFor(report, 'analyze:trades'),
    });
  }

  if (problemIds.has('insufficient-trade-sample')) {
    pushUnique(items, {
      id: 'collect-paper-evidence',
      title: 'Collect more comparable PAPER evidence',
      severity: report.trades.length === 0 ? 'high' : 'medium',
      evidence: `${report.trades.length}/150 completed trades available`,
      impact: 'The current sample is not large enough for a strategy conclusion.',
      recommendation: 'Keep the strategy and data contract stable while collecting additional PAPER sessions.',
      verification: 'The comparable out-of-sample dataset reaches at least 150 completed trades.',
      command: commandFor(report, 'analyze:trades'),
    });
  }

  for (const problem of problems) {
    if (!problem.id.startsWith('anomaly-')) {
      continue;
    }
    pushUnique(items, {
      id: `resolve-${problem.id}`,
      title: `Resolve: ${problem.title}`,
      severity: problem.severity,
      evidence: problem.evidence,
      impact: problem.impact,
      recommendation: problem.recommendation,
      verification: problem.verification,
      command: commandFor(report, 'report'),
    });
  }

  return sortBySeverity(items);
}

function buildNextSteps(recommendations: ReportActionItem[]): ReportActionItem[] {
  return recommendations.map((recommendation, index) => ({
    ...recommendation,
    id: `next-${recommendation.id}`,
    title: `${index + 1}. ${recommendation.title}`,
  }));
}

export function buildReportActions(report: SessionReport): ReportActions {
  const whatWentWell = buildWhatWentWell(report);
  const problems = buildProblems(report);
  const recommendations = buildRecommendations(report, problems);

  return {
    whatWentWell,
    problems,
    recommendations,
    nextSteps: buildNextSteps(recommendations),
  };
}
