import React from 'react';
import { Anomaly, FeedWindow, GateCheck, RejectionBucket, SessionReport, TradeRecord } from './types';

interface ReportTemplateProps {
  report: SessionReport;
}

const colors = {
  red: { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5' },
  amber: { bg: '#fffbeb', text: '#d97706', border: '#fcd34d' },
  green: { bg: '#f0fdf4', text: '#16a34a', border: '#86efac' },
  gray: { bg: '#f9fafb', text: '#4b5563', border: '#d1d5db' },
  blue: { bg: '#eff6ff', text: '#2563eb', border: '#93c5fd' },
  slate: {
    ink: '#0f172a',
    body: '#475569',
    muted: '#64748b',
    faint: '#94a3b8',
    line: '#e2e8f0',
    panel: '#f8fafc',
    tab: '#f1f5f9'
  }
} as const;

type ToneKey = 'red' | 'amber' | 'green' | 'gray' | 'blue';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value);
}

function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function formatPrice(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'N/A';
  }

  return value >= 1000 ? formatNumber(value, 1) : value.toFixed(2);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return 'N/A';
  }

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toFixed(0)}s`;
}

function Pill({
  label,
  color = 'gray',
  small = false
}: {
  label: string;
  color?: ToneKey;
  small?: boolean;
}) {
  const tone = colors[color] || colors.gray;

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: small ? 10 : 11,
        fontWeight: 700,
        padding: small ? '1px 5px' : '2px 8px',
        borderRadius: 4,
        background: tone.bg,
        color: tone.text,
        border: `1px solid ${tone.border}`,
        whiteSpace: 'nowrap',
        letterSpacing: '.01em'
      }}
    >
      {label}
    </span>
  );
}

function Card({
  children,
  style,
  borderColor
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  borderColor?: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${borderColor || colors.slate.line}`,
        borderRadius: 10,
        padding: '14px 16px',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        ...style
      }}
    >
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: colors.slate.muted,
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          marginBottom: 8
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  color
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: colors.slate.panel,
        borderRadius: 8,
        padding: '10px 14px',
        border: `1px solid ${colors.slate.line}`
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: colors.slate.muted,
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          marginBottom: 3
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || colors.slate.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: colors.slate.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function getAnomalyTone(anomaly: Anomaly): ToneKey {
  if (anomaly.severity === 'red') return 'red';
  if (anomaly.severity === 'amber') return 'amber';
  if (anomaly.severity === 'green') return 'green';
  return 'gray';
}

function getWindowTone(window: FeedWindow): ToneKey {
  if (window.status === 'SPIKE') return 'red';
  if (window.status === 'ELEVATED') return 'amber';
  return 'green';
}

function getTradeTone(trade: TradeRecord | null): string {
  if (!trade) return colors.slate.ink;
  return trade.grossPnl >= 0 ? colors.green.text : colors.red.text;
}

function getTopTrade(report: SessionReport): TradeRecord | null {
  if (report.trades.length === 0) return null;
  return report.trades[report.trades.length - 1];
}

function getRecentSessionLabel(report: SessionReport): string {
  if (report.sessionIds.length === 0) {
    return 'No session IDs captured';
  }

  return report.sessionIds.slice(0, 2).join(' · ');
}

function buildChangeRows(report: SessionReport): Array<{
  label: string;
  value: string;
  status: string;
  color: ToneKey;
}> {
  const latestTrade = getTopTrade(report);
  const hasSignals = report.momEventCount > 0 && report.mcEventCount > 0;
  const hasNewRejections = report.rejectionBreakdown.some((bucket) => bucket.isNewSignalReason && bucket.count > 0);

  return [
    {
      label: 'Signal modules',
      value: hasSignals ? 'LIVE' : 'MISSING',
      status: hasSignals ? 'LIVE' : 'CHECK',
      color: hasSignals ? 'green' : 'amber'
    },
    {
      label: 'New rejection reasons',
      value: hasNewRejections ? formatNumber(report.rejectionBreakdown.filter((bucket) => bucket.isNewSignalReason).reduce((sum, bucket) => sum + bucket.count, 0)) : '0',
      status: hasNewRejections ? 'ACTIVE' : 'NONE',
      color: hasNewRejections ? 'green' : 'gray'
    },
    {
      label: 'Sell reason coverage',
      value: report.trades.every((trade) => trade.sellReason) ? 'Tagged' : 'Mixed',
      status: report.trades.every((trade) => trade.sellReason) ? 'OK' : 'CHECK',
      color: report.trades.every((trade) => trade.sellReason) ? 'green' : 'amber'
    },
    {
      label: 'Maker mode buys',
      value: report.trades.some((trade) => trade.makerMode) ? 'true' : 'false',
      status: report.trades.some((trade) => trade.makerMode) ? 'CONFIRMED' : 'NONE',
      color: report.trades.some((trade) => trade.makerMode) ? 'green' : 'gray'
    },
    {
      label: 'Fallback pressure',
      value: formatNumber(report.fallbackCount),
      status: report.fallbackCount > Math.max(report.sessionIds.length * 20, 20) ? 'ELEVATED' : 'STABLE',
      color: report.fallbackCount > Math.max(report.sessionIds.length * 20, 20) ? 'amber' : 'green'
    },
    {
      label: 'Trade outcome',
      value: latestTrade ? formatCurrency(latestTrade.grossPnl) : 'No trade',
      status: latestTrade ? latestTrade.sellReason || 'OPEN' : 'WAITING',
      color: latestTrade ? (latestTrade.grossPnl >= 0 ? 'green' : 'red') : 'gray'
    },
    {
      label: 'Missing buy fields',
      value: latestTrade && latestTrade.missingFields.length > 0 ? latestTrade.missingFields.join(', ') : 'None',
      status: latestTrade && latestTrade.missingFields.length > 0 ? 'FIX' : 'OK',
      color: latestTrade && latestTrade.missingFields.length > 0 ? 'amber' : 'green'
    },
    {
      label: 'MC threshold pressure',
      value: `${formatNumber(report.mcBelow068)} < 0.68`,
      status: report.mcBelow068 > 0 ? 'WATCH' : 'CLEAR',
      color: report.mcBelow068 > 0 ? 'amber' : 'green'
    }
  ];
}

function buildTradeNarrative(trade: TradeRecord | null): string {
  if (!trade) {
    return 'No executed trade in the selected telemetry slice. The engine is still useful here for understanding rejection pressure, signal quality, and feed stability.';
  }

  const direction = trade.momentumDirection || 'UNKNOWN';
  const mc = trade.mcConvergence.toFixed(3);
  const latency = `${trade.feedLatencyMs}ms`;
  const rtt = `${trade.feedRttMs}ms`;
  const pnlPhrase = trade.grossPnl >= 0 ? 'This closed green' : 'This closed red';

  return `${pnlPhrase}. ${trade.side} entered at ${trade.entryPrice.toFixed(2)} and exited at ${trade.exitPrice !== null ? trade.exitPrice.toFixed(2) : 'N/A'} after ${formatDuration(trade.holdSeconds)}. MC convergence was ${mc}, momentum direction was ${direction}, feed latency was ${latency}, and RTT was ${rtt}. Treat this as an operator snapshot of why the engine accepted the trade and how the trade resolved.`;
}

function buildSignalNarrative(report: SessionReport): string {
  if (report.momEventCount === 0 && report.mcEventCount === 0) {
    return 'Signal telemetry is absent in this slice, so the report cannot explain directional filtering or convergence quality yet.';
  }

  return `Momentum emitted ${formatNumber(report.momEventCount)} events and Monte Carlo emitted ${formatNumber(report.mcEventCount)}. Average MC convergence is ${report.mcConvAvg.toFixed(3)}, with ${formatNumber(report.mcBelow068)} events below 0.68. Use this view to decide whether weak signals are noise, tuning candidates, or genuine opportunities.`;
}

function buildFeedNarrative(report: SessionReport): string {
  const spiked = report.feedWindows.filter((window) => window.status === 'SPIKE').length;
  const elevated = report.feedWindows.filter((window) => window.status === 'ELEVATED').length;

  if (report.feedWindows.length === 0) {
    return 'No feed.summary windows were captured in this slice. Feed health inference is limited to fallback and RTT counters.';
  }

  return `${formatNumber(report.feedWindows.length)} feed windows were summarized. ${formatNumber(spiked)} spiked and ${formatNumber(elevated)} were elevated. Use this table to correlate fallback bursts, RTT outliers, and reconnect pressure with trade timing and rejection bursts.`;
}

function buildShadowNarrative(report: SessionReport): string {
  if (report.shadowEventCount === 0) {
    return 'No shadow PnL events were captured in this slice.';
  }

  return `${formatNumber(report.shadowEventCount)} rejected signals were modeled in shadow mode. Hypothetical total is ${formatCurrency(report.shadowTotalHypothetical)} with a win rate of ${formatPercent(report.shadowWinRate)}. This is the fastest way to tell whether the filters are acting as protection or overfitting.`;
}

function RejectionBars({ buckets }: { buckets: RejectionBucket[] }) {
  if (buckets.length === 0) {
    return <Card><div style={{ fontSize: 12, color: colors.slate.body }}>No rejection buckets captured.</div></Card>;
  }

  const sorted = [...buckets].sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...sorted.map((bucket) => bucket.count), 1);

  return (
    <Card>
      {sorted.map((bucket, index) => (
        <div key={bucket.reason} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: index === sorted.length - 1 ? 0 : 6 }}>
          <span style={{ minWidth: 230, color: colors.slate.body, fontSize: 12 }}>
            {bucket.reason}
            {bucket.isNewSignalReason && (
              <span style={{ marginLeft: 6, fontSize: 10, color: colors.green.text, fontWeight: 800 }}>NEW</span>
            )}
          </span>
          <div style={{ flex: 1, background: colors.slate.tab, borderRadius: 3, height: 6, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                borderRadius: 3,
                background: bucket.isNewSignalReason ? colors.green.text : index < 2 ? colors.red.text : colors.slate.faint,
                width: `${(bucket.count / maxCount) * 100}%`
              }}
            />
          </div>
          <span
            style={{
              minWidth: 38,
              textAlign: 'right',
              fontWeight: 700,
              fontSize: 12,
              color: bucket.isNewSignalReason ? colors.green.text : colors.slate.ink
            }}
          >
            {formatNumber(bucket.count)}
          </span>
        </div>
      ))}
    </Card>
  );
}

function GateList({ gates }: { gates: GateCheck[] }) {
  return (
    <Card>
      {gates.map((gate, index) => (
        <div
          key={gate.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 0',
            borderBottom: index < gates.length - 1 ? `1px solid ${colors.slate.tab}` : 'none',
            fontSize: 12
          }}
        >
          <Pill label={gate.pass ? 'PASS' : 'FAIL'} color={gate.pass ? 'green' : 'red'} />
          <span style={{ flex: 1 }}>{gate.label}</span>
          <span style={{ color: colors.slate.faint, fontSize: 11 }}>{gate.note}</span>
        </div>
      ))}
    </Card>
  );
}

export const ReportTemplate: React.FC<ReportTemplateProps> = ({ report }) => {
  const [tab, setTab] = React.useState('overview');
  const topTrade = getTopTrade(report);
  const changeRows = buildChangeRows(report);
  const tabs = ['overview', 'trade', 'signals', 'feed', 'fixes'];
  const topAnomalies = [...report.anomalies].sort((a, b) => a.priority - b.priority);

  return (
    <div
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        maxWidth: 860,
        margin: '0 auto',
        padding: '18px',
        color: colors.slate.ink,
        fontSize: 13,
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>LKCsite Telemetry</div>
          <div style={{ fontSize: 12, color: colors.slate.muted, marginTop: 3 }}>
            {report.strategy || 'unknown_strategy'} · {report.mode || 'unknown_mode'} · {report.sessionIds.length} sessions · {formatNumber(report.totalEvents)} events
          </div>
          <div style={{ fontSize: 11, color: colors.slate.faint, marginTop: 2 }}>
            {getRecentSessionLabel(report)}
          </div>
        </div>
        <Pill label={`${report.mode || 'UNKNOWN'} MODE`} color={report.mode === 'PAPER' ? 'blue' : 'gray'} />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: colors.slate.tab, padding: 4, borderRadius: 8 }}>
        {tabs.map((tabName) => (
          <button
            key={tabName}
            onClick={() => setTab(tabName)}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'capitalize',
              background: tab === tabName ? '#fff' : 'transparent',
              color: tab === tabName ? colors.slate.ink : colors.slate.muted,
              boxShadow: tab === tabName ? '0 1px 3px rgba(0,0,0,.1)' : 'none'
            }}
          >
            {tabName}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            <Metric label="Sessions" value={String(report.sessionIds.length)} sub={getRecentSessionLabel(report)} />
            <Metric
              label="Net PnL"
              value={formatCurrency(report.netPnl)}
              sub={`${report.trades.length} trades · ${topTrade ? formatDuration(topTrade.holdSeconds) : 'no trade'}`}
              color={report.netPnl >= 0 ? colors.green.text : colors.red.text}
            />
            <Metric
              label="Signal Modules"
              value={report.momEventCount > 0 && report.mcEventCount > 0 ? 'LIVE' : 'PARTIAL'}
              sub={`${formatNumber(report.momEventCount)} MOM · ${formatNumber(report.mcEventCount)} MC`}
              color={report.momEventCount > 0 && report.mcEventCount > 0 ? colors.green.text : colors.amber.text}
            />
            <Metric
              label="WS Fallbacks"
              value={formatNumber(report.fallbackCount)}
              sub={`${report.feedWindows.filter((window) => window.status !== 'OK').length} stressed windows`}
              color={report.fallbackCount > Math.max(report.sessionIds.length * 20, 20) ? colors.amber.text : colors.green.text}
            />
          </div>

          <Section title="What changed this iteration">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {changeRows.map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 10px',
                    background: colors.slate.panel,
                    borderRadius: 6,
                    border: `1px solid ${colors.slate.line}`
                  }}
                >
                  <span style={{ color: colors.slate.body }}>{row.label}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>{row.value}</span>
                    <Pill label={row.status} color={row.color} small />
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title={`Rejection breakdown — ${formatNumber(report.rejectionCount)} total`}>
            <RejectionBars buckets={report.rejectionBreakdown} />
          </Section>
        </>
      )}

      {tab === 'trade' && (
        <>
          <Card borderColor={topTrade && topTrade.grossPnl < 0 ? colors.red.border : colors.blue.border}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              {topTrade
                ? `${topTrade.side} @ ${topTrade.entryPrice.toFixed(2)} → ${topTrade.sellReason || 'open'} @ ${topTrade.exitPrice !== null ? topTrade.exitPrice.toFixed(2) : 'N/A'} · ${formatDuration(topTrade.holdSeconds)} · ${formatCurrency(topTrade.grossPnl)}`
                : 'No executed trades in this slice'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
              <Metric
                label="Entry"
                value={topTrade ? `${topTrade.side} @ ${topTrade.entryPrice.toFixed(2)}` : 'N/A'}
                sub={topTrade ? `BTC ${formatPrice(topTrade.btcAtEntry)}` : 'No trade'}
              />
              <Metric
                label="Exit"
                value={topTrade ? `${topTrade.sellReason || 'OPEN'} @ ${topTrade.exitPrice !== null ? topTrade.exitPrice.toFixed(2) : 'N/A'}` : 'N/A'}
                sub={topTrade ? `BTC ${formatPrice(topTrade.btcAtExit)}` : 'No exit'}
                color={topTrade ? getTradeTone(topTrade) : colors.slate.ink}
              />
              <Metric
                label="MC Convergence"
                value={topTrade ? topTrade.mcConvergence.toFixed(3) : 'N/A'}
                sub={topTrade ? `sim ${topTrade.mcSimulatedDirection || 'unknown'}` : 'No trade'}
                color={topTrade && topTrade.mcConvergence < 0.68 ? colors.amber.text : undefined}
              />
              <Metric
                label="Momentum"
                value={topTrade ? topTrade.momentumDirection || 'UNKNOWN' : 'N/A'}
                sub={topTrade ? `conf ${topTrade.momentumConfidence.toFixed(3)}` : 'No trade'}
                color={topTrade && topTrade.momentumDirection === 'NEUTRAL' ? colors.amber.text : undefined}
              />
            </div>

            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                background: topTrade && topTrade.grossPnl < 0 ? colors.red.bg : colors.blue.bg,
                borderRadius: 8,
                border: `1px solid ${topTrade && topTrade.grossPnl < 0 ? colors.red.border : colors.blue.border}`,
                fontSize: 12,
                lineHeight: 1.7
              }}
            >
              <strong>What happened:</strong> {buildTradeNarrative(topTrade)}
            </div>
          </Card>

          <Section title="Signal values at entry">
            <Card>
              {topTrade ? (
                [
                  ['momentumDirection', topTrade.momentumDirection || 'N/A', 'Observed directional label at entry'],
                  ['momentumScore', topTrade.momentumScore.toFixed(4), 'Raw momentum score captured on buy'],
                  ['momentumConfidence', topTrade.momentumConfidence.toFixed(3), 'Current confidence value from signal module'],
                  ['mcConvergence', topTrade.mcConvergence.toFixed(3), 'Convergence strength on accepted trade'],
                  ['mcSimulatedDirection', topTrade.mcSimulatedDirection || 'N/A', 'Monte Carlo directional output'],
                  ['feedLatencyMs', String(topTrade.feedLatencyMs), 'Feed latency stamped on trade'],
                  ['feedRttMs', String(topTrade.feedRttMs), 'Round-trip time at entry'],
                  ['makerMode', String(topTrade.makerMode), 'Whether maker mode was active'],
                  ['feeUsd', formatCurrency(topTrade.feeUsd), 'Entry fee captured on the trade'],
                  ['missingFields', topTrade.missingFields.length > 0 ? topTrade.missingFields.join(', ') : 'None', 'Expected buy fields missing from payload']
                ].map(([key, value, note], index) => (
                  <div
                    key={String(key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '5px 0',
                      borderBottom: index < 9 ? `1px solid ${colors.slate.tab}` : 'none',
                      fontSize: 12
                    }}
                  >
                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: '#7c3aed', minWidth: 200 }}>
                      {key}
                    </span>
                    <span style={{ fontWeight: 700, minWidth: 92, color: value === 'None' ? colors.slate.ink : colors.slate.ink }}>
                      {String(value)}
                    </span>
                    <span style={{ color: colors.slate.faint }}>{note}</span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12, color: colors.slate.body }}>No trade payload available in this slice.</div>
              )}
            </Card>
          </Section>
        </>
      )}

      {tab === 'signals' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>signal.momentum — {formatNumber(report.momEventCount)} events</div>
              <Metric
                label="Directions"
                value={Object.keys(report.momDirections).length > 0 ? Object.entries(report.momDirections).map(([direction, count]) => `${direction} ${count}`).join(' · ') : 'No momentum data'}
                sub={`score range ${report.momScoreMin.toFixed(4)} to ${report.momScoreMax.toFixed(4)}`}
                color={report.momEventCount > 0 ? colors.amber.text : colors.gray.text}
              />
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Metric label="Score range" value={`${report.momScoreMin.toFixed(4)} → ${report.momScoreMax.toFixed(4)}`} />
                <Metric label="Confidence avg" value={report.momConfAvg.toFixed(3)} sub="reported by momentum telemetry" />
              </div>
              <div style={{ marginTop: 10, padding: '9px 11px', background: colors.amber.bg, borderRadius: 7, border: `1px solid ${colors.amber.border}`, fontSize: 12, lineHeight: 1.6 }}>
                <strong>Interpretation:</strong> {buildSignalNarrative(report)}
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>signal.montecarlo — {formatNumber(report.mcEventCount)} events</div>
              <Metric
                label="Convergence avg"
                value={report.mcConvAvg.toFixed(3)}
                sub={`range ${report.mcConvMin.toFixed(3)} – ${report.mcConvMax.toFixed(3)}`}
                color={report.mcConvAvg >= 0.68 ? colors.blue.text : colors.amber.text}
              />
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Metric label="Below 0.62" value={`${formatNumber(report.mcBelow062)} / ${formatNumber(report.mcEventCount)}`} />
                <Metric label="Below 0.68" value={`${formatNumber(report.mcBelow068)} / ${formatNumber(report.mcEventCount)}`} />
              </div>
              <div style={{ marginTop: 10, padding: '9px 11px', background: colors.blue.bg, borderRadius: 7, border: `1px solid ${colors.blue.border}`, fontSize: 12, lineHeight: 1.6 }}>
                <strong>Tuning read:</strong> {report.mcBelow068 > 0 ? `There are ${formatNumber(report.mcBelow068)} events below 0.68 in this slice. If weak trades cluster there, the threshold is a candidate for tightening.` : 'No sub-0.68 events were observed in this slice.'}
              </div>
            </Card>
          </div>

          <Section title="New rejections firing — confirmed">
            <Card>
              {report.rejectionBreakdown.filter((bucket) => bucket.isNewSignalReason).length > 0 ? (
                report.rejectionBreakdown
                  .filter((bucket) => bucket.isNewSignalReason)
                  .sort((a, b) => b.count - a.count)
                  .map((bucket, index) => (
                    <div
                      key={bucket.reason}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '7px 0',
                        borderBottom: index < report.rejectionBreakdown.filter((item) => item.isNewSignalReason).length - 1 ? `1px solid ${colors.slate.tab}` : 'none'
                      }}
                    >
                      <Pill label={`${bucket.count}×`} color="green" />
                      <div>
                        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: '#7c3aed' }}>{bucket.reason}</span>
                        <div style={{ fontSize: 11, color: colors.slate.muted, marginTop: 2 }}>
                          New-signal rejection present in telemetry. Keep using these buckets to verify the intended filters are actually participating.
                        </div>
                      </div>
                    </div>
                  ))
              ) : (
                <div style={{ fontSize: 12, color: colors.slate.body }}>No new-signal rejection reasons were captured in this slice.</div>
              )}
            </Card>
          </Section>

          <Section title="Shadow PnL — rejected signals">
            <Card>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                <Metric label="Shadow events" value={formatCompactNumber(report.shadowEventCount)} sub="rejected trades modeled" />
                <Metric label="Would-win rate" value={formatPercent(report.shadowWinRate)} sub="shadow modeled winners" color={report.shadowWinRate < 15 ? colors.green.text : colors.amber.text} />
                <Metric label="Total hypothetical" value={formatCurrency(report.shadowTotalHypothetical)} sub="aggregate shadow outcome" color={report.shadowTotalHypothetical <= 0 ? colors.green.text : colors.red.text} />
              </div>
              <div style={{ marginTop: 10, padding: '9px 11px', background: report.shadowTotalHypothetical <= 0 ? colors.green.bg : colors.amber.bg, borderRadius: 7, border: `1px solid ${report.shadowTotalHypothetical <= 0 ? colors.green.border : colors.amber.border}`, fontSize: 12 }}>
                {buildShadowNarrative(report)}
              </div>
            </Card>
          </Section>
        </>
      )}

      {tab === 'feed' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            <Metric label="RTT avg" value={`${formatNumber(report.rttAvg, 0)}ms`} sub={`p95=${formatNumber(report.rttP95, 0)}ms · max=${formatNumber(report.rttMax, 0)}ms`} />
            <Metric label="Total fallbacks" value={formatNumber(report.fallbackCount)} sub={`${report.feedWindows.length} feed windows`} color={report.fallbackCount > Math.max(report.sessionIds.length * 20, 20) ? colors.amber.text : colors.green.text} />
            <Metric label="Reconnect windows" value={formatNumber(report.feedWindows.filter((window) => window.reconnectEvents > 0).length)} sub="windows with reconnectEvents > 0" />
          </div>

          <Section title={`Per-window feed health — ${formatNumber(report.feedWindows.length)} windows`}>
            <Card>
              <div style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: `1px solid ${colors.slate.tab}`, fontSize: 11, color: colors.slate.muted, fontWeight: 700 }}>
                <span style={{ width: 160 }}>Window</span>
                <span style={{ width: 70, textAlign: 'right' }}>Fallbacks</span>
                <span style={{ width: 90, textAlign: 'right' }}>Avg RTT</span>
                <span style={{ width: 80, textAlign: 'right' }}>Max RTT</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Reconnects</span>
                <span style={{ width: 76, textAlign: 'right' }}>Status</span>
              </div>
              {report.feedWindows.map((window) => {
                const tone = getWindowTone(window);
                return (
                  <div key={`${window.slug}-${window.start}`} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.slate.panel}`, fontSize: 12, alignItems: 'center' }}>
                    <span style={{ width: 160, color: colors.slate.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{window.slug}</span>
                    <span style={{ width: 70, textAlign: 'right', fontWeight: 700, color: colors[tone].text }}>{formatNumber(window.fallbacks)}</span>
                    <span style={{ width: 90, textAlign: 'right' }}>{formatNumber(window.rttAvg, 0)}ms</span>
                    <span style={{ width: 80, textAlign: 'right' }}>{formatNumber(window.rttMax, 0)}ms</span>
                    <span style={{ flex: 1, textAlign: 'right', color: colors.slate.muted }}>{formatNumber(window.reconnectEvents)}</span>
                    <span style={{ width: 76, textAlign: 'right' }}><Pill label={window.status} color={tone} small /></span>
                  </div>
                );
              })}
              <div style={{ marginTop: 10, padding: '9px 11px', background: colors.amber.bg, borderRadius: 7, border: `1px solid ${colors.amber.border}`, fontSize: 12, lineHeight: 1.6 }}>
                {buildFeedNarrative(report)}
              </div>
            </Card>
          </Section>
        </>
      )}

      {tab === 'fixes' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topAnomalies.length > 0 ? (
              topAnomalies.map((anomaly) => {
                const tone = getAnomalyTone(anomaly);
                return (
                  <div key={`${anomaly.priority}-${anomaly.title}`} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: '#fff', border: `1px solid ${colors[tone].border}`, borderRadius: 10 }}>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: colors[tone].bg,
                        border: `1.5px solid ${colors[tone].border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 800,
                        color: colors[tone].text,
                        flexShrink: 0
                      }}
                    >
                      {anomaly.priority}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <Pill label={anomaly.type} color={tone} />
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{anomaly.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: colors.slate.body, lineHeight: 1.6 }}>{anomaly.detail}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <Card><div style={{ fontSize: 12, color: colors.slate.body }}>No anomalies detected in this slice.</div></Card>
            )}
          </div>

          <Section title="Gate status — real money checklist">
            <GateList gates={report.gateChecks} />
          </Section>
        </>
      )}
    </div>
  );
};

export default ReportTemplate;
