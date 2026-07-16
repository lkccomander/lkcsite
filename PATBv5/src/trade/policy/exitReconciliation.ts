export interface ExitReconciliationRequest {
    tokenId: string;
    requestedSize: number;
    submittedAt: string;
    sizeTolerance?: number;
}

export interface ReconciledFill {
    filledSize: number;
    averagePrice: number;
    tradeIds: string[];
    transactionHashes: string[];
}

export interface MatchingOpenOrder {
    orderId: string;
    price: number;
    requestedSize: number;
    filledSize: number;
    remainingSize: number;
    status: string;
}

function finiteNumber(value: unknown): number | null {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function eventTimestampMs(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value > 10_000_000_000 ? value : value * 1000;
    }
    if (typeof value !== "string" || value.length === 0) return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function tradeIdentity(trade: Record<string, unknown>): string {
    const id = String(trade.id ?? "");
    if (id) return `id:${id}`;
    return [
        trade.transaction_hash,
        trade.asset_id,
        trade.size,
        trade.price,
        trade.match_time,
    ].map((value) => String(value ?? "")).join(":");
}

export function aggregateMatchingSellFills(
    trades: unknown[],
    request: ExitReconciliationRequest,
): ReconciledFill | null {
    const submittedAtMs = Date.parse(request.submittedAt);
    if (!Number.isFinite(submittedAtMs)) return null;
    const tolerance = request.sizeTolerance ?? 0.000001;
    const seen = new Set<string>();
    const matches: Array<{ size: number; price: number; id: string; transactionHash: string }> = [];

    for (const candidate of trades) {
        if (typeof candidate !== "object" || candidate === null) continue;
        const trade = candidate as Record<string, unknown>;
        const matchedAtMs = eventTimestampMs(trade.match_time ?? trade.last_update);
        if (matchedAtMs === null || matchedAtMs < submittedAtMs - 1000) continue;
        const makerOrders = Array.isArray(trade.maker_orders) ? trade.maker_orders : [];
        const legs: Record<string, unknown>[] = String(trade.trader_side ?? "").toUpperCase() === "MAKER"
            ? makerOrders
                .filter((order): order is Record<string, unknown> => typeof order === "object" && order !== null)
                .map((order) => ({
                    ...order,
                    id: `${String(trade.id ?? "")}:${String(order.order_id ?? "")}`,
                    size: order.matched_amount,
                    transaction_hash: trade.transaction_hash,
                    match_time: trade.match_time,
                }))
            : [trade];

        for (const leg of legs) {
            if (String(leg.asset_id ?? leg.token_id ?? "") !== request.tokenId) continue;
            if (String(leg.side ?? "").toUpperCase() !== "SELL") continue;
            const size = finiteNumber(leg.size);
            const price = finiteNumber(leg.price);
            if (size === null || size <= 0 || price === null || price <= 0) continue;
            const identity = tradeIdentity(leg);
            if (seen.has(identity)) continue;
            seen.add(identity);
            matches.push({
                size,
                price,
                id: String(trade.id ?? leg.id ?? ""),
                transactionHash: String(trade.transaction_hash ?? leg.transaction_hash ?? ""),
            });
        }
    }

    const filledSize = matches.reduce((sum, trade) => sum + trade.size, 0);
    if (filledSize + tolerance < request.requestedSize) return null;
    const appliedSize = Math.min(filledSize, request.requestedSize);
    let remaining = appliedSize;
    let weightedProceeds = 0;
    for (const trade of matches) {
        const usedSize = Math.min(remaining, trade.size);
        weightedProceeds += usedSize * trade.price;
        remaining -= usedSize;
        if (remaining <= tolerance) break;
    }

    return {
        filledSize: appliedSize,
        averagePrice: Math.round((weightedProceeds / appliedSize) * 1_000_000) / 1_000_000,
        tradeIds: [...new Set(matches.map((trade) => trade.id).filter(Boolean))],
        transactionHashes: [...new Set(matches.map((trade) => trade.transactionHash).filter(Boolean))],
    };
}

export function findMatchingOpenSellOrder(
    orders: unknown[],
    request: ExitReconciliationRequest,
): MatchingOpenOrder | null {
    const submittedAtMs = Date.parse(request.submittedAt);
    for (const candidate of orders) {
        if (typeof candidate !== "object" || candidate === null) continue;
        const order = candidate as Record<string, unknown>;
        if (String(order.asset_id ?? order.token_id ?? "") !== request.tokenId) continue;
        if (String(order.side ?? "").toUpperCase() !== "SELL") continue;
        const status = String(order.status ?? "").toLowerCase();
        if (status !== "live" && status !== "partial" && status !== "partially_filled") continue;
        const createdAtMs = eventTimestampMs(order.created_at);
        if (createdAtMs !== null && Number.isFinite(submittedAtMs) && createdAtMs < submittedAtMs - 5000) continue;
        const orderId = String(order.id ?? order.orderID ?? order.orderId ?? "");
        const requestedSize = finiteNumber(order.original_size ?? order.size) ?? request.requestedSize;
        const filledSize = finiteNumber(order.size_matched) ?? 0;
        const price = finiteNumber(order.price) ?? 0;
        if (!orderId || requestedSize <= 0 || price <= 0) continue;
        return {
            orderId,
            price,
            requestedSize,
            filledSize,
            remainingSize: Math.max(0, requestedSize - filledSize),
            status,
        };
    }
    return null;
}
