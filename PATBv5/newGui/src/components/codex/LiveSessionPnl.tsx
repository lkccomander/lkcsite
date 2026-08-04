import React from "react";
import { formatCurrency } from "../../lib/formatters";
import type { ControlStatus, SessionSummary } from "../../types";

interface LiveSessionPnlProps {
  summary: SessionSummary;
  controlStatus?: ControlStatus | null;
}

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 250;
const MAX_HISTORY_POINTS = 28;
const PADDING_Y = 12;

interface ChartPoint {
  x: number;
  y: number;
}

function projectPoints(
  points: SessionSummary["pnlHistory"],
  width = CHART_WIDTH,
  height = CHART_HEIGHT,
): ChartPoint[] {
  if (points.length === 0) {
    return [];
  }
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const slotCount = Math.max(points.length, MAX_HISTORY_POINTS);
  const slotWidth = slotCount > 1 ? width / (slotCount - 1) : 0;

  return points.map((point, index) => ({
    x: slotWidth * index,
    y: height - ((point.value - min) / span) * (height - PADDING_Y * 2) - PADDING_Y,
  }));
}

function toPolyline(points: ChartPoint[], width = CHART_WIDTH, height = CHART_HEIGHT): string {
  if (points.length < 2) {
    return `0,${height / 2} ${width},${height / 2}`;
  }
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
}

function formatCountdownLabel(controlStatus: ControlStatus | null | undefined, nowMs: number): string | null {
  if (controlStatus?.state !== "STOPPING") {
    return null;
  }

  const activeRun = controlStatus.activeRun;
  if (!activeRun?.stopRequestedAt || !activeRun.forceEligibleAt) {
    return null;
  }

  const eligibleMs = Date.parse(activeRun.forceEligibleAt);
  if (!Number.isFinite(eligibleMs)) {
    return null;
  }

  const remainingMs = Math.max(0, eligibleMs - nowMs);
  if (remainingMs === 0) {
    return "FORCE STOP READY";
  }

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `FORCE STOP IN ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function LiveSessionPnl({ summary, controlStatus = null }: LiveSessionPnlProps) {
  const pnlTone = summary.realizedPnl > 0 ? "positive" : summary.realizedPnl < 0 ? "negative" : "neutral";
  const chartPoints = projectPoints(summary.pnlHistory);
  const polyline = toPolyline(chartPoints);
  const currentPoint = chartPoints[chartPoints.length - 1] ?? null;
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const countdownLabel = formatCountdownLabel(controlStatus, nowMs);
  const countdownActive = countdownLabel?.startsWith("FORCE STOP IN ") ?? false;

  React.useEffect(() => {
    if (!countdownActive) {
      return;
    }

    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [countdownActive]);

  return (
    <figure className={`codex-live-pnl ${pnlTone}`}>
      <figcaption className="codex-live-pnl__header">
        <span className="codex-live-pnl__label">LIVE SESSION P&amp;L</span>
        <div className="codex-live-pnl__copy">
          <strong className="codex-live-pnl__value">{formatSignedCurrency(summary.realizedPnl)}</strong>
          {countdownLabel ? <span className="codex-live-pnl__countdown">{countdownLabel}</span> : null}
        </div>
      </figcaption>
      <svg className="codex-live-pnl__chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="Live session profit and loss curve">
        <line className="codex-live-pnl__baseline" x1="0" y1="125" x2="1000" y2="125" />
        <polyline className="codex-live-pnl__line" points={polyline} fill="none" />
        {currentPoint ? (
          <circle
            className="codex-live-pnl__point"
            cx={currentPoint.x.toFixed(2)}
            cy={currentPoint.y.toFixed(2)}
            r="7"
          />
        ) : null}
      </svg>
    </figure>
  );
}
