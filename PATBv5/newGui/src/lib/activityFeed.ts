import type { ActivityEvent } from "../types";

export type ActivityFilter = "trades" | "all";

export function filterActivityFeed(events: ActivityEvent[], filter: ActivityFilter): ActivityEvent[] {
  return filter === "all" ? events : events.filter((event) => event.category !== "feed");
}

export function nextFeedTab(current: ActivityFilter, key: string): ActivityFilter {
  if (key === "Home") return "trades";
  if (key === "End") return "all";
  if (key === "ArrowLeft" || key === "ArrowRight") return current === "trades" ? "all" : "trades";
  return current;
}
