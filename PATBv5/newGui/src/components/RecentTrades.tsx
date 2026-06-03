import { TradeRow } from "../types";
import { formatCurrency, formatPercent } from "../lib/formatters";

interface RecentTradesProps {
  trades: TradeRow[];
}

export function RecentTrades({ trades }: RecentTradesProps) {
  return (
    <section className="panel recent-trades-panel">
      <div className="panel-topline">
        <div className="panel-kicker">RECENT TRADES</div>
        <div className="muted">1,350 / 300</div>
      </div>
      <div className="trades-table">
        <div className="trades-head">
          <span>#</span>
          <span>SIDE</span>
          <span>PRICE</span>
          <span>WIN%</span>
          <span>PNL</span>
        </div>
        {trades.map((trade) => (
          <div key={trade.id} className={`trades-row ${trade.status.toLowerCase()}`}>
            <span>{trade.offset}</span>
            <span>{trade.side}</span>
            <span>{formatCurrency(trade.price, 0)}</span>
            <span>{formatPercent(trade.confidence)}</span>
            <span>{trade.pnl == null ? "OPEN" : formatCurrency(trade.pnl, 0)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
