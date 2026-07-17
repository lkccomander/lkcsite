# PAPER_TRADING `.env` Authority Design

## Context

`PATBv5/.env` contains `PAPER_TRADING=false`, but session
`fd6c1181-3793-479e-afbc-c00ec94ad1ad` started with telemetry mode `PAPER`.
The boolean parser correctly understands `false`. The conflict occurs earlier:
both Windows process inheritance and Node's default `dotenv` behavior give an
already-defined process variable precedence over the file.

The current `run_bot.ps1` loader follows the same rule. Its `Import-DotEnv`
function sets a value only when the process does not already contain that
variable. An isolated reproduction confirmed that an inherited
`PAPER_TRADING=true` remains effective after loading an `.env` containing
`PAPER_TRADING=false`.

## Requirement

When the bot is launched through `PATBv5/run_bot.ps1`, the single
`PAPER_TRADING` entry in `PATBv5/.env` is authoritative. A value inherited from
the parent PowerShell process must not override it.

This requirement applies to `run_bot.ps1`. The Python GUI may continue setting
`PAPER_TRADING` explicitly from its mode control, and direct `npm start` keeps
the existing Node environment precedence. PostgreSQL settings, Samba settings,
and secrets also keep their current precedence.

## Architecture

Move the launcher-specific environment functions into
`PATBv5/scripts/runtime_env.ps1`. The file exposes two focused functions:

- `Import-DotEnv` loads non-secret runtime configuration into the current
  process. It accepts `OverrideNames` for file-authoritative entries and
  `RequiredNames` for entries that must exist in the selected file.
- `Resolve-TradingMode` validates a `PAPER_TRADING` string and returns `PAPER`
  or `LIVE`.

`run_bot.ps1` dot-sources the helper, then loads `PATBv5/.env` with
`PAPER_TRADING` in both `OverrideNames` and `RequiredNames`. The PostgreSQL
`.env` is loaded afterward without overrides. Before build or bot execution,
the launcher resolves and prints the effective mode with `.env` identified as
the source.

## Data Flow

1. The parent process may contain any value for `PAPER_TRADING`.
2. `run_bot.ps1` loads `PATBv5/.env`.
3. The file's `PAPER_TRADING` value replaces the inherited process value.
4. `Resolve-TradingMode` validates the replaced value.
5. The launcher prints `Trading mode: PAPER` or `Trading mode: LIVE` with
   `source=PATBv5/.env`.
6. `npm run build` and `npm start` inherit that validated process value.
7. Node parses the same value and emits matching startup telemetry.

For the current configuration, `PAPER_TRADING=false` must produce `LIVE`.

## Validation Rules and Error Handling

The helper accepts the same boolean spellings as the Node parser:

- True: `1`, `true`, `yes`, `on`
- False: `0`, `false`, `no`, `off`

Matching is case-insensitive and ignores surrounding whitespace. If
`PATBv5/.env` is missing, lacks `PAPER_TRADING`, defines it more than once, or
contains an unsupported value, the launcher stops before the build and before
`npm start`. The error identifies the file and key without printing unrelated
configuration or secrets.

The loader does not use global `dotenv override` behavior. Only names passed in
`OverrideNames` replace inherited process values.

## Testing

Extend `PATBv5/scripts/check_run_bot_session_summary.ps1` to dot-source the
helper and exercise it against temporary `.env` files:

1. Inherited `true` plus file `false` results in process `false` and mode
   `LIVE`.
2. Inherited `false` plus file `true` results in process `true` and mode
   `PAPER`.
3. Missing `PAPER_TRADING` fails.
4. Duplicate `PAPER_TRADING` entries fail.
5. An invalid boolean fails.
6. A non-overridden process value remains unchanged, protecting the existing
   precedence of other settings.

The focused launcher test and Windows PowerShell parser check must pass. Tests
must not run `npm start`, launch the bot, or place orders.

## Scope

In scope:

- `PATBv5/run_bot.ps1`
- `PATBv5/scripts/runtime_env.ps1`
- `PATBv5/scripts/check_run_bot_session_summary.ps1`

Out of scope:

- Global changes to Node `dotenv` precedence
- Changes to the GUI mode selector
- Changes to trading decisions or order execution
- Changes to credentials, database schema, telemetry schema, or Samba behavior
- Starting a PAPER or LIVE session during verification

The existing Graphify report was generated from commit `77059b60` and is stale
relative to this work. It should be refreshed after implementation with:

```powershell
graphify . --backend nvidia --update
```
