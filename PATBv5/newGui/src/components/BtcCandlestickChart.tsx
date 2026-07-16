import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineStyle,
  MouseEventParams,
  UTCTimestamp,
} from "lightweight-charts";
import { Candle, VolumeBar } from "../types";

interface BtcCandlestickChartProps {
  candles: Candle[];
  volumeBars: VolumeBar[];
  currentPrice: number;
}

interface HoveredCandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  timeLabel: string;
}

function toChartData(candles: Candle[]) {
  return candles.map((candle) => ({
    time: Math.floor(new Date(candle.time).getTime() / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

export function BtcCandlestickChart({ candles, volumeBars, currentPrice }: BtcCandlestickChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const priceLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const [hoveredCandle, setHoveredCandle] = useState<HoveredCandleData | null>(null);

  const activeCandle = useMemo<HoveredCandleData | null>(() => {
    if (hoveredCandle) {
      return hoveredCandle;
    }

    const latest = candles[candles.length - 1];
    if (!latest) {
      return null;
    }

    return {
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      timeLabel: new Date(latest.time).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }, [candles, hoveredCandle]);

  const activeDelta = activeCandle ? activeCandle.close - activeCandle.open : 0;
  const activeDeltaPct = activeCandle && activeCandle.open !== 0 ? (activeDelta / activeCandle.open) * 100 : 0;

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const chart = createChart(hostRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#111111" },
        textColor: "#a7abae",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.12)",
        textColor: "#8f9498",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.12)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(214, 217, 220, 0.55)",
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: "#1d1f22",
        },
        horzLine: {
          color: "rgba(214, 217, 220, 0.55)",
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: "#1d1f22",
        },
      },
      localization: {
        priceFormatter: (value: number) => value.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#00c087",
      downColor: "#ff5b4f",
      borderVisible: false,
      wickUpColor: "#00c087",
      wickDownColor: "#ff5b4f",
      priceLineVisible: false,
      lastValueVisible: true,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    }, 1);

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;

    const handleCrosshairMove = (param: MouseEventParams) => {
      const candleData = param.seriesData.get(series);
      if (!candleData || !("open" in candleData)) {
        setHoveredCandle(null);
        return;
      }

      setHoveredCandle({
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        timeLabel: typeof candleData.time === "number"
          ? new Date(candleData.time * 1000).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })
          : String(candleData.time),
      });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    resizeObserverRef.current = new ResizeObserver(() => {
      chart.timeScale().fitContent();
    });
    resizeObserverRef.current.observe(hostRef.current);
    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setStretchFactor(0.78);
      panes[1].setStretchFactor(0.22);
    }

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      priceLineRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) {
      return;
    }

    if (!candles.length) {
      series.setData([]);
      return;
    }

    series.setData(toChartData(candles));
    chart.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const volumeSeries = volumeSeriesRef.current;
    if (!volumeSeries) {
      return;
    }

    volumeSeries.setData(
      volumeBars.map((bar) => ({
        time: Math.floor(new Date(bar.time).getTime() / 1000) as UTCTimestamp,
        value: bar.value,
        color: bar.color,
      })),
    );
  }, [volumeBars]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !Number.isFinite(currentPrice)) {
      return;
    }

    if (priceLineRef.current) {
      series.removePriceLine(priceLineRef.current);
    }

    priceLineRef.current = series.createPriceLine({
      price: currentPrice,
      color: "#00c087",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: "BTC",
    });
  }, [currentPrice]);

  return (
    <div className="tv-chart-shell">
      <div ref={hostRef} className="tv-chart-host" />
      {!candles.length ? (
        <div className="tv-chart-overlay">Waiting for telemetry candles...</div>
      ) : null}
      {activeCandle ? (
        <div className="tv-ohlc-strip">
          <span className="tv-ohlc-strip__symbol">BTC/USD</span>
          <span>{activeCandle.timeLabel}</span>
          <span>O {activeCandle.open.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span>H {activeCandle.high.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span>L {activeCandle.low.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span>C {activeCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className={activeDelta >= 0 ? "positive" : "negative"}>
            {activeDelta >= 0 ? "+" : "-"}{Math.abs(activeDelta).toFixed(2)} ({activeDeltaPct >= 0 ? "+" : "-"}{Math.abs(activeDeltaPct).toFixed(2)}%)
          </span>
        </div>
      ) : null}
      <div className="tv-volume-label">Volume · Binance 1m telemetry</div>
    </div>
  );
}
