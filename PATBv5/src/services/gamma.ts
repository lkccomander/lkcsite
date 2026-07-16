import https from "node:https";

export interface RequestErrorDetails {
  error: string;
  errorName: string;
  errorCode: string | null;
  causeCode: string | null;
  causeMessage: string | null;
  status: number | null;
  url: string | null;
}

interface HttpRequestErrorOptions {
  code: string;
  status?: number | null;
  url?: string | null;
  cause?: unknown;
}

export class HttpRequestError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly url: string | null;
  override readonly cause?: unknown;

  constructor(message: string, options: HttpRequestErrorOptions) {
    super(message);
    this.name = "HttpRequestError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.url = options.url ?? null;
    this.cause = options.cause;
  }
}

export function describeRequestError(error: unknown): RequestErrorDetails {
  const record = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : null;
  const cause = record && typeof record.cause === "object" && record.cause !== null
    ? record.cause as Record<string, unknown>
    : null;
  return {
    error: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : typeof error,
    errorCode: typeof record?.code === "string" ? record.code : null,
    causeCode: typeof cause?.code === "string" ? cause.code : null,
    causeMessage: typeof cause?.message === "string" ? cause.message : null,
    status: typeof record?.status === "number" ? record.status : null,
    url: typeof record?.url === "string" ? record.url : null,
  };
}

export function requestText(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
  const maxBytes = Math.max(1, options.maxBytes ?? 2_000_000);

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      maxHeaderSize: 64 * 1024,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "PATBv5/1.0 (+https://polymarket.com)",
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new HttpRequestError(
          `Polymarket page request failed: ${status} ${response.statusMessage ?? "Unknown Status"}`,
          { code: "HTTP_STATUS_ERROR", status, url },
        ));
        return;
      }

      const chunks: Buffer[] = [];
      let byteLength = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += buffer.length;
        if (byteLength > maxBytes) {
          response.destroy(new HttpRequestError(
            `Polymarket page response exceeded ${maxBytes} bytes`,
            { code: "RESPONSE_TOO_LARGE", status, url },
          ));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", (cause) => reject(new HttpRequestError(
        `Polymarket page response failed: ${cause.message}`,
        { code: "RESPONSE_ERROR", status, url, cause },
      )));
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new HttpRequestError(
        `Polymarket page request timed out after ${timeoutMs}ms`,
        { code: "REQUEST_TIMEOUT", url },
      ));
    });
    request.on("error", (cause) => {
      if (cause instanceof HttpRequestError) {
        reject(cause);
        return;
      }
      reject(new HttpRequestError(
        `Polymarket page request failed: ${cause.message}`,
        { code: String((cause as NodeJS.ErrnoException).code ?? "REQUEST_ERROR"), url, cause },
      ));
    });
  });
}

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

function extractNextFlightText(html: string): string {
  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const decoded = JSON.parse(match[1]);
      if (typeof decoded === "string") {
        chunks.push(decoded);
      }
    } catch {
      // Ignore malformed flight chunks and continue scanning later chunks.
    }
  }
  return chunks.join("");
}

function extractJsonObject(source: string, objectStart: number): Record<string, unknown> | null {
  if (objectStart < 0 || source[objectStart] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(source.slice(objectStart, index + 1));
          return typeof parsed === "object" && parsed !== null
            ? parsed as Record<string, unknown>
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function metadataFromRecord(metadata: Record<string, unknown>): MarketPageMetadata {
  const rawPriceToBeat = Number(metadata.priceToBeat ?? NaN);
  const rawFinalPrice = Number(metadata.finalPrice ?? NaN);
  return {
    priceToBeat: Number.isFinite(rawPriceToBeat) ? rawPriceToBeat : null,
    finalPrice: Number.isFinite(rawFinalPrice) ? rawFinalPrice : null,
    priceToBeatSource: Number.isFinite(rawPriceToBeat) ? "polymarket_page_event_metadata" : null,
  };
}

function findMarketMetadataInFlightText(text: string, slug: string): MarketPageMetadata | null {
  const slugToken = `"slug":"${slug}"`;
  const metadataToken = '"eventMetadata":';
  let cursor = 0;
  while (cursor < text.length) {
    const slugIndex = text.indexOf(slugToken, cursor);
    if (slugIndex < 0) {
      return null;
    }
    const metadataIndex = text.indexOf(metadataToken, slugIndex + slugToken.length);
    if (
      metadataIndex >= 0
      && metadataIndex - slugIndex <= 20_000
    ) {
      const objectStart = text.indexOf("{", metadataIndex + metadataToken.length);
      const metadata = extractJsonObject(text, objectStart);
      if (metadata) {
        return metadataFromRecord(metadata);
      }
    }
    cursor = slugIndex + slugToken.length;
  }
  return null;
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
      return metadataFromRecord(metadata);
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
  const html = await requestText(`https://polymarket.com/event/${slug}`);
  return extractMarketPageMetadataFromHtml(html, slug);
}

export function extractMarketPageMetadataFromHtml(html: string, slug: string): MarketPageMetadata {
  const nextData = extractEmbeddedNextData(html);
  if (!nextData) {
    const flightText = extractNextFlightText(html);
    const metadata = findMarketMetadataInFlightText(flightText, slug)
      ?? findMarketMetadataInFlightText(flightText.replace(/\\"/g, '"'), slug);
    return metadata ?? {
      priceToBeat: null,
      finalPrice: null,
      priceToBeatSource: null,
    };
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
