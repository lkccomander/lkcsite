import { ClobClient, type TickSize } from "@polymarket/clob-client-v2";
import chalk from "@tsjunk/chalk";
import { readFile, rm } from "fs/promises";
import { resolve } from "path";
import {
  generateMarketSlug,
  PAPER_STARTING_USD,
  PAPER_TRADING,
  COLLATERAL_GUARD_ENABLED,
  POLYMARKET_API_KEY,
  POLYMARKET_API_PASSPHRASE,
  POLYMARKET_API_SECRET,
} from "./config";
import { PolymarketMarketFeed } from "./feed";
import type { PriceSnapshot } from "./feed";
import { Market } from "./types";
import type { Coin, MarketConfig, MarketRuntimeConfig, Minutes } from "./types";
import {
  CHAIN_ID,
  CollateralEgressGuard,
  FUNDER,
  getMarket,
  getMarketPageMetadata,
  getReferenceSpotPrice,
  HOST,
  isCollateralEgressViolation,
  PUSD_COLLATERAL_TOKEN,
  SIGNATURE_TYPE,
  SIGNATURE_TYPE_SOURCE,
  SIGNER,
  SIGNER_ADDRESS,
} from "./services";
import { getCurrentTime, retryWithInstantRetry, sleep } from "./utils";
import {
  getTelemetryBotId,
  getTelemetryDbPath,
  getTelemetrySession,
  getTelemetrySessionsDir,
  setTelemetryVersionContext,
  loadPersistedPaperBalance,
  savePersistedPaperBalance,
  startTelemetrySession,
  writeTelemetryEventSafe,
} from "./telemetry";
import { initializeVersionContext } from "./telemetry/versioning";
import { getTrade4LikeConfig, loadConfig } from "./config/toml";
import { readOptionalConfigEnv } from "./config/secrets";
import { Trade } from "./trade";
import { startUiServer } from "./ui/server";
import { generateNextMarketSlug } from "./config/slug";

loadConfig();

const MARKET_FETCH_RETRIES = 2;
const MARKET_RECONNECT_DELAY_MS = 5000;
const FALLBACK_SAFETY_POLL_MS = 250;
const MARKET_CLOSE_RECONCILIATION_GRACE_MS = 15_000;
const MARKET_CLOSE_RECONCILIATION_POLL_MS = 1_000;
const MIN_DECISION_SPACING_MS = 150;
const DEFAULT_MARKET_TRANSITION_GRACE_MS = 2500;
const EXTERNAL_REFERENCE_REFRESH_MS = 5000;
const NEXT_MARKET_PREFETCH_WINDOW_SECS = 30;
const BOT_ID = getTelemetryBotId();
const BOT_DISPLAY_NAME = "Polymarket Arbitrage Trading Bot V5";
const MANUAL_TRADE_REQUEST_PATH = resolve(__dirname, "..", "manual-trade-request.json");

interface ManualTradeRequest {
  id: string;
  requestedAt: string;
  side: "UP" | "DOWN";
  source?: string;
  mode?: "PAPER" | "LIVE";
}

const marketConfig: MarketConfig = {
  coin: globalThis.__CONFIG__.market.market_coin as Coin, // btc / eth / sol / xrp
  minutes: parseInt(globalThis.__CONFIG__.market.market_period) as Minutes, // 15 / 60 / 240 / 1440
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function shouldStartUiServer(): boolean {
  const raw = readOptionalConfigEnv("UI_SERVER_ENABLED").toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function normalizeOutcomeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveMarketTokenIds(market: Record<string, unknown>): {
  upTokenId: string;
  downTokenId: string;
  outcomeLabels: string[];
  mappingSource: string;
} {
  const tokenIds = parseJsonStringArray(market.clobTokenIds);
  const outcomes = parseJsonStringArray(market.outcomes);

  if (tokenIds.length < 2) {
    throw new Error(`Market token resolution failed: expected at least 2 token ids, received ${tokenIds.length}`);
  }

  const normalizedOutcomes = outcomes.map(normalizeOutcomeLabel);
  const yesIndex = normalizedOutcomes.findIndex((label) => label === "yes" || label === "up" || label === "higher");
  const noIndex = normalizedOutcomes.findIndex((label) => label === "no" || label === "down" || label === "lower");

  if (yesIndex >= 0 && noIndex >= 0 && tokenIds[yesIndex] && tokenIds[noIndex]) {
    return {
      upTokenId: tokenIds[yesIndex],
      downTokenId: tokenIds[noIndex],
      outcomeLabels: outcomes,
      mappingSource: "market_outcomes_labels",
    };
  }

  if (normalizedOutcomes.length === 2 && tokenIds.length >= 2) {
    return {
      upTokenId: tokenIds[0],
      downTokenId: tokenIds[1],
      outcomeLabels: outcomes,
      mappingSource: "positional_fallback_unknown_labels",
    };
  }

  return {
    upTokenId: tokenIds[0],
    downTokenId: tokenIds[1],
    outcomeLabels: outcomes,
    mappingSource: "positional_fallback_missing_labels",
  };
}

function resolveMarketRuntimeConfig(market: Record<string, unknown>): MarketRuntimeConfig {
  const supportedTickSizes = new Set<TickSize>(["0.1", "0.01", "0.001", "0.0001"]);
  const rawTickSize = String(market.orderPriceMinTickSize ?? market.tickSize ?? "0.01");
  const tickSize = supportedTickSizes.has(rawTickSize as TickSize) ? (rawTickSize as TickSize) : "0.01";
  const rawMinOrderSize = Number(market.orderMinSize ?? market.minOrderSize ?? NaN);
  const eventMetadata = typeof market.eventMetadata === "object" && market.eventMetadata !== null
    ? (market.eventMetadata as Record<string, unknown>)
    : null;
  const rawPriceToBeat = Number(eventMetadata?.priceToBeat ?? NaN);
  const rawFinalPrice = Number(eventMetadata?.finalPrice ?? NaN);

  return {
    tickSize,
    negRisk: Boolean(market.negRisk),
    minOrderSize: Number.isFinite(rawMinOrderSize) && rawMinOrderSize > 0 ? rawMinOrderSize : null,
    priceToBeat: Number.isFinite(rawPriceToBeat) ? rawPriceToBeat : null,
    finalPrice: Number.isFinite(rawFinalPrice) ? rawFinalPrice : null,
    priceToBeatSource: Number.isFinite(rawPriceToBeat) ? "gamma_event_metadata" : null,
  };
}

function resolveStartupConfigTelemetry(): Record<string, unknown> {
  const config = globalThis.__CONFIG__;
  const activeTradeConfig = getTrade4LikeConfig(config);
  const selectedStrategy = config.strategy;
  const selectedStrategyBlock = config[selectedStrategy];

  return {
    strategy: selectedStrategy,
    loadedStrategySection: selectedStrategyBlock ? selectedStrategy : null,
    tradeUsd: config.trade_usd,
    entryPriceRatio: activeTradeConfig?.entry_price_ratio ?? null,
    entryTimeRatio: activeTradeConfig?.entry_time_ratio ?? null,
    minEntryPrice: activeTradeConfig?.min_entry_price ?? null,
    maxEntryPrice: activeTradeConfig?.max_entry_price ?? null,
    upMinEntryPrice: activeTradeConfig?.up_min_entry_price ?? null,
    upMaxEntryPrice: activeTradeConfig?.up_max_entry_price ?? null,
    downMinEntryPrice: activeTradeConfig?.down_min_entry_price ?? null,
    downMaxEntryPrice: activeTradeConfig?.down_max_entry_price ?? null,
    paperDisableUpEntries: activeTradeConfig?.paper_disable_up_entries ?? null,
    minSecondsToClose: activeTradeConfig?.min_seconds_to_close ?? null,
    latestEntrySecondsBeforeClose: activeTradeConfig?.latest_entry_seconds_before_close ?? null,
    requireFeeAdjustedEdge: activeTradeConfig?.require_fee_adjusted_edge ?? null,
    minFeeAdjustedEdge: activeTradeConfig?.min_fee_adjusted_edge ?? null,
    maxAllowedSpread: activeTradeConfig?.max_allowed_spread ?? null,
    maxEntryFeedLatencyMs: activeTradeConfig?.max_entry_feed_latency_ms ?? null,
    maxEntryFeedRttMs: activeTradeConfig?.max_entry_feed_rtt_ms ?? null,
    maxEntryFeedAgeMs: activeTradeConfig?.max_entry_feed_age_ms ?? null,
    upRequiresBtcMomentum: activeTradeConfig?.up_requires_btc_momentum ?? null,
    upMinBtcDelta1m: activeTradeConfig?.up_min_btc_delta1m ?? null,
    upMinMomentumConfidence: activeTradeConfig?.up_min_momentum_confidence ?? null,
    upRequireDirectionalMomentum: activeTradeConfig?.up_require_directional_momentum ?? null,
    downRequireDirectionalMomentum: activeTradeConfig?.down_require_directional_momentum ?? null,
    downBlockNeutralMomentum: activeTradeConfig?.down_block_neutral_momentum ?? null,
    upRequireMcDirectionAgreement: activeTradeConfig?.up_require_mc_direction_agreement ?? null,
    downRequireMcDirectionAgreement: activeTradeConfig?.down_require_mc_direction_agreement ?? null,
    upMinMcConvergence: activeTradeConfig?.up_min_mc_convergence ?? null,
    downMinMcConvergence: activeTradeConfig?.down_min_mc_convergence ?? null,
    downBiasFilter: activeTradeConfig?.down_bias_filter ?? null,
  };
}

function getOpenExitOrderCount(trade: Trade): number {
  return Object.keys(trade.openExitOrders ?? {}).length;
}

function hasOpenExposure(trade: Trade): boolean {
  return trade.share > 0 || trade.holdingStatus !== Market.None || getOpenExitOrderCount(trade) > 0;
}

async function reconcileMarketCloseExposure(trade: Trade, slug: string): Promise<void> {
  if (PAPER_TRADING || !hasOpenExposure(trade)) {
    return;
  }

  const startedAt = Date.now();
  const sideBefore = trade.holdingStatus === Market.Up
    ? "UP"
    : trade.holdingStatus === Market.Down
      ? "DOWN"
      : null;
  const sharesBefore = trade.share;
  const openExitOrdersBefore = getOpenExitOrderCount(trade);

  while (Date.now() - startedAt < MARKET_CLOSE_RECONCILIATION_GRACE_MS) {
    await trade.reconcileOpenExitOrders();
    await trade.updateTokenBalances();
    if (!hasOpenExposure(trade)) {
      await writeTelemetryEventSafe("trade.position_resolved", {
        strategy: globalThis.__CONFIG__.strategy,
        marketSlug: slug,
        reason: "market_close_reconciliation",
        sideBefore,
        upTokenId: trade.upTokenId,
        downTokenId: trade.downTokenId,
        sharesBefore,
        openExitOrdersBefore,
        resolvedAfterMs: Date.now() - startedAt,
        holdingStatusAfter: trade.holdingStatus,
        positionStateAfter: trade.positionState,
        openExitOrdersAfter: getOpenExitOrderCount(trade),
      });
      return;
    }
    await sleep(MARKET_CLOSE_RECONCILIATION_POLL_MS);
  }

  await writeTelemetryEventSafe("trade.position_unresolved", {
    strategy: globalThis.__CONFIG__.strategy,
    marketSlug: slug,
    reason: "market_close_reconciliation_timeout",
    sideBefore,
    upTokenId: trade.upTokenId,
    downTokenId: trade.downTokenId,
    sharesBefore,
    openExitOrdersBefore,
    holdingStatusAfter: trade.holdingStatus,
    sharesAfter: trade.share,
    positionStateAfter: trade.positionState,
    openExitOrdersAfter: getOpenExitOrderCount(trade),
    reconciliationGraceMs: MARKET_CLOSE_RECONCILIATION_GRACE_MS,
  });
}

function isManualTradeRequest(value: unknown): value is ManualTradeRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ManualTradeRequest>;
  return typeof candidate.id === "string"
    && typeof candidate.requestedAt === "string"
    && (candidate.side === "UP" || candidate.side === "DOWN");
}

async function consumeManualTradeRequest(): Promise<ManualTradeRequest | null> {
  try {
    const raw = await readFile(MANUAL_TRADE_REQUEST_PATH, "utf-8");
    await rm(MANUAL_TRADE_REQUEST_PATH, { force: true });
    const parsed = JSON.parse(raw) as unknown;
    return isManualTradeRequest(parsed) ? parsed : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function main() {
  if (shouldStartUiServer()) {
    await startUiServer();
  }
  const signerAddress = PAPER_TRADING ? "paper-trading" : SIGNER_ADDRESS ?? "unknown";
  const runtimeMode = PAPER_TRADING ? "PAPER" : "LIVE";
  await startTelemetrySession(runtimeMode);
  const versionContext = await initializeVersionContext(globalThis.__CONFIG__);
  setTelemetryVersionContext(versionContext);

  let paperBalance = PAPER_TRADING
    ? await loadPersistedPaperBalance(PAPER_STARTING_USD)
    : globalThis.__CONFIG__.trade_usd;
  let activeTrade: Trade | null = null;
  let activeMarketFeed: PolymarketMarketFeed | null = null;
  let shutdownPersisted = false;
  let collateralGuard: CollateralEgressGuard | null = null;
  let lastManualTradeRequestId: string | null = null;
  let prefetchedMarketSlug: string | null = null;
  let prefetchedMarket: unknown | null = null;

  const assertCollateralGuardSafe = async (reason: string, force = false): Promise<boolean> => {
    if (!collateralGuard) {
      return true;
    }

    try {
      await collateralGuard.assertSafe(reason, force);
      return true;
    } catch (error) {
      if (isCollateralEgressViolation(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.yellow(`Collateral guard unavailable (${reason}); skipping trading action: ${message}`));
      await writeTelemetryEventSafe("collateral.guard_unavailable", {
        reason,
        error: message,
      });
      return false;
    }
  };

  const getCurrentBalance = (): number => {
    if (PAPER_TRADING && activeTrade && typeof activeTrade.totalValue === "function") {
      return roundCurrency(activeTrade.totalValue());
    }

    return roundCurrency(paperBalance);
  };

  const persistPaperBalance = async (reason: string): Promise<void> => {
    if (!PAPER_TRADING || shutdownPersisted) {
      return;
    }

    if (activeMarketFeed) {
      await activeMarketFeed.emitSummaryTelemetry(`shutdown_${reason}`);
    }
    const endingBalance = getCurrentBalance();
    shutdownPersisted = true;
    await savePersistedPaperBalance(endingBalance);
    await writeTelemetryEventSafe("bot.shutdown", {
      reason,
      endingBalance,
    });
  };

  const processManualTradeRequest = async (trade: Trade): Promise<void> => {
    const request = await consumeManualTradeRequest();
    if (!request || request.id === lastManualTradeRequestId) {
      return;
    }
    lastManualTradeRequestId = request.id;

    const basePayload = {
      requestId: request.id,
      requestedAt: request.requestedAt,
      requestedSide: request.side,
      requestSource: request.source ?? "unknown",
      requestMode: request.mode ?? null,
      runtimeMode,
      marketSlug: trade.marketSlug,
      holdingStatus: trade.holdingStatus,
      hasBought: trade.hasBought,
      positionState: trade.positionState,
      upBuyPrice: trade.upBuyPrice,
      downBuyPrice: trade.downBuyPrice,
      secondsToClose: trade.remainingTime,
    };

    await writeTelemetryEventSafe("operator.manual_trade_requested", basePayload);

    if (request.mode && request.mode !== runtimeMode) {
      await writeTelemetryEventSafe("operator.manual_trade_rejected", {
        ...basePayload,
        reason: "mode_mismatch",
      });
      console.log(chalk.yellow(`Manual trade ignored | requestedMode=${request.mode} | runtimeMode=${runtimeMode}`));
      return;
    }

    if (trade.hasBought || trade.holdingStatus === Market.Up || trade.holdingStatus === Market.Down) {
      await writeTelemetryEventSafe("operator.manual_trade_rejected", {
        ...basePayload,
        reason: "position_already_open",
      });
      console.log(chalk.yellow(`Manual trade rejected | side=${request.side} | reason=position_already_open`));
      return;
    }

    const entryPrice = request.side === "UP" ? trade.upBuyPrice : trade.downBuyPrice;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      await writeTelemetryEventSafe("operator.manual_trade_rejected", {
        ...basePayload,
        reason: "missing_entry_price",
      });
      console.log(chalk.yellow(`Manual trade rejected | side=${request.side} | reason=missing_entry_price`));
      return;
    }

    if (!(await assertCollateralGuardSafe(`manual_trade_${request.side.toLowerCase()}`))) {
      await writeTelemetryEventSafe("operator.manual_trade_rejected", {
        ...basePayload,
        reason: "collateral_guard_unavailable",
      });
      return;
    }

    const signalTimestamp = new Date().toISOString();
    trade.pendingEntrySignal = {
      side: request.side === "UP" ? Market.Up : Market.Down,
      signalPrice: entryPrice,
      signalTimestamp,
      marketSlug: trade.marketSlug,
    };
    trade.lastDecisionSnapshotSource = "manual";

    console.log(chalk.cyan(`Manual trade requested | side=${request.side} | mode=${runtimeMode} | market=${trade.marketSlug}`));

    const expectedSide = request.side === "UP" ? Market.Up : Market.Down;
    const beforeHasBought = trade.hasBought;
    try {
      if (request.side === "UP") {
        await trade.buyUpToken();
      } else {
        await trade.buyDownToken();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeTelemetryEventSafe("operator.manual_trade_rejected", {
        ...basePayload,
        reason: "execution_error",
        error: message,
      });
      console.log(chalk.yellow(`Manual trade failed | side=${request.side} | error=${message}`));
      return;
    }

    const executed = !beforeHasBought && trade.hasBought && trade.lastExecutedEntry?.side === expectedSide;
    if (!executed) {
      await writeTelemetryEventSafe("operator.manual_trade_rejected", {
        ...basePayload,
        reason: "execution_not_confirmed",
      });
      console.log(chalk.yellow(`Manual trade did not confirm fill | side=${request.side}`));
      return;
    }

    await writeTelemetryEventSafe("operator.manual_trade_executed", {
      ...basePayload,
      executedSide: request.side,
      executedAt: trade.lastExecutedEntry?.executedAt ?? signalTimestamp,
      entryPrice: trade.lastExecutedEntry?.entryPrice ?? entryPrice,
      shares: trade.lastExecutedEntry?.shares ?? null,
      costBasisUsd: trade.lastExecutedEntry?.costBasisUsd ?? null,
      decisionSource: trade.lastDecisionSnapshotSource,
    });
  };

  const handleSignal = async (signal: string) => {
    console.log(chalk.yellow(`Received ${signal}. Saving paper balance before exit...`));
    if (activeTrade && (activeTrade.holdingStatus === Market.Up || activeTrade.holdingStatus === Market.Down) && activeTrade.share > 0) {
      try {
        activeTrade.setPendingExitIntent("manual", `shutdown_signal:${signal}`);
        const exitPromise = activeTrade.holdingStatus === Market.Up
          ? activeTrade.sellUpToken()
          : activeTrade.sellDownToken();
        await Promise.race([
          exitPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("manual exit timeout")), 5000)),
        ]);
      } catch (error) {
        console.error(chalk.yellow(`Manual exit attempt failed during ${signal}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    await persistPaperBalance(signal);
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void handleSignal("SIGINT");
  });

  process.once("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });

  console.log(chalk.cyan(`Starting ${BOT_DISPLAY_NAME}`));
  console.log(chalk.cyan("This is the new bot built from the original baseline."));
  console.log(chalk.gray(`Bot ID: ${BOT_ID}`));
  console.log(chalk.gray(`Public key: ${signerAddress}`));
  console.log(chalk.gray(`Signature type: ${SIGNATURE_TYPE} (${SIGNATURE_TYPE_SOURCE}) | Funder: ${FUNDER || "n/a"}`));
  console.log(chalk.gray(`Mode: ${runtimeMode}${PAPER_TRADING ? ` | Starting USD: $${paperBalance}` : ""}`));
  console.log(chalk.gray(`Collateral guard: ${!PAPER_TRADING && COLLATERAL_GUARD_ENABLED ? "enabled" : "disabled"}${!PAPER_TRADING && COLLATERAL_GUARD_ENABLED ? ` | pUSD=${PUSD_COLLATERAL_TOKEN}` : ""}`));
  console.log(chalk.gray(`Strategy: ${globalThis.__CONFIG__.strategy} | Market: ${marketConfig.coin.toUpperCase()} ${marketConfig.minutes}m | Trade USD: $${globalThis.__CONFIG__.trade_usd}`));
  console.log(chalk.gray(`Telemetry DB: ${getTelemetryDbPath()}`));
  console.log(chalk.gray(`Telemetry Sessions: ${getTelemetrySessionsDir()}`));
  console.log(chalk.gray(`Session: ${getTelemetrySession()?.id} @ ${getTelemetrySession()?.startedAt}`));
  console.log(chalk.gray(`Repo: ${process.cwd()}`));
  console.log(
    chalk.gray(
      `Version Context: strategy=${versionContext.strategyVersionId} | build=${versionContext.botBuildVersionId} | commit=${versionContext.gitCommit} | branch=${versionContext.gitBranch} | dirty=${versionContext.gitDirty}`
    )
  );
  console.log(chalk.gray("Momentum raw telemetry debug: enabled"));
  console.log(chalk.gray("Trend legend: UP 🟢 | DOWN 🔴 | FLAT ⚪"));
  console.log(chalk.gray("Position legend: UP 🟩 | DOWN 🟥 | NONE ⬛"));

  await writeTelemetryEventSafe("bot.startup", {
    botId: BOT_ID,
    mode: runtimeMode,
    signerAddress,
    signatureType: SIGNATURE_TYPE,
    signatureTypeSource: SIGNATURE_TYPE_SOURCE,
    funderAddress: FUNDER || null,
    botName: BOT_DISPLAY_NAME,
    strategy: globalThis.__CONFIG__.strategy,
    tradeUsd: globalThis.__CONFIG__.trade_usd,
    marketCoin: marketConfig.coin,
    marketMinutes: marketConfig.minutes,
    paperStartingUsd: PAPER_TRADING ? paperBalance : null,
    collateralGuardEnabled: !PAPER_TRADING && COLLATERAL_GUARD_ENABLED,
    collateralGuardToken: !PAPER_TRADING && COLLATERAL_GUARD_ENABLED ? PUSD_COLLATERAL_TOKEN : null,
  });
  await writeTelemetryEventSafe("bot.startup_config", resolveStartupConfigTelemetry());

  let apiKey: Awaited<ReturnType<ClobClient["createOrDeriveApiKey"]>> | undefined;
  const manualApiKey =
    POLYMARKET_API_KEY && POLYMARKET_API_SECRET && POLYMARKET_API_PASSPHRASE
      ? {
          key: POLYMARKET_API_KEY,
          secret: POLYMARKET_API_SECRET,
          passphrase: POLYMARKET_API_PASSPHRASE,
        }
      : undefined;

  if (!PAPER_TRADING) {
    if (manualApiKey) {
      apiKey = manualApiKey;
      console.log(chalk.gray("Using manual Polymarket API credentials from hardened secret source"));
    } else {
      const clobClient = new ClobClient({
        host: HOST,
        chain: CHAIN_ID,
        signer: SIGNER,
        signatureType: SIGNATURE_TYPE,
        funderAddress: FUNDER,
      });

      try {
        apiKey = await clobClient.deriveApiKey();
        console.log(chalk.gray("Derived existing Polymarket API credentials"));
      } catch {
        apiKey = await clobClient.createApiKey();
        console.log(chalk.gray("Created new Polymarket API credentials"));
      }
    }

    if (COLLATERAL_GUARD_ENABLED) {
      collateralGuard = new CollateralEgressGuard(FUNDER);
      await collateralGuard.start();
      console.log(chalk.gray(`Collateral guard allowlist: ${collateralGuard.getAllowedRecipients().join(", ")}`));
    }
  }

  while (true) {
    const client = PAPER_TRADING
      ? null
      : new ClobClient({
        host: HOST,
        chain: CHAIN_ID,
        signer: SIGNER,
        creds: apiKey,
        signatureType: SIGNATURE_TYPE,
        funderAddress: FUNDER,
      });
    const { slug, endTimestamp } = generateMarketSlug(marketConfig.coin, marketConfig.minutes);

    console.log(chalk.yellow(`Market selected: ${slug}`));
    console.log(chalk.gray(`Window: ${getCurrentTime()} -> ${endTimestamp}`));
    await writeTelemetryEventSafe("market.selected", {
      slug,
      marketCoin: marketConfig.coin,
      marketMinutes: marketConfig.minutes,
      windowStart: getCurrentTime(),
      windowEnd: endTimestamp,
      mode: runtimeMode,
    });
    if (!(await assertCollateralGuardSafe("market_selected", true))) {
      console.log(chalk.yellow(`Skipping market ${slug} until collateral guard catches up...`));
      await sleep(MARKET_RECONNECT_DELAY_MS);
      continue;
    }

    let market;

    try {
      if (prefetchedMarketSlug === slug && prefetchedMarket) {
        market = prefetchedMarket;
        console.log(chalk.gray(`Using prefetched market payload for ${slug}`));
      } else {
        market = await retryWithInstantRetry(
          () => getMarket(slug),
          MARKET_FETCH_RETRIES,
          `Fetch market ${slug}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Unable to load market ${slug}: ${message}`));
      await writeTelemetryEventSafe("market.fetch_failed", {
        slug,
        mode: runtimeMode,
        error: message,
      });
      console.log(chalk.yellow(`Retrying market discovery in ${MARKET_RECONNECT_DELAY_MS / 1000}s...`));
      await sleep(MARKET_RECONNECT_DELAY_MS);
      continue;
    }
    prefetchedMarketSlug = null;
    prefetchedMarket = null;

    const {
      upTokenId,
      downTokenId,
      outcomeLabels,
      mappingSource,
    } = resolveMarketTokenIds(market as Record<string, unknown>);
    const runtimeConfig = resolveMarketRuntimeConfig(market as Record<string, unknown>);
    const usd = PAPER_TRADING ? paperBalance : globalThis.__CONFIG__.trade_usd;

    console.log(chalk.gray(`Resolved tokens | source=${mappingSource} | outcomes=${outcomeLabels.join(" / ") || "n/a"}`));
    console.log(chalk.gray(`Resolved tokens | UP=${upTokenId} | DOWN=${downTokenId}`));
    console.log(chalk.gray(`Market config | tickSize=${runtimeConfig.tickSize} | negRisk=${runtimeConfig.negRisk} | minOrderSize=${runtimeConfig.minOrderSize ?? "n/a"}`));
    console.log(chalk.gray(`Market benchmark | priceToBeat=${runtimeConfig.priceToBeat ?? "n/a"} | source=${runtimeConfig.priceToBeatSource ?? "n/a"} | finalPrice=${runtimeConfig.finalPrice ?? "n/a"}`));
    await writeTelemetryEventSafe("market.tokens_resolved", {
      slug,
      upTokenId,
      downTokenId,
      outcomes: outcomeLabels,
      mappingSource,
      tickSize: runtimeConfig.tickSize,
      negRisk: runtimeConfig.negRisk,
      minOrderSize: runtimeConfig.minOrderSize,
      priceToBeat: runtimeConfig.priceToBeat,
      finalPrice: runtimeConfig.finalPrice,
      priceToBeatSource: runtimeConfig.priceToBeatSource,
      rawClobTokenIds: parseJsonStringArray((market as Record<string, unknown>).clobTokenIds),
    });

    const trade = new Trade
      (
        usd,
        slug,
        upTokenId,
        downTokenId,
        client,
        runtimeConfig
      );
    activeTrade = trade;
    await trade.hydrateOpenExitOrders();
    const trade4Like = getTrade4LikeConfig(globalThis.__CONFIG__);
    const marketTransitionGraceMs = Number(
      trade4Like?.max_market_transition_grace_ms
      ?? trade4Like?.market_transition_grace_ms
      ?? DEFAULT_MARKET_TRANSITION_GRACE_MS
    );
    trade.marketTransitionGraceUntilMs = Date.now() + Math.max(0, marketTransitionGraceMs);
    const marketFeed = new PolymarketMarketFeed({
      slug,
      upTokenId,
      downTokenId,
    });
    activeMarketFeed = marketFeed;
    await marketFeed.start();

    try {
      let lastProcessedSnapshotKey = "";
      let lastDecisionAtMs = 0;
      let latestPendingSnapshot: PriceSnapshot | null = null;
      let processingSnapshot = false;
      let marketClosed = false;
      let lastExternalReferenceFetchAtMs = 0;
      let latestExternalReference: { source: string; symbol: string; priceUsd: number; fetchedAt: string } | null = null;
      let externalReferenceRefreshPromise: Promise<void> | null = null;
      let benchmarkRefreshPromise: Promise<void> | null = null;
      let lastBenchmarkRefreshAttemptAtMs = 0;
      let nextMarketPrefetchPromise: Promise<void> | null = null;
      let lastNextMarketPrefetchAttemptAtMs = 0;

      const refreshMarketBenchmark = (): void => {
        if ((trade.priceToBeat !== null && trade.finalPrice !== null) || benchmarkRefreshPromise) {
          return;
        }

        const now = Date.now();
        if (now - lastBenchmarkRefreshAttemptAtMs < 5000) {
          return;
        }
        lastBenchmarkRefreshAttemptAtMs = now;

        benchmarkRefreshPromise = (async () => {
          try {
            const pageMetadata = await getMarketPageMetadata(slug);
            if (trade.priceToBeat === null && pageMetadata.priceToBeat !== null) {
              trade.priceToBeat = pageMetadata.priceToBeat;
              trade.priceToBeatSource = pageMetadata.priceToBeatSource;
              console.log(
                chalk.gray(
                  `Market benchmark refreshed | priceToBeat=${trade.priceToBeat} | source=${trade.priceToBeatSource ?? "n/a"} | finalPrice=${trade.finalPrice ?? "n/a"}`
                )
              );
            }
            if (trade.finalPrice === null && pageMetadata.finalPrice !== null) {
              trade.finalPrice = pageMetadata.finalPrice;
            }
          } catch (error) {
            await writeTelemetryEventSafe("feed.error", {
              slug,
              source: "polymarket_page_metadata_refresh",
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            benchmarkRefreshPromise = null;
          }
        })();
      };

      const refreshExternalReference = (): void => {
        const now = Date.now();
        if (
          externalReferenceRefreshPromise ||
          (latestExternalReference && now - lastExternalReferenceFetchAtMs < EXTERNAL_REFERENCE_REFRESH_MS)
        ) {
          return;
        }

        lastExternalReferenceFetchAtMs = now;
        externalReferenceRefreshPromise = (async () => {
          try {
            const reference = await getReferenceSpotPrice(marketConfig.coin);
            latestExternalReference = reference;
            trade.recordExternalPricePoint(reference.priceUsd, reference.fetchedAt);
            await writeTelemetryEventSafe("market.external_reference", {
              slug,
              symbol: reference.symbol,
              source: reference.source,
              priceUsd: reference.priceUsd,
              fetchedAt: reference.fetchedAt,
            });
          } catch (error) {
            await writeTelemetryEventSafe("feed.error", {
              slug,
              source: "external_reference",
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            externalReferenceRefreshPromise = null;
          }
        })();
      };

      const prefetchNextMarket = (): void => {
        const now = Date.now();
        if (
          nextMarketPrefetchPromise
          || prefetchedMarketSlug
          || now - lastNextMarketPrefetchAttemptAtMs < 2000
        ) {
          return;
        }

        const nextMarket = generateNextMarketSlug(marketConfig.coin, marketConfig.minutes, endTimestamp);
        lastNextMarketPrefetchAttemptAtMs = now;
        nextMarketPrefetchPromise = (async () => {
          try {
            const nextPayload = await getMarket(nextMarket.slug);
            prefetchedMarketSlug = nextMarket.slug;
            prefetchedMarket = nextPayload;
            console.log(chalk.gray(`Prefetched next market: ${nextMarket.slug}`));
          } catch {
            // Next market often appears late in Gamma; keep retrying quietly until current market ends.
          } finally {
            nextMarketPrefetchPromise = null;
          }
        })();
      };

      const snapshotKey = (snapshot: PriceSnapshot): string => {
        return [
          snapshot.source,
          snapshot.receivedAt,
          snapshot.marketTimestampMs ?? "na",
          snapshot.upBuyPrice,
          snapshot.upSellPrice,
          snapshot.downBuyPrice,
          snapshot.downSellPrice,
        ].join("|");
      };

      const processSnapshot = async (snapshot: PriceSnapshot, trigger: "websocket" | "rest"): Promise<void> => {
        if (!(await assertCollateralGuardSafe(`before_${trigger}_decision`))) {
          return;
        }
        const currentTime = getCurrentTime();
        const remainingSeconds = endTimestamp - currentTime;
        if (remainingSeconds <= 0) {
          marketClosed = true;
          return;
        }
        if (remainingSeconds <= NEXT_MARKET_PREFETCH_WINDOW_SECS) {
          prefetchNextMarket();
        }

        const now = Date.now();
        if (!latestExternalReference || now - lastExternalReferenceFetchAtMs >= EXTERNAL_REFERENCE_REFRESH_MS) {
          refreshExternalReference();
        }
        if (trade.priceToBeat === null || trade.finalPrice === null) {
          refreshMarketBenchmark();
        }

        trade.updatePrices(
          remainingSeconds,
          snapshot.upBuyPrice,
          snapshot.upSellPrice,
          snapshot.downBuyPrice,
          snapshot.downSellPrice,
        );
        trade.lastDecisionSnapshotSource = trigger;
        trade.latestFeedAgeMs = snapshot.staleMs;
        trade.latestFeedLatencyMs = snapshot.latencyMs;
        trade.latestFeedSnapshotSource = snapshot.source;
        const currentFeedStats = marketFeed.getStats();
        trade.latestFeedWsConnected = currentFeedStats.wsConnected;
        trade.latestFeedRttMs = currentFeedStats.lastRttMs;
        trade.latestFeedFallbackCount = currentFeedStats.fallbackCount;
        trade.latestFeedLastFallbackReason = currentFeedStats.lastFallbackReason;
        trade.latestFeedLastFallbackAt = currentFeedStats.lastFallbackAt;
        trade.latestFeedMsSinceLastFallback = currentFeedStats.msSinceLastFallback;
        trade.latestFeedWasInFallbackRecently = currentFeedStats.msSinceLastFallback !== null && currentFeedStats.msSinceLastFallback <= 2000;
        trade.latestExternalPriceUsd = latestExternalReference?.priceUsd ?? null;
        trade.latestExternalPriceSource = latestExternalReference?.source ?? null;
        trade.latestExternalPriceFetchedAt = latestExternalReference?.fetchedAt ?? null;

        await writeTelemetryEventSafe("feed.tick", {
          slug,
          source: snapshot.source,
          eventType: `decision_trigger_${trigger}`,
          latencyMs: snapshot.latencyMs,
          staleMs: snapshot.staleMs,
          marketTimestampMs: snapshot.marketTimestampMs,
          receivedAt: snapshot.receivedAt,
          priceToBeat: trade.priceToBeat,
          finalPrice: trade.finalPrice,
          priceToBeatSource: trade.priceToBeatSource,
        });
        await trade.make_trading_decision();
      };

      const flushLatestSnapshot = async (): Promise<void> => {
        if (processingSnapshot || !latestPendingSnapshot || marketClosed) {
          return;
        }

        const snapshot = latestPendingSnapshot;
        const key = snapshotKey(snapshot);
        const now = Date.now();
        if (key === lastProcessedSnapshotKey) {
          latestPendingSnapshot = null;
          return;
        }
        if (now - lastDecisionAtMs < MIN_DECISION_SPACING_MS) {
          return;
        }

        processingSnapshot = true;
        latestPendingSnapshot = null;
        try {
          await processSnapshot(snapshot, snapshot.source);
          lastProcessedSnapshotKey = key;
          lastDecisionAtMs = Date.now();
        } catch (error) {
          if (isCollateralEgressViolation(error)) {
            throw error;
          }
          console.error(chalk.red("Market loop error:"), error);
          await writeTelemetryEventSafe("feed.error", {
            slug,
            source: "market_loop",
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          processingSnapshot = false;
          if (latestPendingSnapshot && !marketClosed) {
            void flushLatestSnapshot();
          }
        }
      };

      const unsubscribe = marketFeed.subscribe((snapshot) => {
        latestPendingSnapshot = snapshot;
        void flushLatestSnapshot();
      });

      while (true) {
        try {
          await processManualTradeRequest(trade);
          if (!(await assertCollateralGuardSafe("market_loop"))) {
            await sleep(FALLBACK_SAFETY_POLL_MS);
            continue;
          }
          if (trade.priceToBeat === null || trade.finalPrice === null) {
            refreshMarketBenchmark();
          }
          const remainingSeconds = endTimestamp - getCurrentTime();
          if (remainingSeconds <= 0) {
            marketClosed = true;
            await reconcileMarketCloseExposure(trade, slug);
            await trade.emitShadowPnlTelemetry();
            if (PAPER_TRADING) {
              paperBalance = roundCurrency(trade.totalValue());
              await savePersistedPaperBalance(paperBalance);
              await writeTelemetryEventSafe("paper_balance.checkpoint", {
                reason: "market_end",
                balance: paperBalance,
                slug,
              });
            }
            await marketFeed.emitSummaryTelemetry("market_end");
            unsubscribe();
            break;
          }
          if (remainingSeconds <= NEXT_MARKET_PREFETCH_WINDOW_SECS) {
            prefetchNextMarket();
          }

          const stats = marketFeed.getStats();
          const graceActive = Date.now() < trade.marketTransitionGraceUntilMs;
          if (!processingSnapshot && !graceActive && (!stats.wsConnected || Date.now() - lastDecisionAtMs >= 1000)) {
            const snapshot = await marketFeed.getLatestSnapshot();
            if (snapshot) {
              latestPendingSnapshot = snapshot;
              await flushLatestSnapshot();
            }
          }
        } catch (error) {
          if (isCollateralEgressViolation(error)) {
            throw error;
          }
          console.error(chalk.red("Market loop error:"), error);
          await writeTelemetryEventSafe("feed.error", {
            slug,
            source: "market_loop",
            error: error instanceof Error ? error.message : String(error),
          });
        }

        await new Promise(resolve => setTimeout(resolve, FALLBACK_SAFETY_POLL_MS));
      }
    } finally {
      activeMarketFeed = null;
      await marketFeed.stop();
    }
  }

}

main().catch(async (error) => {
  const blockedCollateral = isCollateralEgressViolation(error);
  console.error(chalk.red(blockedCollateral ? "Fatal collateral guard stop:" : "Fatal runtime error:"), error);
  if (PAPER_TRADING) {
    const sessionBalance = await loadPersistedPaperBalance(PAPER_STARTING_USD);
    await savePersistedPaperBalance(sessionBalance);
    await writeTelemetryEventSafe("bot.shutdown", {
      reason: "startup_error",
      endingBalance: sessionBalance,
    });
  }
  await writeTelemetryEventSafe("bot.error", {
    stage: blockedCollateral ? "collateral_guard" : "runtime",
    error: error instanceof Error ? error.message : String(error),
    details: blockedCollateral ? error.details : undefined,
  });
  process.exit(1);
});
