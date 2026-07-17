import React from "react";
import { formatCurrency } from "../../lib/formatters";
import type { SessionSummary } from "../../types";

interface LiveSessionPnlProps {
  summary: SessionSummary;
}

function toPolyline(points: SessionSummary["pnlHistory"], width = 1000, height = 250): string {
  if (points.length < 2) return `0,${height / 2} ${width},${height / 2}`;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.value - min) / span) * (height - 24) - 12;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
}

export function LiveSessionPnl({ summary }: LiveSessionPnlProps) {
  const pnlTone = summary.realizedPnl > 0 ? "positive" : summary.realizedPnl < 0 ? "negative" : "neutral";

  return (
    <figure className={`codex-live-pnl ${pnlTone}`}>
      <figcaption className="codex-live-pnl__header">
        <span className="codex-live-pnl__label">LIVE SESSION P&amp;L</span>
        <strong className="codex-live-pnl__value">{formatSignedCurrency(summary.realizedPnl)}</strong>
      </figcaption>
      <svg className="codex-live-pnl__chart" viewBox="0 0 1000 250" role="img" aria-label="Live session profit and loss curve">
        <line className="codex-live-pnl__baseline" x1="0" y1="125" x2="1000" y2="125" />
        <polyline className="codex-live-pnl__line" points={toPolyline(summary.pnlHistory)} fill="none" />
      </svg>
    </figure>
  );
}
