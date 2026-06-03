import { Candle, OrderBookData } from "../types";
import { formatCurrency, formatSigned } from "../lib/formatters";

interface MarketPanelProps {
  candles: Candle[];
  orderBook: OrderBookData;
  btcPrice: number;
  btcChange: number;
}

export function MarketPanel({ candles, orderBook, btcPrice, btcChange }: MarketPanelProps) {
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = Math.max(max - min, 1);

  return (
    <section className="panel market-panel">
      <div className="market-header">
        <div className="market-title">BTC · 5M {formatCurrency(btcPrice)} <span className={btcChange >= 0 ? "positive" : "negative"}>{formatSigned(btcChange, 1)}</span></div>
        <div className="market-book-title">ORDER BOOK · BTC L2 {formatCurrency(btcPrice)} SPREAD {formatSigned(orderBook.spread)} {orderBook.bidShare}% BID</div>
      </div>
      <div className="market-layout">
        <div className="market-chart">
          <svg viewBox="0 0 620 240" className="chart-svg" aria-label="BTC Candles">
            {Array.from({ length: 5 }, (_, row) => (
              <line key={`grid-y-${row}`} x1="0" x2="620" y1={20 + row * 50} y2={20 + row * 50} className="chart-grid" />
            ))}
            {candles.map((candle, index) => {
              const x = 20 + index * 28;
              const openY = 200 - ((candle.open - min) / range) * 160;
              const closeY = 200 - ((candle.close - min) / range) * 160;
              const highY = 200 - ((candle.high - min) / range) * 160;
              const lowY = 200 - ((candle.low - min) / range) * 160;
              const y = Math.min(openY, closeY);
              const height = Math.max(Math.abs(openY - closeY), 4);
              const positive = candle.close >= candle.open;
              return (
                <g key={candle.time}>
                  <line x1={x + 8} x2={x + 8} y1={highY} y2={lowY} className={positive ? "candle-wick positive" : "candle-wick negative"} />
                  <rect x={x} y={y} width={16} height={height} className={positive ? "candle-body positive" : "candle-body negative"} />
                  {candle.marker ? (
                    <text x={x + 8} y={positive ? y - 8 : y + height + 14} textAnchor="middle" className="trade-marker">
                      {candle.marker === "UP" ? "▲" : "▼"}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
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
