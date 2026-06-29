# PATBv5 Session Origin Hostname Design

## Goal

Make each PATBv5 telemetry session self-describing by recording the machine hostname that produced it.

This is meant to let us distinguish Pi-generated sessions from desktop/local sessions directly from the session `.jsonl` data, without inferring origin from file copies, folder paths, or checker logs.

## Scope

In scope:

- Add an automatically detected machine-origin field to telemetry events written by `PATBv5/src/telemetry/db.ts`
- Ensure the field is present in per-session `.jsonl` output
- Preserve the current session filename format and existing session lookup behavior

Out of scope:

- Renaming session files
- Reworking checker batching or readiness logic
- Adding manual CLI flags for origin labeling
- Adding host-specific filtering/report UI in this change

## Current Problem

The current telemetry schema identifies `botId`, `sessionId`, and `sessionStartedAt`, but it does not identify which machine created the session.

Because the same bot can run on different hosts, we cannot tell from the session file alone whether a failing or healthy session came from a Raspberry Pi or from another machine. That makes debugging infrastructure-specific issues slower and encourages indirect guesses.

## Approaches Considered

### 1. Add hostname to every telemetry event

Pros:

- Every event remains self-describing
- Any downstream parser can recover origin without needing special-case logic
- Session `.jsonl` files become immediately attributable even if only a subset of lines is inspected

Cons:

- Slightly increases telemetry size on every line

### 2. Add hostname only to startup events

Pros:

- Lower telemetry volume
- Minimal schema expansion

Cons:

- Downstream tools must locate and trust the startup event
- Partial session slices become harder to attribute

### 3. Add hostname to the session filename

Pros:

- Human-visible in the filesystem immediately

Cons:

- Higher compatibility risk for scripts that assume the current `timestamp__sessionId.jsonl` shape
- Does not help tools that only parse event JSON payloads

## Recommendation

Use approach 1.

Add a new top-level telemetry event field named `originHost`, populated automatically from the machine hostname when the process runs. Keep the filename unchanged.

This gives the cleanest provenance signal with the lowest operational risk because all existing consumers already parse JSON events and tolerate additive fields much better than filename changes.

## Design

### 1. Telemetry schema

Extend `TelemetryEvent` in `PATBv5/src/telemetry/db.ts` with:

- `originHost?: string`

This should sit alongside the existing top-level identity fields:

- `botId`
- `sessionId`
- `sessionStartedAt`
- `versionContext`

The field should be top-level rather than nested inside `payload` so it is consistent across all event types and easy for existing scripts to access.

### 2. Hostname source

Resolve the hostname automatically inside the telemetry module rather than requiring a caller to pass it through every write path.

Preferred source:

- Node `os.hostname()`

Behavior:

- Read once at module load or once per process
- Reuse the same value for all events in the process
- If hostname resolution fails or returns an empty string, omit the field rather than throwing

### 3. Write path

Update `writeTelemetryEvent` in `PATBv5/src/telemetry/db.ts` so every serialized event includes `originHost` when available.

This ensures the field is written to both:

- shared telemetry database: `polydb/telemetry/events.jsonl`
- per-session file: `polydb/telemetry/sessions/<timestamp>__<sessionId>.jsonl`

No call sites should need to change because the origin is injected centrally.

### 4. Session object

Optional but recommended in the same change:

- extend the in-memory `TelemetrySession` type with `originHost: string | null`

This is not required for the `.jsonl` goal, but it creates a clean future path if checker/report tooling later wants to print session origin without reparsing event lines.

## Error Handling

- Hostname lookup must never block telemetry writes
- If hostname is unavailable, event writing should continue unchanged
- Existing telemetry-safe behavior remains the guardrail; origin attribution is diagnostic metadata, not a required dependency

## Compatibility

- Additive schema change only
- Existing JSONL readers that ignore unknown fields should continue to work unchanged
- Session filename format remains unchanged, so checker scripts and path-based session lookup remain stable

## Testing

Add focused tests around telemetry serialization:

1. Event serialization includes `originHost` when hostname is available
2. Session file output preserves `originHost`
3. Telemetry writing still succeeds when hostname resolution is unavailable or blank

If the current test setup makes hostname stubbing awkward, a small helper function for hostname resolution is acceptable so the behavior can be tested deterministically.

## Risks

- A few consumers may have overly strict event typing and need a small type update if they deserialize into exact shapes
- Snapshot-style tests may need to be adjusted if they assert full event JSON
- Hostname values may differ in formatting across environments, so downstream comparisons should treat them as opaque strings

## Success Criteria

- New telemetry events contain `originHost`
- New session `.jsonl` files can be attributed to the producing machine without external context
- Existing checker/session lookup flows continue to work without filename changes
- The change does not introduce new telemetry write failures
