import assert from "node:assert/strict";
import { filterActivityFeed, nextFeedTab } from "../newGui/src/lib/activityFeed";
import type { ActivityEvent } from "../newGui/src/types";

const base = { timestamp: "2026-07-16T21:00:00.000Z", market: null, detail: "event", amountUsd: null, pnlUsd: null };
const events: ActivityEvent[] = [
  { ...base, id: "trade", category: "trade", action: "BUY", tone: "info" },
  { ...base, id: "reject", category: "rejection", action: "REJECT", tone: "negative" },
  { ...base, id: "feed", category: "feed", action: "FEED", tone: "warning" },
];

assert.deepEqual(filterActivityFeed(events, "trades").map((event) => event.id), ["trade", "reject"]);
assert.deepEqual(filterActivityFeed(events, "all").map((event) => event.id), ["trade", "reject", "feed"]);
assert.equal(nextFeedTab("trades", "ArrowRight"), "all");
assert.equal(nextFeedTab("all", "ArrowLeft"), "trades");
assert.equal(nextFeedTab("all", "Home"), "trades");
assert.equal(nextFeedTab("trades", "End"), "all");
