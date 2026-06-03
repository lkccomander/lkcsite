import { PnLPoint } from "../types";
import { formatCurrency } from "../lib/formatters";

interface PnlChartProps {
  points: PnLPoint[];
}

export function PnlChart({ points }: PnlChartProps) {
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const range = Math.max(max - min, 1);
  const plotted = points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * 280;
    const y = 140 - ((point.value - min) / range) * 112;
    return `${x},${y}`;
  });

  return (
    <section className="panel pnl-panel">
      <div className="panel-kicker">PnL CHART</div>
      <svg viewBox="0 0 280 160" className="pnl-svg">
        <defs>
          <linearGradient id="pnl-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(0,255,136,0.55)" />
            <stop offset="100%" stopColor="rgba(0,255,136,0.02)" />
          </linearGradient>
        </defs>
        {Array.from({ length: 4 }, (_, index) => (
          <line key={index} x1="0" x2="280" y1={20 + index * 34} y2={20 + index * 34} className="chart-grid" />
        ))}
        <polygon points={`0,140 ${plotted.join(" ")} 280,140`} fill="url(#pnl-fill)" />
        <polyline points={plotted.join(" ")} className="pnl-line" />
      </svg>
      <div className="pnl-axis">
        <span>{formatCurrency(max, 0)}</span>
        <span>{formatCurrency((max + min) / 2, 0)}</span>
        <span>{formatCurrency(min, 0)}</span>
      </div>
    </section>
  );
}
