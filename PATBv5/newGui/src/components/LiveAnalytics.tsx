import { AnalyticsData } from "../types";

interface LiveAnalyticsProps {
  data: AnalyticsData;
}

export function LiveAnalytics({ data }: LiveAnalyticsProps) {
  return (
    <section className="panel analytics-panel">
      <div className="panel-kicker">LIVE ANALYTICS</div>
      <div className="analytics-grid">
        {data.widgets.map((widget) => (
          <div key={widget.label} className={`analytics-card ${widget.tone}`}>
            <div className="analytics-label">{widget.label}</div>
            <div className="analytics-value">{widget.value}</div>
            {widget.ratio != null ? (
              <div className="analytics-bar">
                <span style={{ width: `${Math.round(widget.ratio * 100)}%` }} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
