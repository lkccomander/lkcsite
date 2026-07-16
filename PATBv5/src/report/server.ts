// src/report/server.ts
import express from 'express';
import path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { parseTelemetry } from './parser';
import { detectAnomalies, evaluateGateChecks } from './anomalies';
import { renderReportHtml } from './renderer';
import { SessionReport } from './types';
import { createReportControlRouter } from './control/router';

const app = express();
let lastParsedAt: string | null = null;
const checkerJobs = new Map<string, {
  sessionId: string;
  status: 'running' | 'completed' | 'failed';
  output: string;
  startedAt: string;
  finishedAt: string | null;
}>();

app.use(express.json({ limit: '2mb' }));
app.use(createReportControlRouter());

function resolveDefaultTelemetryFile(): string {
  return path.resolve(process.cwd(), '..', 'polydb', 'telemetry', 'events.jsonl');
}

function resolveCheckerScript(): string {
  return path.resolve(process.cwd(), 'checker.ps1');
}

async function buildReport(): Promise<SessionReport> {
  const report = await parseTelemetry([resolveDefaultTelemetryFile()], 50000);
  report.anomalies = detectAnomalies(report);
  report.gateChecks = evaluateGateChecks(report);
  lastParsedAt = new Date().toISOString();
  return report;
}

function startCheckerJob(sessionId: string): string {
  const jobId = randomUUID();
  const scriptPath = resolveCheckerScript();

  checkerJobs.set(jobId, {
    sessionId,
    status: 'running',
    output: '',
    startedAt: new Date().toISOString(),
    finishedAt: null
  });

  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-SessionID',
      sessionId
    ],
    { cwd: process.cwd() }
  );

  const appendOutput = (chunk: Buffer | string) => {
    const job = checkerJobs.get(jobId);
    if (!job) {
      return;
    }
    job.output += chunk.toString();
  };

  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);

  child.on('close', (code) => {
    const job = checkerJobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = code === 0 ? 'completed' : 'failed';
    job.finishedAt = new Date().toISOString();
  });

  child.on('error', (error) => {
    const job = checkerJobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = 'failed';
    job.output += `\n${String(error)}\n`;
    job.finishedAt = new Date().toISOString();
  });

  return jobId;
}

app.get('/checker', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>LKCsite Telemetry Tools</title>
        <style>
          :root {
            --bg: #0f172a;
            --panel: #111827;
            --panel-2: #1e293b;
            --line: #334155;
            --text: #e2e8f0;
            --muted: #94a3b8;
            --accent: #38bdf8;
            --accent-2: #22c55e;
            --warn: #f59e0b;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: 'Inter', system-ui, sans-serif;
            background:
              radial-gradient(circle at top left, rgba(56,189,248,0.10), transparent 30%),
              radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 25%),
              var(--bg);
            color: var(--text);
          }
          .container {
            max-width: 980px;
            margin: 0 auto;
            padding: 32px 20px 40px;
          }
          .hero {
            margin-bottom: 24px;
          }
          .hero h1 {
            margin: 0 0 8px;
            font-size: 28px;
          }
          .hero p {
            margin: 0;
            color: var(--muted);
            line-height: 1.6;
          }
          .grid {
            display: grid;
            grid-template-columns: 1.4fr 1fr;
            gap: 16px;
          }
          .card {
            background: rgba(15, 23, 42, 0.78);
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 18px;
            box-shadow: 0 10px 30px rgba(0,0,0,.18);
            backdrop-filter: blur(10px);
          }
          .card h2 {
            margin: 0 0 10px;
            font-size: 16px;
          }
          .eyebrow {
            margin-bottom: 8px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
            color: var(--accent);
          }
          .field {
            margin-bottom: 14px;
          }
          .field label {
            display: block;
            margin-bottom: 6px;
            font-size: 12px;
            color: var(--muted);
          }
          .session-box, .log-box {
            width: 100%;
            border: 1px solid var(--line);
            border-radius: 10px;
            background: var(--panel);
            color: var(--text);
            padding: 12px;
            font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
          }
          .session-box {
            height: 44px;
          }
          .log-box {
            min-height: 360px;
            resize: vertical;
          }
          .actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 10px;
          }
          .btn, .file-btn {
            appearance: none;
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: 10px 14px;
            font-weight: 700;
            cursor: pointer;
            color: var(--text);
            background: var(--panel-2);
          }
          .btn.primary {
            background: linear-gradient(135deg, #0ea5e9, #2563eb);
            border-color: #38bdf8;
          }
          .btn.secondary {
            background: rgba(30, 41, 59, 0.85);
          }
          .meta {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-top: 14px;
          }
          .meta .mini {
            background: rgba(30, 41, 59, 0.9);
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: 10px 12px;
          }
          .mini .label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: .06em;
            color: var(--muted);
            margin-bottom: 4px;
          }
          .mini .value {
            font-size: 13px;
            font-weight: 700;
          }
          code {
            background: rgba(30, 41, 59, 0.95);
            border: 1px solid var(--line);
            padding: 2px 6px;
            border-radius: 6px;
          }
          .hint {
            color: var(--muted);
            font-size: 12px;
            line-height: 1.7;
          }
          .links {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 14px;
          }
          .links a {
            color: var(--accent);
            text-decoration: none;
          }
          .output-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
          }
          .status {
            color: var(--warn);
            font-size: 12px;
            min-height: 18px;
            margin-top: 8px;
          }
          input[type="file"] {
            display: none;
          }
          @media (max-width: 860px) {
            .grid { grid-template-columns: 1fr; }
            .meta { grid-template-columns: 1fr; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="hero">
            <div class="eyebrow">Local Tool</div>
            <h1>LKCsite Telemetry Checker</h1>
            <p>
              Selecciona un archivo de <code>sessions/*.jsonl</code>, extrae el <code>sessionId</code>
              en el browser y corre <code>checker.ps1</code> desde el servidor local.
              El output completo aparece abajo en tiempo real al terminar la ejecución.
            </p>
          </div>

          <div class="grid">
            <div class="card">
              <h2>Session Runner</h2>
              <div class="field">
                <label>Archivo de sesión</label>
                <label class="file-btn" for="session-file">Browse session file</label>
                <input id="session-file" type="file" accept=".jsonl,.txt" />
              </div>

              <div class="field">
                <label>Session ID detectado</label>
                <input id="session-id" class="session-box" type="text" readonly placeholder="Select a session file first" />
              </div>

              <div class="actions">
                <button id="run-checker" class="btn primary" type="button" disabled>Run Checker</button>
                <button id="open-report" class="btn secondary" type="button" onclick="window.location.href='/report'">Open Live Report</button>
              </div>

              <div id="status" class="status"></div>

              <div class="meta">
                <div class="mini">
                  <div class="label">Selected File</div>
                  <div class="value" id="selected-file">None</div>
                </div>
                <div class="mini">
                  <div class="label">Detected Session</div>
                  <div class="value" id="selected-session">None</div>
                </div>
                <div class="mini">
                  <div class="label">Checker Script</div>
                  <div class="value">checker.ps1</div>
                </div>
              </div>
            </div>

            <div class="card">
              <h2>Available Endpoints</h2>
              <div class="hint">
                <p><a href="/report">/report</a> renders the current telemetry dashboard.</p>
                <p><a href="/report.json">/report.json</a> returns parsed report JSON.</p>
                <p><a href="/health">/health</a> returns current server health.</p>
                <p><a href="/reports">/reports</a> lists generated static HTML reports.</p>
                <p>CLI static report: <code>npm run report -- --tail 5000</code></p>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:16px;">
            <div class="output-head">
              <h2 style="margin:0;">Checker Output</h2>
              <button id="copy-output" class="btn secondary" type="button">Copy All</button>
            </div>
            <textarea id="checker-output" class="log-box" readonly placeholder="Checker output will appear here..."></textarea>
          </div>
        </div>
        <script>
          const fileInput = document.getElementById('session-file');
          const sessionIdInput = document.getElementById('session-id');
          const selectedFile = document.getElementById('selected-file');
          const selectedSession = document.getElementById('selected-session');
          const statusNode = document.getElementById('status');
          const runCheckerButton = document.getElementById('run-checker');
          const checkerOutput = document.getElementById('checker-output');
          const copyOutputButton = document.getElementById('copy-output');

          let detectedSessionId = '';

          function setStatus(message) {
            statusNode.textContent = message || '';
          }

          function extractSessionId(text) {
            const lines = text.split(/\\r?\\n/).filter(Boolean);
            for (const line of lines.slice(0, 40)) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.sessionId) {
                  return parsed.sessionId;
                }
              } catch (error) {
              }
            }
            return '';
          }

          fileInput.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            detectedSessionId = '';
            sessionIdInput.value = '';
            runCheckerButton.disabled = true;
            checkerOutput.value = '';

            if (!file) {
              selectedFile.textContent = 'None';
              selectedSession.textContent = 'None';
              setStatus('');
              return;
            }

            selectedFile.textContent = file.name;
            setStatus('Reading selected session file...');

            const text = await file.text();
            const sessionId = extractSessionId(text);

            if (!sessionId) {
              selectedSession.textContent = 'Not found';
              setStatus('No sessionId found in the selected file.');
              return;
            }

            detectedSessionId = sessionId;
            sessionIdInput.value = sessionId;
            selectedSession.textContent = sessionId;
            runCheckerButton.disabled = false;
            setStatus('Session ID detected. Ready to run checker.');
          });

          async function pollChecker(jobId) {
            const response = await fetch('/api/checker/' + jobId);
            const result = await response.json();

            if (!response.ok) {
              checkerOutput.value = result.error || 'Checker status failed.';
              setStatus('Checker failed.');
              runCheckerButton.disabled = false;
              return;
            }

            checkerOutput.value = result.output || '';

            if (result.status === 'running') {
              setStatus('Checker running...');
              setTimeout(() => pollChecker(jobId), 2000);
              return;
            }

            setStatus(result.status === 'completed' ? 'Checker finished.' : 'Checker failed.');
            runCheckerButton.disabled = false;
          }

          runCheckerButton.addEventListener('click', async () => {
            if (!detectedSessionId) {
              setStatus('Select a valid session file first.');
              return;
            }

            runCheckerButton.disabled = true;
            checkerOutput.value = 'Running checker.ps1...\\n';
            setStatus('Running checker...');

            try {
              const response = await fetch('/api/checker/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: detectedSessionId })
              });

              const result = await response.json();
              if (!response.ok) {
                checkerOutput.value = result.error || 'Checker failed.';
                setStatus('Checker failed.');
              } else {
                checkerOutput.value = result.output || 'Running checker.ps1...\\n';
                pollChecker(result.jobId);
              }
            } catch (error) {
              checkerOutput.value = String(error);
              setStatus('Checker request failed.');
            }
          });

          copyOutputButton.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(checkerOutput.value || '');
              setStatus('Checker output copied.');
            } catch (error) {
              setStatus('Unable to copy output.');
            }
          });
        </script>
      </body>
    </html>
  `);
});

app.post('/api/checker/start', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();

  if (!sessionId) {
    res.status(400).json({ ok: false, error: 'sessionId is required' });
    return;
  }

  try {
    const jobId = startCheckerJob(sessionId);
    res.json({ ok: true, sessionId, jobId, output: 'Running checker.ps1...\n' });
  } catch (error: any) {
    res.status(500).json({ ok: false, sessionId, error: String(error) });
  }
});

app.get('/api/checker/:jobId', (req, res) => {
  const job = checkerJobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({ ok: false, error: 'Checker job not found' });
    return;
  }

  res.json({
    ok: true,
    sessionId: job.sessionId,
    status: job.status,
    output: job.output,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  });
});

app.get('/report', async (req, res) => {
  try {
    const report = await buildReport();
    res.type('html').send(renderReportHtml(report));
  } catch (error) {
    res.status(500).send(`Failed to render report: ${String(error)}`);
  }
});

app.get('/report.json', async (req, res) => {
  try {
    const report = await buildReport();
    res.json(report);
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.get('/health', async (req, res) => {
  try {
    const report = await buildReport();
    res.json({ ok: true, lastParsed: lastParsedAt, sessions: report.sessionIds.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error), lastParsed: lastParsedAt, sessions: 0 });
  }
});

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const interval = setInterval(() => {
    res.write('data: {"type":"refresh"}\n\n');
  }, 5000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

export default app;
