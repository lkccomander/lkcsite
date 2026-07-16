import assert from "node:assert/strict";
import {
    describeRequestError,
    extractMarketPageMetadataFromHtml,
    HttpRequestError,
} from "../src/services/gamma";

async function run(): Promise<void> {
    const flightPayload = '1:{"slug":"btc-updown-5m-example","eventMetadata":{"finalPrice":63735.25,"priceToBeat":63755.5}}';
    const flightHtml = `<script>self.__next_f.push([1,${JSON.stringify(flightPayload)}])</script>`;
    assert.deepEqual(extractMarketPageMetadataFromHtml(flightHtml, "btc-updown-5m-example"), {
        priceToBeat: 63755.5,
        finalPrice: 63735.25,
        priceToBeatSource: "polymarket_page_event_metadata",
    });
    const nestedMarket = JSON.stringify({
        slug: "btc-updown-5m-nested",
        related: { slug: "btc-series-related" },
        eventMetadata: { finalPrice: 64001.25, priceToBeat: 64000.5 },
    });
    const nestedFlightPayload = `2:${JSON.stringify(nestedMarket)}`;
    const nestedFlightHtml = `<script>self.__next_f.push([1,${JSON.stringify(nestedFlightPayload)}])</script>`;
    assert.deepEqual(extractMarketPageMetadataFromHtml(nestedFlightHtml, "btc-updown-5m-nested"), {
        priceToBeat: 64000.5,
        finalPrice: 64001.25,
        priceToBeatSource: "polymarket_page_event_metadata",
    });

    const headerCause = Object.assign(new Error("Headers Overflow Error"), {
        code: "UND_ERR_HEADERS_OVERFLOW",
    });
    const fetchError = Object.assign(new TypeError("fetch failed"), {
        cause: headerCause,
    });

    assert.deepEqual(describeRequestError(fetchError), {
        error: "fetch failed",
        errorName: "TypeError",
        errorCode: null,
        causeCode: "UND_ERR_HEADERS_OVERFLOW",
        causeMessage: "Headers Overflow Error",
        status: null,
        url: null,
    });

    const httpError = new HttpRequestError(
        "Polymarket page request failed: 503 Service Unavailable",
        {
            code: "HTTP_STATUS_ERROR",
            status: 503,
            url: "https://polymarket.com/event/example",
        },
    );
    assert.deepEqual(describeRequestError(httpError), {
        error: "Polymarket page request failed: 503 Service Unavailable",
        errorName: "HttpRequestError",
        errorCode: "HTTP_STATUS_ERROR",
        causeCode: null,
        causeMessage: null,
        status: 503,
        url: "https://polymarket.com/event/example",
    });
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
