import { WalletData } from "../types";
import { formatCompactNumber, formatCurrency, formatPercent, truncateMiddle } from "../lib/formatters";

interface WalletPanelProps {
  data: WalletData;
}

export function WalletPanel({ data }: WalletPanelProps) {
  return (
    <section className="panel wallet-panel">
      <div className="panel-topline">
        <div>
          <div className="panel-kicker">{data.alias}</div>
          <div className="wallet-address">{truncateMiddle(data.walletAddress, 10, 8)}</div>
          <div className="wallet-venue">{data.venue}</div>
        </div>
        <span className="badge">{data.liveBadge}</span>
      </div>

      <div className="panel-section-label">30-DAY PnL</div>
      <div className="wallet-pnl">{formatCurrency(data.pnl30d, 0)}</div>

      <div className="wallet-subline">30 DAYS · {data.trades30d.toLocaleString()} TRADES</div>

      <div className="wallet-stats-grid">
        <div>
          <div className="stat-label">TRADES</div>
          <div className="stat-value">{formatCompactNumber(data.trades30d)}</div>
        </div>
        <div>
          <div className="stat-label">WIN%</div>
          <div className="stat-value positive">{formatPercent(data.winRate)}</div>
        </div>
        <div>
          <div className="stat-label">AVG R:R</div>
          <div className="stat-value">{data.avgRiskReward.toFixed(2)}</div>
        </div>
      </div>

      <div className="wallet-balance">
        <span className="stat-label">BALANCE</span>
        <span className="stat-value">{formatCurrency(data.balance)}</span>
      </div>
    </section>
  );
}
