import { Candle, OrderBookData, VolumeBar } from "../types";
import { formatCurrency, formatSigned } from "../lib/formatters";
import { BtcCandlestickChart } from "./BtcCandlestickChart";

interface MarketPanelProps {
  candles: Candle[];
  volumeBars: VolumeBar[];
  orderBook: OrderBookData;
  btcPrice: number;
  btcChange: number;
}

export function MarketPanel({ candles, volumeBars, orderBook, btcPrice, btcChange }: MarketPanelProps) {
  const firstClose = candles[0]?.close ?? btcPrice;
  const lastCandle = candles[candles.length - 1];
  const priceChange = lastCandle ? lastCandle.close - firstClose : btcChange;
  const percentChange = firstClose ? (priceChange / firstClose) * 100 : 0;

  return (
    <section className="panel market-panel">
      <div className="market-header">
        <div>
          <div className="market-eyebrow">BTC/USD · 5M · TELEMETRY</div>
          <div className="market-title">
            <span className="market-title__symbol">BTC/USD</span>
            <span className="market-title__price">{formatCurrency(btcPrice)}</span>
            <span className={priceChange >= 0 ? "positive" : "negative"}>{formatSigned(priceChange, 2)} ({formatSigned(percentChange, 2)}%)</span>
          </div>
          {lastCandle ? (
            <div className="market-ohlc">
              <span>O {lastCandle.open.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span>H {lastCandle.high.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span>L {lastCandle.low.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span>C {lastCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          ) : null}
        </div>
        <div className="market-book-title">ORDER BOOK · BTC L2 {formatCurrency(btcPrice)} SPREAD {formatSigned(orderBook.spread)} {orderBook.bidShare}% BID</div>
      </div>
      <div className="market-layout">
        <div className="market-chart-shell">
          <div className="market-chart">
            <BtcCandlestickChart candles={candles} volumeBars={volumeBars} currentPrice={btcPrice} />
          </div>
          <div className="market-chart-meta">
            <span>Telemetry candles from `market.external_reference`</span>
            <span>{candles.length} bars</span>
          </div>
        </div>
        <div className="order-book">
          <div className="order-book-columns">
            <span>BIDS</span>
            <span>ASKS</span>
          </div>
          <div className="order-book-grid">
            <div>
              {orderBook.bids.map((level) => (
                <div key={`bid-${level.price}`} className="order-book-row bid" style={{ ["--depth" as string]: `${Math.min(level.size / 30, 1)}` }}>
                  <span>{level.price.toFixed(2)}</span>
                  <span>{level.size.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div>
              {orderBook.asks.map((level) => (
                <div key={`ask-${level.price}`} className="order-book-row ask" style={{ ["--depth" as string]: `${Math.min(level.size / 30, 1)}` }}>
                  <span>{level.price.toFixed(2)}</span>
                  <span>{level.size.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
