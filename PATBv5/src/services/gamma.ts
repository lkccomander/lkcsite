export const getEvent = async (slug: string) => {
  const response = await fetch(
    `https://gamma-api.polymarket.com/events/slug/${slug}`
  );
  if (!response.ok) {
    throw new Error(`Gamma event request failed: ${response.status} ${response.statusText}`);
  }
  const event = await response.json();
  return event;
}

export const getMarket = async (slug: string) => {
  const response = await fetch(
    `https://gamma-api.polymarket.com/markets/slug/${slug}`
  );
  if (!response.ok) {
    throw new Error(`Gamma market request failed: ${response.status} ${response.statusText}`);
  }
  const market = await response.json();
  return market;
}

function extractEmbeddedNextData(html: string): unknown | null {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

interface MarketPageMetadata {
  priceToBeat: number | null;
  finalPrice: number | null;
  priceToBeatSource: string | null;
}

function findMarketMetadataBySlug(root: unknown, slug: string): MarketPageMetadata | null {
  const queue: unknown[] = [root];

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const record = current as Record<string, unknown>;
    if (record.slug === slug && typeof record.eventMetadata === "object" && record.eventMetadata !== null) {
      const metadata = record.eventMetadata as Record<string, unknown>;
      const rawPriceToBeat = Number(metadata.priceToBeat ?? NaN);
      const rawFinalPrice = Number(metadata.finalPrice ?? NaN);
      return {
        priceToBeat: Number.isFinite(rawPriceToBeat) ? rawPriceToBeat : null,
        finalPrice: Number.isFinite(rawFinalPrice) ? rawFinalPrice : null,
        priceToBeatSource: Number.isFinite(rawPriceToBeat) ? "polymarket_page_event_metadata" : null,
      };
    }

    queue.push(...Object.values(record));
  }

  return null;
}

function findPriceToBeatFromCryptoPrices(root: unknown): number | null {
  if (typeof root !== "object" || root === null) {
    return null;
  }

  const nextData = root as {
    props?: {
      pageProps?: {
        dehydratedState?: {
          queries?: Array<{
            queryKey?: unknown[];
            state?: {
              data?: {
                openPrice?: unknown;
              };
            };
          }>;
        };
      };
    };
  };

  const queries = nextData.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) {
    return null;
  }

  for (const query of queries) {
    if (!Array.isArray(query?.queryKey)) {
      continue;
    }

    if (query.queryKey[0] !== "crypto-prices" || query.queryKey[1] !== "price") {
      continue;
    }

    const rawOpenPrice = Number(query.state?.data?.openPrice ?? NaN);
    if (Number.isFinite(rawOpenPrice)) {
      return rawOpenPrice;
    }
  }

  return null;
}

export const getMarketPageMetadata = async (slug: string): Promise<{
  priceToBeat: number | null;
  finalPrice: number | null;
  priceToBeatSource: string | null;
}> => {
  const response = await fetch(`https://polymarket.com/event/${slug}`);
  if (!response.ok) {
    throw new Error(`Polymarket page request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const nextData = extractEmbeddedNextData(html);
  if (!nextData) {
    throw new Error("Polymarket page missing __NEXT_DATA__ payload");
  }

  const metadata = findMarketMetadataBySlug(nextData, slug) ?? {
    priceToBeat: null,
    finalPrice: null,
    priceToBeatSource: null,
  };

  if (metadata.priceToBeat !== null) {
    return metadata;
  }

  const openPrice = findPriceToBeatFromCryptoPrices(nextData);
  if (openPrice !== null) {
    return {
      priceToBeat: openPrice,
      finalPrice: metadata.finalPrice,
      priceToBeatSource: "polymarket_page_crypto_prices_open",
    };
  }

  return metadata;
}
