import { useMemo, useState } from "react";
import { HeaderBar } from "./components/HeaderBar";
import { LiveTape } from "./components/LiveTape";
import { WalletPanel } from "./components/WalletPanel";
import { MarketPanel } from "./components/MarketPanel";
import { BestTradePanel } from "./components/BestTradePanel";
import { ExecutionCycle } from "./components/ExecutionCycle";
import { ForceGraphPanel } from "./components/ForceGraphPanel";
import { PnlChart } from "./components/PnlChart";
import { RecentTrades } from "./components/RecentTrades";
import { LiveAnalytics } from "./components/LiveAnalytics";
import { useTerminalData } from "./hooks/useTerminalData";
import { useTradeActionSound } from "./hooks/useTradeActionSound";

function App() {
  const [mode, setMode] = useState<"mock" | "live">("mock");
  const { data, loading, error, stale } = useTerminalData(mode);
  useTradeActionSound(data?.liveTape ?? []);

  const statusLabel = useMemo(() => {
    if (loading) {
      return "SYNCING";
    }
    if (error) {
      return "FAULT";
    }
    if (stale || data?.meta.status === "degraded") {
      return "DEGRADED";
    }
    return "LOCKED";
  }, [data?.meta.status, error, loading, stale]);

  if (!data) {
    return (
      <main className="loading-shell">
        <div className="loading-panel">
          <div className="panel-kicker">PATBv5 TERMINAL GUI</div>
          <h1>{loading ? "Booting terminal shell..." : "State unavailable"}</h1>
          <p>{error || "Waiting for telemetry state."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="terminal-app">
      <div className="atmosphere-grid" />
      <HeaderBar data={data.header} />
      <div className="mode-rack panel">
        <div className="mode-controls">
          <button className={mode === "mock" ? "mode-button active" : "mode-button"} onClick={() => setMode("mock")}>MOCK FEED</button>
          <button className={mode === "live" ? "mode-button active" : "mode-button"} onClick={() => setMode("live")}>LIVE FEED</button>
        </div>
        <div className="mode-status">
          <span className={`badge ${statusLabel === "FAULT" ? "danger" : statusLabel === "DEGRADED" ? "warning" : "positive"}`}>{statusLabel}</span>
          <span>{data.meta.note || "Terminal state online"}</span>
        </div>
      </div>
      <LiveTape items={data.liveTape} />
      <section className="dashboard-grid">
        <WalletPanel data={data.wallet} />
        <MarketPanel candles={data.btcChart} orderBook={data.orderBook} btcPrice={data.header.btcPrice} btcChange={data.header.btcChange} />
        <BestTradePanel data={data.bestTrade} />
        <ExecutionCycle data={data.executionCycle} />
        <ForceGraphPanel data={data.forceGraph} />
        <PnlChart points={data.pnlHistory} />
        <RecentTrades trades={data.recentTrades} />
        <LiveAnalytics data={data.analytics} />
      </section>
    </main>
  );
}

export default App;
