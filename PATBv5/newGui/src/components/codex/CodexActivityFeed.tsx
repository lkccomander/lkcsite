import React, { useRef, useState, type KeyboardEvent } from "react";
import {
  filterActivityFeed,
  MAX_ACTIVITY_FEED_ITEMS,
  nextFeedTab,
  type ActivityFilter,
} from "../../lib/activityFeed";
import type { ActivityEvent } from "../../types";

interface CodexActivityFeedProps {
  events: ActivityEvent[];
}

const navigationKeys = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

function formatTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toISOString().slice(11, 19);
}

function formatUsd(value: number | null, signed = false): string {
  if (value == null) return "—";
  const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function CodexActivityFeed({ events }: CodexActivityFeedProps) {
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>("trades");
  const tradesTabRef = useRef<HTMLButtonElement>(null);
  const allTabRef = useRef<HTMLButtonElement>(null);
  const filteredEvents = filterActivityFeed(events, activeFilter).slice(0, MAX_ACTIVITY_FEED_ITEMS);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!navigationKeys.has(event.key)) return;
    event.preventDefault();
    const nextFilter = nextFeedTab(activeFilter, event.key);
    setActiveFilter(nextFilter);
    const nextTab = nextFilter === "trades" ? tradesTabRef.current : allTabRef.current;
    nextTab?.focus();
  }

  return (
    <section className="codex-activity" aria-labelledby="codex-activity-title">
      <div className="codex-activity__heading">
        <h2 id="codex-activity-title">TRADE FEED</h2>
        <div className="codex-tabs" role="tablist" aria-label="Activity feed filters">
          <button
            ref={tradesTabRef}
            id="codex-tab-trades"
            className="codex-tab"
            type="button"
            role="tab"
            aria-controls="codex-activity-panel"
            aria-selected={activeFilter === "trades"}
            tabIndex={activeFilter === "trades" ? 0 : -1}
            onClick={() => setActiveFilter("trades")}
            onKeyDown={handleTabKeyDown}
          >
            TRADES
          </button>
          <button
            ref={allTabRef}
            id="codex-tab-all"
            className="codex-tab"
            type="button"
            role="tab"
            aria-controls="codex-activity-panel"
            aria-selected={activeFilter === "all"}
            tabIndex={activeFilter === "all" ? 0 : -1}
            onClick={() => setActiveFilter("all")}
            onKeyDown={handleTabKeyDown}
          >
            ALL
          </button>
        </div>
      </div>

      <div
        id="codex-activity-panel"
        role="tabpanel"
        aria-labelledby={activeFilter === "trades" ? "codex-tab-trades" : "codex-tab-all"}
      >
        {filteredEvents.length === 0 ? (
          <p className="codex-activity__empty">NO SESSION ACTIVITY YET</p>
        ) : (
          <ol className="codex-activity__list">
            {filteredEvents.map((event) => (
              <li key={event.id} className="codex-event" data-tone={event.tone}>
                <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
                <strong>{event.action}</strong>
                <span className="codex-event__detail">
                  {event.market ? `${event.market} · ` : ""}{event.detail}
                </span>
                <span className="codex-event__amount" aria-label="Amount">
                  {formatUsd(event.amountUsd)}
                </span>
                <span className="codex-event__pnl" aria-label="Profit and loss">
                  {formatUsd(event.pnlUsd, true)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
