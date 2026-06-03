import type { Coin } from "../types";

const COINBASE_PRODUCT_BY_COIN: Record<Coin, string> = {
  btc: "BTC-USD",
  eth: "ETH-USD",
  sol: "SOL-USD",
  xrp: "XRP-USD",
};

export async function getReferenceSpotPrice(coin: Coin): Promise<{
  source: string;
  symbol: string;
  priceUsd: number;
  fetchedAt: string;
}> {
  const product = COINBASE_PRODUCT_BY_COIN[coin];
  const response = await fetch(`https://api.coinbase.com/v2/prices/${product}/spot`);
  if (!response.ok) {
    throw new Error(`Coinbase spot request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as {
    data?: { amount?: string; base?: string; currency?: string };
  };
  const amount = Number(payload?.data?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Coinbase spot response missing valid amount for ${product}`);
  }

  return {
    source: "coinbase_spot",
    symbol: product,
    priceUsd: amount,
    fetchedAt: new Date().toISOString(),
  };
}
