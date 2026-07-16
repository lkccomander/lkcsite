# Feed TLS and Report Priorities Design

## Context

The PAPER session `3c5e6729-8640-4a83-a89e-8fc1e2e8a783` confirmed that reconnects forced by stale order books fell from 65 to 1. However, the session still recorded 489 feed fallbacks, 1,099 disconnects, and 967 scheduled reconnects over approximately 13 hours.

The dominant incident was a two-hour burst of 890 WebSocket failures with `EE certificate key too weak`. The failure was transient: current direct TLS handshakes to `clob.polymarket.com` and `ws-subscriptions-clob.polymarket.com` validate successfully with TLS 1.3 and a valid Google Trust Services certificate.

The generated report also under-reported recovery activity. It displayed zero reconnect events and empty fallback reasons even though those events and reasons were present in the source telemetry.

## Goals

1. Prevent certificate-policy failures from creating rapid reconnect churn.
2. Preserve normal TLS certificate and hostname verification.
3. Provide a pre-session readiness command that tests the public Polymarket endpoints without credentials.
4. Make report feed metrics match the source telemetry.
5. Produce concise, non-duplicated, evidence-based report Actions.
6. Protect all changes with focused regression tests.

## Non-goals

- Do not disable TLS verification with `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- Do not lower the OpenSSL security level or allow weak certificates.
- Do not change live/PAPER trading thresholds based on this single session.
- Do not automatically start another trading session.
- Do not attempt to repair external certificates or operating-system trust stores from the bot.

## Design

### 1. TLS incident classification and reconnect policy

Introduce a small, pure classifier for transport errors. It will normalize the error message and code and identify certificate-policy failures such as `EE certificate key too weak` and the corresponding OpenSSL error codes.

The market feed will record structured diagnostics for every socket error, including `errorName`, `errorCode`, `causeCode`, and the normalized reconnect category. Ordinary transient socket failures continue using the existing exponential reconnect schedule.

Certificate-policy failures use a dedicated circuit-breaker delay. The delay must be long enough to avoid hundreds of retries during an external certificate incident and must be capped. A successful WebSocket connection resets the circuit breaker. Telemetry will expose the category and selected delay so the report can distinguish TLS incidents from ordinary code 1006 closures.

The implementation must not supply `rejectUnauthorized: false`, modify cipher security levels, or bypass hostname validation.

### 2. Readiness check

Add an npm script that performs credential-free checks before a session:

- HTTPS/TLS handshake to `clob.polymarket.com`;
- TLS handshake and short WebSocket open attempt to `ws-subscriptions-clob.polymarket.com`;
- certificate authorization, protocol, cipher, issuer, expiry, and public-key size;
- clear pass/fail output and non-zero exit status when a required endpoint is unsafe or unavailable.

The check will use the same secure defaults as the runtime. It is diagnostic only and will not mutate configuration.

### 3. Report feed accounting

Extend `SessionReport` and `FeedWindow` with explicit counters for:

- scheduled reconnects;
- forced reconnects;
- disconnects and close codes;
- WebSocket error categories;
- fallback reasons.

The parser will consume raw `feed.fallback`, `feed.reconnect_scheduled`, `feed.reconnect_forced`, `feed.disconnected`, and `feed.error` events. Window attribution will use the event slug and timestamp. Summary-event values may fill gaps but must not overwrite higher-fidelity raw counts.

The report UI and embedded JSON will show these counts consistently. Gate checks will use actual raw fallback totals. Feed Actions will name the dominant reason or transport error instead of reporting a generic pressure warning.

### 4. Action quality

Actions will be aggregated rather than emitted once per matching trade:

- one convergence action per affected side, with loss count and observed range;
- one fast-stop action summarizing count, PnL, and hold-time range;
- one feed incident action per material window, including dominant fallback/reconnect reason;
- no recommendation to raise a global MC threshold solely because one loss falls below 0.68.

The session showed that DOWN lost money while the accepted DOWN trades had Monte Carlo directions pointing UP. The report may expose that mismatch as evidence, but it will not automatically change the strategy threshold.

### 5. Error handling

- A readiness failure returns a non-zero exit code and a remediation-oriented message.
- Runtime TLS incidents remain visible in telemetry and do not silently downgrade security.
- Report parsing tolerates missing optional payload fields and places them in an `unknown` category.
- Existing reports without the new fields render with zero/default values.

## Testing

Add focused tests for:

1. TLS error classification from messages and error codes.
2. Certificate-policy reconnect delay and reset after a successful connection.
3. Readiness output using injectable TLS/WebSocket probes rather than live network calls.
4. Parsing raw reconnect, disconnect, forced reconnect, fallback-reason, and TLS-error events.
5. Window-level counter attribution.
6. Action deduplication and side-aware convergence evidence.
7. Backward-compatible rendering with old report fixtures.

Run the TypeScript build, focused feed/report tests, complete test suite, and report generation against the captured session. Compare generated JSON totals with an independent telemetry aggregation.

## Acceptance criteria

- A repeated weak-certificate incident cannot schedule rapid reconnects at the normal 250 ms base delay.
- TLS verification remains enabled everywhere.
- The readiness command fails safely for an injected weak-certificate error and passes for valid probes.
- A report generated from the captured session shows approximately 967 scheduled reconnects, 1 forced reconnect, 1,099 disconnects, and the actual fallback-reason breakdown, subject only to the report cutoff timestamp.
- The Actions section contains no duplicate convergence recommendation and summarizes fast stop-losses.
- All focused tests, builds, and the full test suite pass.
