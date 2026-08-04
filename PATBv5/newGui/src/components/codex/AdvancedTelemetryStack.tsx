import React from "react";
import { ExecutionCycle } from "../ExecutionCycle";
import { ForceGraphPanel } from "../ForceGraphPanel";
import { LiveAnalytics } from "../LiveAnalytics";
import { MarketPanel } from "../MarketPanel";
import { RecentTrades } from "../RecentTrades";
import type { TerminalState } from "../../types";

interface AdvancedTelemetryStackProps {
  data: TerminalState;
}

export function AdvancedTelemetryStack({ data }: AdvancedTelemetryStackProps) {
  return (
    <section className="codex-advanced-grid" aria-label="Advanced telemetry">
      <h2 className="codex-advanced-grid__title">BTC MARKET</h2>
      <MarketPanel candles={data.btcChart} volumeBars={data.btcVolume} orderBook={data.orderBook} btcPrice={data.header.btcPrice} btcChange={data.header.btcChange} />
      <ExecutionCycle data={data.executionCycle} />
      <ForceGraphPanel data={data.forceGraph} />
      <RecentTrades trades={data.recentTrades} />
      <LiveAnalytics data={data.analytics} />
    </section>
  );
}
