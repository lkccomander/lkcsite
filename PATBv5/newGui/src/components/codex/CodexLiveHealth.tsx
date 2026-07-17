import type { AnalyticsData, SessionSummary } from "../../types";

interface CodexLiveHealthProps {
  summary: SessionSummary;
  analytics: AnalyticsData;
  strategyLabel: string;
}

export function CodexLiveHealth({ summary, analytics, strategyLabel }: CodexLiveHealthProps) {
  const feedRtt = analytics.widgets.find((widget) => widget.label === "FEED RTT")?.value ?? "—";
  const latency = analytics.widgets.find((widget) => widget.label === "LATENCY")?.value ?? "—";

  return (
    <aside className="codex-health" aria-labelledby="codex-health-title">
      <h2 id="codex-health-title">LIVE HEALTH</h2>
      <dl className="codex-health__grid">
        <div>
          <dt>STATUS</dt>
          <dd>{summary.status.toUpperCase()}</dd>
        </div>
        <div>
          <dt>DATA AGE</dt>
          <dd>{summary.dataAgeSeconds}s</dd>
        </div>
        <div>
          <dt>RUNTIME MODE</dt>
          <dd>{summary.runtimeMode}</dd>
        </div>
        <div>
          <dt>STRATEGY</dt>
          <dd>{strategyLabel}</dd>
        </div>
        <div>
          <dt>FEED RTT</dt>
          <dd>{feedRtt}</dd>
        </div>
        <div>
          <dt>LATENCY</dt>
          <dd>{latency}</dd>
        </div>
      </dl>
    </aside>
  );
}
