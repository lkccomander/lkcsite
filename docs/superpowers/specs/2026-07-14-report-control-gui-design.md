# Report Control GUI Design

**Date:** 2026-07-14  
**Status:** Approved design  
**Scope:** `PATBv5` report server and static report workflow

## Context

`PATBv5` already generates a static session report with:

```powershell
npm run report -- --file "C:\Projects\lkcsite\polydb\telemetry\sessions\<session>.jsonl"
```

It also exposes an Express server through `npm run report:serve`. That server currently renders the live report and includes a basic embedded checker page, but it does not provide a session-log browser, an asynchronous report-generation workflow, or a searchable report library.

The new Report Control GUI will extend `report:serve`. It will reuse the existing parser, anomaly checks, gate checks, and HTML renderer so CLI and GUI output remain equivalent.

## Goals

1. List telemetry session logs from the repository telemetry directory, newest first.
2. Allow a user to upload a `.jsonl` file that is not already in the listed directory.
3. Generate a static HTML report from the selected source without blocking the page.
4. Open a completed report in a new browser tab.
5. Maintain a persistent report history across server restarts.
6. List existing and newly generated reports with PAPER, LIVE, or UNKNOWN classification.
7. Keep the current CLI command and existing report rendering behavior working.
8. Preserve the existing checker endpoints and report-server capabilities.

## Non-goals

- Deleting telemetry logs or reports from the GUI.
- Editing telemetry events.
- Changing report calculations or trading analytics.
- Moving Report Control into `newGui`.
- Building an Electron, Tauri, or other desktop application.
- Supporting arbitrary filesystem paths supplied by browser clients.

## Architecture

The solution remains inside the existing Express report server and requires no separate frontend build.

### Modules

- **Report generation service:** owns the shared parse → analyze → render → write pipeline. The CLI and GUI both call this service.
- **Source catalog:** discovers repository session logs and registers uploaded files.
- **Job manager:** queues report-generation work, persists job transitions, and exposes job status.
- **Report catalog:** persists metadata for new reports and discovers legacy HTML reports.
- **Report Control pages:** modular HTML, CSS, and browser JavaScript for the generator and history views.
- **Express routes:** validate requests, call the catalogs/job manager, and serve the GUI and report files.

The report server will no longer keep the complete GUI document inline in `server.ts`; presentation markup and client behavior will live in focused report-control modules.

## Filesystem Layout

Paths are resolved relative to the repository and `PATBv5` runtime directory; no absolute user-specific path is hard-coded.

- Discovered logs: `polydb/telemetry/sessions/*.jsonl` at the repository root.
- Uploaded logs: `PATBv5/polydb/report-uploads/`.
- Generated reports: `PATBv5/polydb/reports/`.
- Persistent report index: `PATBv5/polydb/reports/report-index.json`.
- Persistent job ledger: `PATBv5/polydb/reports/report-jobs.json`.

Uploaded files receive a sanitized, collision-resistant filename. The original display name is retained in report metadata.

## Navigation and Pages

### `/generator`

The default Report Control page uses the approved **Mission Control** layout:

- Top navigation with Generator and History.
- Primary source-selection panel.
- Latest session preselected when available.
- Toggle between discovered sessions and manual upload.
- Source preview showing filename, size, modification time, session ID, and detected mode.
- Prominent **Generate Report** action.
- Job status panel with queued/running/completed/failed state and execution messages.
- Recent reports rail showing the newest report records and PAPER/LIVE/UNKNOWN badges.

The root route `/` redirects to `/generator`.

### `/reports`

The history page lists legacy and new reports, newest first. It provides:

- Text search.
- Mode filters: ALL, PAPER, LIVE, UNKNOWN.
- Date filtering.
- Source filename, session ID, generated timestamp, report status, and mode badge.
- **Open report** and **Show source details** actions.

No delete action is included.

### Visual Direction

The interface uses an operational telemetry aesthetic:

- Charcoal background with restrained depth and grid texture.
- Acid green primary actions and focus states.
- Distinct green PAPER, warm red LIVE, and neutral gray UNKNOWN badges.
- `Bahnschrift` for display hierarchy and `Cascadia Code` for telemetry data, with safe fallbacks.
- Compact information density, strong keyboard focus states, responsive stacking, and reduced-motion support.

## Server API

### Sources

- `GET /api/report-sources`
  - Returns discovered and uploaded sources, newest first.
  - The response exposes a server-issued `sourceId`, never an arbitrary callable path.
- `POST /api/report-sources/upload`
  - Accepts one `.jsonl` body as a streamed upload.
  - The original name is supplied as validated metadata.
  - Rejects invalid extensions, empty files, oversized files, and path-like filenames.

### Jobs

- `POST /api/report-jobs`
  - Body: `{ "sourceId": "..." }`.
  - Resolves the source through the server-side catalog and queues generation.
  - Returns the job ID immediately.
- `GET /api/report-jobs/:jobId`
  - Returns `queued`, `running`, `completed`, or `failed`, plus progress messages and the completed report URL when available.

Jobs run one at a time to prevent concurrent report parsing from creating avoidable CPU and memory pressure. Additional jobs remain queued.

### Reports

- `GET /api/reports`
  - Returns the merged catalog of indexed and legacy reports.
  - Supports search, mode, and date query filters.
- `GET /api/reports/:reportId`
  - Returns report and source metadata.
- `GET /reports/files/:fileName`
  - Serves a generated HTML report after canonical path and extension validation.

Existing `/report`, `/report.json`, `/health`, `/events`, and checker routes remain available.

## Generation Flow

1. The browser loads sources, jobs, and recent reports in parallel.
2. The newest discovered session is selected by default.
3. Selecting a source loads its metadata preview.
4. Clicking **Generate Report** creates a job and synchronously opens a placeholder tab to avoid popup blocking.
5. The job manager calls the shared report-generation service.
6. The service parses the complete selected `.jsonl`, detects anomalies and gate checks, renders the existing report template, and writes a timestamped HTML file.
7. The report catalog atomically updates `report-index.json`.
8. The generator refreshes recent reports and navigates the placeholder tab to the completed HTML URL.
9. On failure, the placeholder shows the failure state and the generator retains diagnostic output and a retry action.

## Data Model

### Report source

```ts
interface ReportSourceSummary {
  id: string;
  kind: 'session' | 'upload';
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  sessionIds: string[];
  mode: 'PAPER' | 'LIVE' | 'UNKNOWN';
}
```

The internal absolute path is never returned to the browser.

### Report job

```ts
interface ReportJob {
  id: string;
  sourceId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  messages: string[];
  reportId: string | null;
  reportUrl: string | null;
  error: string | null;
}
```

### Report record

```ts
interface ReportRecord {
  id: string;
  fileName: string;
  sourceName: string | null;
  sourceKind: 'session' | 'upload' | 'legacy';
  generatedAt: string;
  sessionIds: string[];
  mode: 'PAPER' | 'LIVE' | 'UNKNOWN';
  status: 'completed' | 'legacy';
  legacy: boolean;
}
```

## Mode Detection

Mode classification follows this precedence:

1. Normalize `SessionReport.mode` to PAPER or LIVE when present.
2. Infer PAPER from paper-trade events or LIVE from live-trade events when the report mode is absent.
3. For legacy HTML, inspect embedded report content or visible mode fields.
4. Return UNKNOWN when evidence is missing or contradictory.

The system does not infer mode from a filename alone.

## Persistence and Recovery

- A successfully generated report is indexed only after its HTML write completes.
- Index updates use write-to-temporary-file followed by rename to avoid partial JSON.
- Job transitions are written atomically to the persistent job ledger.
- The catalog rebuilds missing legacy entries by scanning report HTML files.
- Duplicate catalog entries are merged by canonical report filename.
- On server startup, persisted queued or running jobs become failed/interrupted; completed report records remain available.
- A corrupt index is reported clearly and legacy report discovery continues without overwriting the corrupt file.

## Security and Validation

- All browser actions use opaque IDs resolved through server-maintained catalogs.
- Canonical path checks restrict reads and writes to the configured telemetry, upload, and report roots.
- Uploaded filenames are reduced to a safe basename and cannot contain traversal segments.
- Uploads must use `.jsonl`, contain data, and remain below the configured size limit.
- Uploads stream to disk instead of loading the entire file in memory.
- Report filenames are generated by the server.
- Browser-rendered names and errors are escaped before insertion into HTML.
- Generation arguments never pass through a shell command string.

## Error Handling

- Invalid source IDs return 404.
- Invalid uploads return 400 or 413 with a user-readable reason.
- Parse and render failures mark the job failed and preserve a sanitized diagnostic message.
- Missing source files are reported without removing unrelated history records.
- A failed history/index refresh does not prevent generation when the selected source is still valid.
- The UI provides explicit empty, loading, running, completed, failed, and offline states.

## Testing

Automated tests cover:

1. Session discovery, `.jsonl` filtering, and newest-first ordering.
2. Source IDs and canonical path restrictions.
3. Safe upload naming, extension checks, streamed writes, and size limits.
4. PAPER, LIVE, and UNKNOWN mode detection.
5. Shared CLI/GUI report generation output.
6. Job queue transitions and failure capture.
7. Atomic report index writes and restart reload.
8. Legacy HTML discovery, deduplication, and fallback classification.
9. API success and error responses.
10. Generator/history page route rendering and required accessibility states.

Final verification includes:

- Targeted Report Control tests.
- Existing report tests.
- `npm run build` from `PATBv5`.
- A real generation run using `C:\Projects\lkcsite\polydb\telemetry\sessions\2026-07-14T23-58-07-959Z__6702dc55-91b8-4c58-9104-d69efe8a3baf.jsonl`.
- Manual confirmation that the completed report opens in a new tab and appears in `/reports` with its correct mode.

## Acceptance Criteria

The feature is complete when:

- `npm run report:serve` exposes `/generator` and `/reports` without another frontend process.
- The newest repository log is preselected and any listed log can be selected.
- A valid external `.jsonl` can be uploaded and selected.
- Generating from the approved sample creates the same report content as the CLI pipeline.
- Job status is visible and failures are actionable.
- Completion opens the report in a new tab.
- Existing and new reports appear newest first in the history.
- New reports show the correct PAPER or LIVE badge; indeterminate legacy reports show UNKNOWN.
- The existing CLI, live report, health, event-stream, and checker workflows remain functional.
