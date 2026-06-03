import { BestTradeData } from "../types";
import { formatCurrency } from "../lib/formatters";

interface BestTradePanelProps {
  data: BestTradeData;
}

export function BestTradePanel({ data }: BestTradePanelProps) {
  return (
    <section className="panel best-trade-panel">
      <div className="panel-topline">
        <div className="panel-kicker">{data.title} <span className="muted">{data.timeframeLabel}</span></div>
        <span className="badge warning">40m · LIVE</span>
      </div>
      <div className="best-trade-note">LAST BIG: {formatCurrency(data.lastBigPnl, 0)} · {data.lastBigTrades} TRADES</div>
      <div className="best-trade-featured">{formatCurrency(data.featuredPnl, 0)}</div>
      <div className="best-trade-days">
        {data.days.map((day) => (
          <div key={day.label} className="best-trade-day">
            <span>{day.label}</span>
            <span>{formatCurrency(day.pnl, 0)}</span>
            <span>{day.trades.toLocaleString()} TRADES</span>
          </div>
        ))}
      </div>
    </section>
  );
}
