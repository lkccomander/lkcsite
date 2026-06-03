import { HeaderData } from "../types";
import { formatCurrency, formatPercent, formatSigned } from "../lib/formatters";

interface HeaderBarProps {
  data: HeaderData;
}

export function HeaderBar({ data }: HeaderBarProps) {
  return (
    <header className="terminal-header panel">
      <div className="header-brand">
        <span className="status-dot" />
        <span className="header-brandline">OPUS 4.7 · MIROFISH · LIVE</span>
      </div>
      <div className="header-center">
        <div className="header-bot">{data.botId}</div>
        <div className="header-strategy">{data.strategyLabel}</div>
      </div>
      <div className="header-metrics">
        <span className="metric info">BTC {formatCurrency(data.btcPrice)}</span>
        <span className={`metric ${data.btcChange >= 0 ? "positive" : "negative"}`}>{formatSigned(data.btcChange)}</span>
        <span className="metric secondary">ETH {formatCurrency(data.ethPrice)}</span>
        <span className="metric">TRADES {data.trades30d.toLocaleString()}</span>
        <span className="metric positive">WIN {formatPercent(data.winRate)}</span>
        <span className="metric clock">{data.utcTime}</span>
      </div>
    </header>
  );
}
