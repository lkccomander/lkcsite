import assert from "node:assert/strict";
import { filterActivityFeed, MAX_ACTIVITY_FEED_ITEMS, nextFeedTab } from "../newGui/src/lib/activityFeed";
import type { ActivityEvent } from "../newGui/src/types";

const base = { timestamp: "2026-07-16T21:00:00.000Z", market: null, detail: "event", amountUsd: null, pnlUsd: null };
const events: ActivityEvent[] = [
  { ...base, id: "trade", category: "trade", action: "BUY", tone: "info" },
  { ...base, id: "reject", category: "rejection", action: "REJECT", tone: "negative" },
  { ...base, id: "feed", category: "feed", action: "FEED", tone: "warning" },
];

assert.deepEqual(filterActivityFeed(events, "trades").map((event) => event.id), ["trade", "reject"]);
assert.deepEqual(filterActivityFeed(events, "all").map((event) => event.id), ["trade", "reject", "feed"]);

const longEvents: ActivityEvent[] = Array.from({ length: MAX_ACTIVITY_FEED_ITEMS + 5 }, (_, index) => ({
  ...base,
  id: `event-${index}`,
  timestamp: `2026-07-16T21:00:${String(index).padStart(2, "0")}.000Z`,
  category: index % 3 === 0 ? "feed" : "trade",
  action: index % 3 === 0 ? "FEED" : "BUY",
  tone: index % 3 === 0 ? "warning" : "info",
}));
assert.equal(filterActivityFeed(longEvents, "all").length, MAX_ACTIVITY_FEED_ITEMS);
assert.deepEqual(
  filterActivityFeed(longEvents, "all").map((event) => event.id),
  longEvents.slice(0, MAX_ACTIVITY_FEED_ITEMS).map((event) => event.id),
);
const expectedTradeEvents = longEvents
  .filter((event) => event.category !== "feed")
  .slice(0, MAX_ACTIVITY_FEED_ITEMS);
assert.equal(filterActivityFeed(longEvents, "trades").length, expectedTradeEvents.length);
assert.deepEqual(
  filterActivityFeed(longEvents, "trades").map((event) => event.id),
  expectedTradeEvents.map((event) => event.id),
);
assert.ok(filterActivityFeed(longEvents, "trades").every((event) => event.category !== "feed"));
assert.equal(nextFeedTab("trades", "ArrowRight"), "all");
assert.equal(nextFeedTab("all", "ArrowLeft"), "trades");
assert.equal(nextFeedTab("all", "Home"), "trades");
assert.equal(nextFeedTab("trades", "End"), "all");
