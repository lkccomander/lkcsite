import * as fs from "fs";
import * as TOML from "@iarna/toml";
import { z } from "zod";

const Trade3Schema = z.object({
  entry_price_ratio: z.tuple([z.number(), z.number()]),
  entry_time_ratio: z.number(),
  min_seconds_to_close: z.number(),
  max_seconds_to_close: z.number().default(Number.POSITIVE_INFINITY),
  max_entry_price: z.number(),
  min_entry_price: z.number(),
  stop_loss_price: z.number().default(0.4),
  stop_loss_offset: z.number().optional(),
  take_profit_price: z.number(),
  emergency_swap_price: z.tuple([z.number(), z.number()]).optional(),
  hold_to_end_price: z.number().optional(),
  max_trades_per_market: z.number(),
  max_open_positions: z.number(),
  cooldown_after_loss_markets: z.number(),
  daily_stop_loss_usd: z.number(),
  session_stop_loss_usd: z.number(),
});

const Trade4Schema = Trade3Schema.extend({
  exit_price_ratio_range: z.tuple([
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()]),
  ]),
  stop_loss_max_spread: z.number().default(0.035),
  stop_loss_spread_wait_ms: z.number().default(2000),
  require_fee_adjusted_edge: z.boolean(),
  min_fee_adjusted_edge: z.number(),
  min_observed_markets_before_trade: z.number(),
  require_websocket: z.boolean().default(false),
  reject_on_missing_websocket: z.boolean().default(false),
  reject_if_recent_ws_fallback: z.boolean().default(true),
  recent_ws_fallback_cooldown_ms: z.number().default(2000),
  max_entry_feed_latency_ms: z.number().default(400),
  max_entry_feed_rtt_ms: z.number().default(400),
  max_entry_feed_age_ms: z.number().default(500),
  max_feed_age_ms: z.number().default(5000),
  max_rtt_ms: z.number().default(300),
  max_allowed_spread: z.number().default(0.05),
  latest_entry_seconds_before_close: z.number().default(60),
  forced_exit_seconds_before_close: z.number().default(30),
  exit_reprice_enabled: z.boolean().default(true),
  exit_reprice_after_ms: z.number().default(1500),
  exit_reprice_max_attempts: z.number().default(2),
  max_market_transition_grace_ms: z.number().default(2500),
  market_transition_grace_ms: z.number().optional(),
  require_reject_reason: z.boolean().default(true),
  use_passive_maker_orders: z.boolean().default(true),
  maker_rebate_bps: z.number().default(0),
  reject_if_price_moves_against_us_fast: z.boolean().default(true),
  max_price_change_after_signal: z.number().default(0.025),
  max_entry_fill_delay_ms: z.number().default(12000),
  prevent_opposite_side_reentry: z.boolean().default(true),
  opposite_side_cooldown_seconds: z.number().default(120),
  up_min_entry_price: z.number().optional(),
  up_max_entry_price: z.number().optional(),
  down_min_entry_price: z.number().optional(),
  down_max_entry_price: z.number().optional(),
  paper_disable_up_entries: z.boolean().default(false),
  up_requires_btc_momentum: z.boolean().default(true),
  up_min_btc_delta1m: z.number().default(0.001),
  up_min_momentum_confidence: z.number().default(0.6),
  up_require_directional_momentum: z.boolean().default(true),
  down_require_directional_momentum: z.boolean().default(false),
  down_block_neutral_momentum: z.boolean().default(false),
  up_require_mc_direction_agreement: z.boolean().default(true),
  down_require_mc_direction_agreement: z.boolean().default(true),
  up_min_mc_convergence: z.number().default(0.7),
  down_min_mc_convergence: z.number().default(0.62),
  down_bias_filter: z.boolean().default(false),
  down_block_if_btc_trend_up: z.boolean().default(false),
});

const ConfigSchema = z.object({
  strategy: z.enum(["trade_1", "trade_2", "trade_3", "trade_4", "trade_5x", "trade_5x_open_paper"]),
  trade_usd: z.number(),
  max_retries: z.number().default(3),
  market: z.object({
    market_coin: z.enum(["btc", "eth", "sol", "xrp"]),
    market_period: z.enum(["5", "15", "60", "240", "1440"]),
  }),
  trade_1: z.object({
    entry_price_range: z.tuple([z.number(), z.number()]),
    swap_price_range: z.tuple([z.number(), z.number()]),
    take_profit: z.number(),
    stop_loss: z.number(),
    exit_time_ratio: z.number(),
    exit_price_ratio: z.number(),
  }).optional(),
  trade_2: z.object({
    entry_price_ratio: z.tuple([z.number(), z.number()]),
    entry_time_ratio: z.number(),
    exit_price_ratio_range: z.tuple([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number()])]),
    emergency_swap_price: z.tuple([z.number(), z.number()]).optional(),
  }).optional(),
  trade_3: Trade3Schema.optional(),
  trade_4: Trade4Schema.optional(),
  trade_5x: Trade4Schema.optional(),
  trade_5x_open_paper: Trade4Schema.optional(),
}).superRefine((config, ctx) => {
  if (!config[config.strategy]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [config.strategy],
      message: `Missing configuration block for selected strategy "${config.strategy}"`,
    });
  }
});

export type Config = z.infer<typeof ConfigSchema>;
export type Trade4LikeConfig = z.infer<typeof Trade4Schema>;

declare global {
  // makes config globally accessible
  var __CONFIG__: Config;
}

export function loadConfig(path = "trade.toml"): Config {
  if (!globalThis.__CONFIG__) {
    const raw = TOML.parse(fs.readFileSync(path, "utf-8"));
    globalThis.__CONFIG__ = ConfigSchema.parse(raw);
  }
  return globalThis.__CONFIG__;
}

export function getTrade4LikeConfig(config: Config | undefined = globalThis.__CONFIG__): Trade4LikeConfig | undefined {
  if (!config) {
    return undefined;
  }
  if (config.strategy === "trade_5x") {
    return config.trade_5x ?? config.trade_4;
  }
  if (config.strategy === "trade_5x_open_paper") {
    return config.trade_5x_open_paper ?? config.trade_5x ?? config.trade_4;
  }
  return config.trade_4;
}
