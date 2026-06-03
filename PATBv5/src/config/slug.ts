/**
 * Time bucket calculations for Polymarket crypto markets
 * Matches the Rust implementation for market slug generation
 */

export interface TimeBucket {
  slug: string;
  endTimestamp: number;
}

function getBucketPrefix(coin: string, minutes: number): string {
  switch (coin) {
    case "btc":
      switch (minutes) {
        case 5: return "btc-updown-5m";
        case 15: return "btc-updown-15m";
        case 60: return "bitcoin-up-or-down";
        case 240: return "btc-updown-4h";
        case 1440: return "bitcoin-up-or-down-on";
        default: throw new Error(`Invalid minutes for BTC: ${minutes}`);
      }
    case "eth":
      switch (minutes) {
        case 15: return "eth-updown-15m";
        case 60: return "ethereum-up-or-down";
        case 240: return "eth-updown-4h";
        case 1440: return "ethereum-up-or-down-on";
        default: throw new Error(`Invalid minutes for ETH: ${minutes}`);
      }
    case "sol":
      switch (minutes) {
        case 15: return "sol-updown-15m";
        case 60: return "solana-up-or-down";
        case 240: return "sol-updown-4h";
        case 1440: return "solana-up-or-down-on";
        default: throw new Error(`Invalid minutes for SOL: ${minutes}`);
      }
    case "xrp":
      switch (minutes) {
        case 15: return "xrp-updown-15m";
        case 60: return "xrp-up-or-down";
        case 240: return "xrp-updown-4h";
        case 1440: return "xrp-up-or-down-on";
        default: throw new Error(`Invalid minutes for XRP: ${minutes}`);
      }
    default:
      throw new Error(`Invalid coin: ${coin}`);
  }
}

/**
 * 15-minute bucket - simple interval rounding
 */
export function crypto5mBucket(now = Math.floor(Date.now() / 1000)): TimeBucket {
  const INTERVAL_SECS = 5 * 60; // 300 seconds

  const start = Math.floor(now / INTERVAL_SECS) * INTERVAL_SECS;
  const end = start + INTERVAL_SECS;

  return {
    slug: start.toString(),
    endTimestamp: end,
  };
}
export function crypto15mBucket(now = Math.floor(Date.now() / 1000)): TimeBucket {
  const INTERVAL_SECS = 15 * 60; // 900 seconds

  const start = Math.floor(now / INTERVAL_SECS) * INTERVAL_SECS;
  const end = start + INTERVAL_SECS;

  return {
    slug: start.toString(),
    endTimestamp: end,
  };
}

/**
 * 1-hour bucket with ET timezone and DST handling
 */
export function crypto1hrBucket(now = Math.floor(Date.now() / 1000)): TimeBucket {
  const INTERVAL_SECS = 60 * 60; // 3600 seconds

  const nowDate = new Date(now * 1000);
  const nowUtc = new Date(nowDate.toISOString());

  // DST heuristic (same as Rust version)
  const month = nowUtc.getUTCMonth() + 1; // getUTCMonth returns 0-11
  const isDst = month > 3 && month < 11;
  const etOffsetHours = isDst ? -4 : -5;

  // Convert to ET time
  const etTime = new Date(nowUtc.getTime() + etOffsetHours * 60 * 60 * 1000);

  // Round down to the previous ET hour (markets are for the hour before the current hour)
  // If we're at 4:30 AM ET, we want the 3:00 AM ET market (which ends at 4:00 AM)
  const etHourStart = new Date(etTime);
  etHourStart.setUTCMinutes(0, 0, 0);

  // Convert ET hour start back to UTC by subtracting the offset
  const utcHourStart = new Date(etHourStart.getTime() - etOffsetHours * 60 * 60 * 1000);
  const start = Math.floor(utcHourStart.getTime() / 1000);
  const end = start + INTERVAL_SECS;

  // Format time string
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  const monthName = monthNames[etHourStart.getUTCMonth()];
  const day = etHourStart.getUTCDate();
  let hour = etHourStart.getUTCHours();

  let timeStr: string;
  if (hour === 0) {
    timeStr = "12am";
  } else if (hour < 12) {
    timeStr = `${hour}am`;
  } else if (hour === 12) {
    timeStr = "12pm";
  } else {
    timeStr = `${hour - 12}pm`;
  }

  return {
    slug: `${monthName}-${day}-${timeStr}-et`,
    endTimestamp: end,
  };
}

/**
 * 4-hour bucket with 1 hour offset
 */
export function crypto4hBucket(now = Math.floor(Date.now() / 1000)): TimeBucket {
  const INTERVAL_SECS = 4 * 60 * 60; // 14400 seconds (4 hours)
  const OFFSET_SECS = 1 * 60 * 60; // 3600 seconds (1 hour offset to align to 01:00, 05:00, 09:00, etc.)

  // Subtract offset, calculate bucket, then add offset back
  const adjustedSecs = now - OFFSET_SECS;
  const bucketStart = Math.floor(adjustedSecs / INTERVAL_SECS) * INTERVAL_SECS;
  const start = bucketStart + OFFSET_SECS;
  const end = start + INTERVAL_SECS;

  return {
    slug: start.toString(),
    endTimestamp: end,
  };
}

/**
 * 1-day bucket
 */
export function crypto1dayBucket(now = Math.floor(Date.now() / 1000)): TimeBucket {
  const INTERVAL_SECS = 24 * 60 * 60; // 86400 seconds

  const start = Math.floor(now / INTERVAL_SECS) * INTERVAL_SECS;
  const end = start + INTERVAL_SECS;

  const nowUtc = new Date(start * 1000);
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  const monthName = monthNames[nowUtc.getUTCMonth()];
  const day = nowUtc.getUTCDate();

  return {
    slug: `${monthName}-${day}`,
    endTimestamp: end,
  };
}

/**
 * Get current Unix timestamp in seconds
 */
export function currentTime(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Generate market slug based on coin and minutes
 */
export function generateMarketSlug(coin: string, minutes: number): TimeBucket {
  return generateMarketSlugAt(coin, minutes, currentTime());
}

export function generateMarketSlugAt(coin: string, minutes: number, now: number): TimeBucket {
  const prefix = getBucketPrefix(coin, minutes);

  const bucket = (() => {
    switch (minutes) {
      case 5: return crypto5mBucket(now);
      case 15: return crypto15mBucket(now);
      case 60: return crypto1hrBucket(now);
      case 240: return crypto4hBucket(now);
      case 1440: return crypto1dayBucket(now);
      default: throw new Error(`Invalid minutes: ${minutes}`);
    }
  })();

  return {
    slug: `${prefix}-${bucket.slug}`,
    endTimestamp: bucket.endTimestamp,
  };
}

export function generateNextMarketSlug(coin: string, minutes: number, currentEndTimestamp: number): TimeBucket {
  return generateMarketSlugAt(coin, minutes, currentEndTimestamp + 1);
}
