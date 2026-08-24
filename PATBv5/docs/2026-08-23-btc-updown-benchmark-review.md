# BTC Up/Down Benchmark Review

Date: 2026-08-23  
Status: Investigated; no runtime changes retained

## Scope

This note records the review of the LIVE session:

`polydb/telemetry/sessions/2026-08-23T15-40-26-455Z__cff86faa-cec1-4a90-937e-63eadb616b95.jsonl`

The reviewed market was `btc-updown-5m-1787502900`, shown in Polymarket as BTC Up or Down 5m, 12:35-12:40 PM ET.

## Observed trade

- The bot bought 7 `Up` contracts at `0.71` around 12:35:21 PM ET.
- It exited by stop loss about 69 seconds later.
- Telemetry records a provider-confirmed exit fill at `0.55`, producing `-$1.15` (`-23%`) on a `$5` cost basis.
- The Polymarket UI screenshot displayed a sale at `0.60` (`$4.20`). The raw telemetry is the audit source because it marks the `0.55` fill as `provider_matched_response`.

## Benchmark discrepancy

The UI showed a contract price to beat of `$77,365.53`. The bot telemetry recorded `$77,379.005` with source `coinbase_spot_fallback`.

The discrepancy happened because `src/index.ts` fetches Coinbase spot data for BTC momentum. When the official Polymarket metadata was unavailable, that spot value was also assigned to `trade.priceToBeat` as a fallback.

This is misleading telemetry: Coinbase spot is not necessarily the contract's official settlement/opening price and must not be presented as though it were.

## Important correction to the initial assessment

Review of `src/trade/decision.ts` found that the entry strategy does not use `priceToBeat` to select the side or calculate the entry. The trade used market prices, momentum, Monte Carlo convergence, and feed-health checks. `priceToBeat` is included in telemetry and diagnostics only.

Therefore, the `$13.48` benchmark difference is a data-semantics and observability issue. It does not, by itself, establish that the fallback caused this losing trade.

## Temporary change and rollback

A temporary change was made to:

- prevent Coinbase from being assigned to `priceToBeat`;
- reject new entries when no official Polymarket price to beat was available; and
- add a focused test for that gate.

That change was rolled back at the user's request. The following files are back to their prior behavior:

- `src/index.ts`
- `src/trade/decision.ts`
- `package.json`
- no new test file remains

No runtime change from this review should be assumed to be active.

## Follow-up options

1. Improve telemetry only: retain Coinbase for momentum, but expose it as `externalPriceUsd` and leave `priceToBeat` null until Polymarket metadata is resolved.
2. Add an explicit canonical benchmark gate only after confirming that the strategy should require the official contract benchmark before entry.
3. Investigate the `0.60` UI versus `0.55` provider-confirmed fill discrepancy as a separate execution-history or reconciliation display issue.

## Validation note

The focused test and TypeScript build were attempted through the Windows Node installation, but the WSL environment returned `UtilBindVsockAnyPort:307`. Because the temporary code was rolled back, no new test result applies to the current runtime.

Today is Sunday, August 23, 2026
# =====================================================

Analiza este incidente del bot PATBv5 sin modificar código. Quiero un reporte técnico, preciso y cronológico sobre el fix temporal y su rollback.

Contexto:
- Sesión LIVE revisada:
  C:\Projects\lkcsite\polydb\telemetry\sessions\2026-08-23T15-40-26-455Z__cff86faa-cec1-4a90-937e-63eadb616b95.jsonl
- Mercado: btc-updown-5m-1787502900, BTC Up or Down 5m, 12:35-12:40 PM ET.
- El bot compró 7 contratos Up a 0.71 y la telemetría registró salida stop loss a 0.55, PnL -$1.15.
- La UI de Polymarket mostraba un Price To Beat de $77,365.53.
- La telemetría del bot registró priceToBeat $77,379.005 con source=coinbase_spot_fallback.
- La UI mostraba venta a 0.60, pero la telemetría tenía fill conciliado con provider_matched_response a 0.55.

Fix temporal aplicado:
1. Se eliminó que Coinbase spot se copiara a trade.priceToBeat cuando faltaba metadata oficial de Polymarket.
2. Se añadió un gate para rechazar nuevas entradas con reason=official_benchmark_unavailable si no existía un priceToBeat oficial.
3. Se añadió una prueba unitaria y un script npm para ese gate.

Rollback:
- El usuario pidió rollback.
- Se revirtieron únicamente los cambios introducidos en:
  - PATBv5/src/index.ts
  - PATBv5/src/trade/decision.ts
  - PATBv5/package.json
  - PATBv5/tests/official_benchmark.test.ts
- El comportamiento actual volvió a permitir que Coinbase sea usado como coinbase_spot_fallback para priceToBeat.

Corrección importante:
- Verificar el código de PATBv5/src/trade/decision.ts: priceToBeat se incluía en telemetría y diagnósticos, pero no era usado para seleccionar la dirección de entrada ni calcular la entrada de esta estrategia.
- Por tanto, la diferencia entre $77,365.53 y $77,379.005 es un problema de semántica/observabilidad, pero no prueba que haya causado esta pérdida.
- Coinbase sí se usa como referencia externa para momentum; ese uso no debe confundirse con el benchmark oficial del contrato.

Entrega:
1. Timeline exacto del incidente.
2. Qué hacía el código antes del fix.
3. Qué cambiaba el fix temporal.
4. Por qué el fix podía ser una mejora de observabilidad, pero también alteraba el comportamiento de entradas.
5. Qué se revirtió y cuál es el estado actual.
6. Diferenciar claramente hechos confirmados, inferencias y pendientes.
7. Explicar por separado la discrepancia de ejecución UI 0.60 vs telemetría conciliada 0.55.
8. No proponer ni aplicar cambios de código.
