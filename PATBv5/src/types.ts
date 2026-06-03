export type Coin = "btc" | "eth" | "sol" | "xrp";
export type Minutes = 5 | 15 | 60 | 240 | 1440;

export interface MarketConfig {
  coin: Coin;
  minutes: Minutes;
}

export interface MarketRuntimeConfig {
  tickSize: "0.1" | "0.01" | "0.001" | "0.0001";
  negRisk: boolean;
  minOrderSize: number | null;
  priceToBeat: number | null;
  finalPrice: number | null;
  priceToBeatSource: string | null;
}

export enum Market {
  Up = "Up",
  Down = "Down",
  None = "None",
}
