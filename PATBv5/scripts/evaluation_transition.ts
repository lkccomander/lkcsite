type TelemetryEvent = {
  type?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
};

export const TRANSITION_WINDOW_MS = 3000;

type TransitionMarker = {
  timestampMs: number;
  marketSlug: string | null;
  source: string;
};

export type TransitionDiagnostics = {
  transitionWindowMs: number;
  markers: TransitionMarker[];
  transitionRelatedFallbacks: number;
  transitionRelatedRecoveries: number;
  transitionRelatedRejects: number;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function eventTimestampMs(event: TelemetryEvent): number | null {
  const timestamp = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function eventMarketSlug(event: TelemetryEvent): string | null {
  const payload = event.payload ?? {};
  return asString(payload.marketSlug) ?? asString(payload.slug);
}

function rejectionReason(event: TelemetryEvent): string | null {
  return asString(event.payload?.reason);
}

function isTransitionMarker(event: TelemetryEvent): string | null {
  if (event.type === "market.selected") {
    return "market.selected";
  }
  const reason = rejectionReason(event);
  if (event.type === "trade.signal_rejected" && reason === "market_transition_grace") {
    return "trade.signal_rejected:market_transition_grace";
  }
  if (event.type === "feed.fallback" && reason === "subscription_missing") {
    return "feed.fallback:subscription_missing";
  }
  return null;
}

function isTransitionCandidate(event: TelemetryEvent): boolean {
  const reason = rejectionReason(event);
  if (event.type === "feed.disconnected") {
    return true;
  }
  if (event.type === "feed.fallback" && reason === "subscription_missing") {
    return true;
  }
  if (event.type === "feed.fallback_recovered" && reason === "subscription_missing") {
    return true;
  }
  if (event.type === "trade.signal_rejected" && (
    reason === "market_transition_grace"
    || reason === "recent_ws_fallback"
    || reason === "max_feed_age_ms"
  )) {
    return true;
  }
  return false;
}

function markerAppliesToEvent(marker: TransitionMarker, eventSlug: string | null): boolean {
  if (!marker.marketSlug || !eventSlug) {
    return true;
  }
  return marker.marketSlug === eventSlug;
}

export function buildTransitionDiagnostics(events: TelemetryEvent[], transitionWindowMs = TRANSITION_WINDOW_MS): TransitionDiagnostics {
  const sortedEvents = [...events].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const markers: TransitionMarker[] = [];
  let transitionRelatedFallbacks = 0;
  let transitionRelatedRecoveries = 0;
  let transitionRelatedRejects = 0;

  for (const event of sortedEvents) {
    const markerSource = isTransitionMarker(event);
    const timestampMs = eventTimestampMs(event);
    if (markerSource && timestampMs !== null) {
      markers.push({
        timestampMs,
        marketSlug: eventMarketSlug(event),
        source: markerSource,
      });
    }

    if (!isTransitionCandidate(event) || timestampMs === null) {
      continue;
    }

    const slug = eventMarketSlug(event);
    const inTransitionWindow = markers.some((marker) =>
      marker.timestampMs <= timestampMs
      && timestampMs - marker.timestampMs <= transitionWindowMs
      && markerAppliesToEvent(marker, slug),
    );

    if (!inTransitionWindow) {
      continue;
    }

    if (event.type === "feed.fallback") {
      transitionRelatedFallbacks += 1;
    } else if (event.type === "feed.fallback_recovered") {
      transitionRelatedRecoveries += 1;
    } else if (event.type === "trade.signal_rejected") {
      transitionRelatedRejects += 1;
    }
  }

  return {
    transitionWindowMs,
    markers,
    transitionRelatedFallbacks,
    transitionRelatedRecoveries,
    transitionRelatedRejects,
  };
}

export function isTransitionRelatedEvent(
  event: TelemetryEvent,
  diagnostics: TransitionDiagnostics,
): boolean {
  if (!isTransitionCandidate(event)) {
    return false;
  }
  const timestampMs = eventTimestampMs(event);
  if (timestampMs === null) {
    return false;
  }
  const slug = eventMarketSlug(event);
  return diagnostics.markers.some((marker) =>
    marker.timestampMs <= timestampMs
    && timestampMs - marker.timestampMs <= diagnostics.transitionWindowMs
    && markerAppliesToEvent(marker, slug),
  );
}
