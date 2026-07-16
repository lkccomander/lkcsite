type ControlPage = 'generator' | 'reports';

const styles = `
  :root {
    color-scheme: dark;
    --void: #070a0d;
    --surface: #0d1217;
    --surface-2: #121920;
    --surface-3: #182129;
    --line: #27323c;
    --line-hot: #43515e;
    --ink: #edf3f6;
    --muted: #87949f;
    --faint: #586570;
    --acid: #c8ff4d;
    --acid-dim: rgba(200, 255, 77, .12);
    --paper: #61eaa3;
    --live: #ff776b;
    --unknown: #9aa6b2;
    --warn: #ffc85b;
    --danger: #ff6b75;
    --shadow: 0 24px 80px rgba(0,0,0,.38);
  }
  * { box-sizing: border-box; }
  html { min-width: 320px; background: var(--void); }
  body {
    margin: 0;
    min-height: 100vh;
    color: var(--ink);
    font-family: "Bahnschrift", "Aptos", sans-serif;
    background:
      linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px),
      radial-gradient(circle at 80% 0%, rgba(200,255,77,.09), transparent 34%),
      var(--void);
    background-size: 42px 42px, 42px 42px, auto, auto;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: .18;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.92' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.16'/%3E%3C/svg%3E");
    mix-blend-mode: soft-light;
  }
  a { color: inherit; }
  button, input, select { font: inherit; }
  button, a, input, select { -webkit-tap-highlight-color: transparent; }
  :focus-visible { outline: 2px solid var(--acid); outline-offset: 3px; }
  .shell { width: min(1480px, calc(100% - 32px)); margin: 0 auto; padding: 18px 0 56px; position: relative; }
  .topbar {
    min-height: 66px;
    display: grid;
    grid-template-columns: minmax(250px, 1fr) auto minmax(250px, 1fr);
    align-items: center;
    gap: 22px;
    border-bottom: 1px solid var(--line);
  }
  .brand { display:flex; align-items:center; gap:12px; text-decoration:none; }
  .brand-mark { width:34px; height:34px; display:grid; place-items:center; border:1px solid var(--acid); color:var(--acid); font:800 13px "Cascadia Code", monospace; transform:rotate(-3deg); box-shadow:0 0 24px rgba(200,255,77,.12); }
  .brand-copy strong { display:block; letter-spacing:.13em; font-size:13px; }
  .brand-copy span { display:block; margin-top:3px; color:var(--muted); font:10px "Cascadia Code", monospace; letter-spacing:.08em; }
  .nav { display:flex; align-items:center; gap:4px; padding:4px; border:1px solid var(--line); border-radius:12px; background:rgba(13,18,23,.82); }
  .nav a { padding:9px 14px; border-radius:8px; color:var(--muted); text-decoration:none; font:700 11px "Cascadia Code", monospace; letter-spacing:.08em; text-transform:uppercase; }
  .nav a.active { color:#11170a; background:var(--acid); }
  .top-actions { justify-self:end; display:flex; gap:10px; }
  .text-link { color:var(--muted); text-decoration:none; font:11px "Cascadia Code", monospace; }
  .text-link:hover { color:var(--ink); }
  .hero { display:flex; align-items:end; justify-content:space-between; gap:28px; padding:54px 0 28px; }
  .eyebrow { margin-bottom:10px; color:var(--acid); font:700 10px "Cascadia Code", monospace; letter-spacing:.18em; text-transform:uppercase; }
  h1 { margin:0; max-width:780px; font-size:clamp(38px,6vw,76px); line-height:.92; letter-spacing:-.045em; font-weight:820; }
  .hero p { max-width:430px; margin:0 0 4px; color:var(--muted); line-height:1.65; font-size:14px; }
  .panel { position:relative; border:1px solid var(--line); border-radius:16px; background:linear-gradient(145deg,rgba(18,25,32,.96),rgba(10,14,18,.96)); box-shadow:var(--shadow); overflow:hidden; }
  .panel::before { content:""; position:absolute; inset:0 0 auto; height:1px; background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent); }
  .panel-head { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:17px 19px; border-bottom:1px solid var(--line); }
  .panel-title { margin:0; font-size:13px; letter-spacing:.055em; text-transform:uppercase; }
  .panel-kicker { color:var(--muted); font:10px "Cascadia Code", monospace; letter-spacing:.08em; }
  .generator-grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr); gap:18px; align-items:start; }
  .source-body { padding:20px; }
  .source-tabs { display:flex; gap:8px; margin-bottom:18px; }
  .source-tab { appearance:none; border:1px solid var(--line); border-radius:9px; padding:9px 12px; color:var(--muted); background:transparent; cursor:pointer; font:700 10px "Cascadia Code", monospace; letter-spacing:.07em; text-transform:uppercase; }
  .source-tab.active { border-color:var(--acid); color:var(--acid); background:var(--acid-dim); }
  .field { display:grid; gap:8px; margin-bottom:17px; }
  .field label { color:var(--muted); font:10px "Cascadia Code", monospace; text-transform:uppercase; letter-spacing:.09em; }
  select, input[type="search"], input[type="date"] { width:100%; min-height:46px; border:1px solid var(--line-hot); border-radius:9px; color:var(--ink); background:#080d11; padding:0 13px; }
  select:hover, input:hover { border-color:#60707e; }
  .dropzone { display:grid; place-items:center; min-height:178px; padding:24px; border:1px dashed #465460; border-radius:12px; text-align:center; background:rgba(5,8,10,.45); cursor:pointer; transition:.2s ease; }
  .dropzone:hover, .dropzone.dragging { border-color:var(--acid); background:var(--acid-dim); }
  .dropzone strong { display:block; margin-bottom:7px; }
  .dropzone span { color:var(--muted); font-size:12px; }
  #upload-input { position:absolute; opacity:0; pointer-events:none; }
  .source-meta { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:18px 0; }
  .metric { min-height:82px; padding:13px; border:1px solid var(--line); border-radius:10px; background:#0a0f13; }
  .metric span { display:block; color:var(--faint); font:9px "Cascadia Code", monospace; letter-spacing:.08em; text-transform:uppercase; }
  .metric strong { display:block; margin-top:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:700 12px "Cascadia Code", monospace; }
  .command { margin:0 0 16px; padding:12px 13px; border-left:2px solid var(--acid); background:#080c0f; color:#aab5bd; overflow:auto; font:11px/1.55 "Cascadia Code", monospace; white-space:nowrap; }
  .button-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .btn { appearance:none; min-height:44px; border:1px solid var(--line-hot); border-radius:9px; padding:0 16px; color:var(--ink); background:var(--surface-3); cursor:pointer; font-weight:760; letter-spacing:.025em; }
  .btn:hover:not(:disabled) { transform:translateY(-1px); border-color:#71818f; }
  .btn.primary { min-width:210px; color:#11170a; border-color:var(--acid); background:var(--acid); box-shadow:0 10px 34px rgba(200,255,77,.13); }
  .btn:disabled { opacity:.38; cursor:not-allowed; }
  .inline-status { color:var(--muted); font:11px "Cascadia Code", monospace; }
  .side-stack { display:grid; gap:18px; }
  .job-body { padding:18px; }
  .job-state { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  .state-dot { width:10px; height:10px; border-radius:50%; background:var(--faint); box-shadow:0 0 0 5px rgba(135,148,159,.08); }
  .state-dot.running { background:var(--warn); animation:pulse 1.3s ease-in-out infinite; }
  .state-dot.completed { background:var(--paper); }
  .state-dot.failed { background:var(--danger); }
  .job-log { min-height:138px; max-height:230px; margin:0; padding:13px; overflow:auto; border:1px solid var(--line); border-radius:9px; color:#aeb9c0; background:#070a0d; font:10px/1.65 "Cascadia Code", monospace; white-space:pre-wrap; }
  .recent-list { padding:4px 17px 12px; }
  .report-item { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:center; padding:14px 2px; border-bottom:1px solid var(--line); }
  .report-item:last-child { border-bottom:0; }
  .report-item > div { min-width:0; }
  .report-name { display:block; overflow:hidden; color:var(--ink); text-decoration:none; text-overflow:ellipsis; white-space:nowrap; font:700 11px "Cascadia Code", monospace; }
  .report-time { margin-top:5px; color:var(--faint); font:10px "Cascadia Code", monospace; }
  .badge { display:inline-flex; align-items:center; min-height:23px; padding:0 8px; border:1px solid currentColor; border-radius:99px; font:800 9px "Cascadia Code", monospace; letter-spacing:.06em; }
  .badge.paper { color:var(--paper); background:rgba(97,234,163,.08); }
  .badge.live { color:var(--live); background:rgba(255,119,107,.08); }
  .badge.unknown { color:var(--unknown); background:rgba(154,166,178,.08); }
  .empty { padding:32px 18px; color:var(--muted); text-align:center; font:11px/1.6 "Cascadia Code", monospace; }
  .history-tools { display:grid; grid-template-columns:minmax(220px,1fr) auto auto; gap:10px; padding:16px; border-bottom:1px solid var(--line); }
  .mode-filter { display:flex; gap:5px; }
  .filter-btn { appearance:none; min-height:42px; padding:0 12px; border:1px solid var(--line); border-radius:8px; color:var(--muted); background:#0a0f13; cursor:pointer; font:700 9px "Cascadia Code", monospace; }
  .filter-btn.active { color:#11170a; border-color:var(--acid); background:var(--acid); }
  .report-table { width:100%; border-collapse:collapse; }
  .report-table th { padding:13px 17px; color:var(--faint); text-align:left; border-bottom:1px solid var(--line); font:9px "Cascadia Code", monospace; letter-spacing:.09em; text-transform:uppercase; }
  .report-table td { padding:16px 17px; border-bottom:1px solid var(--line); vertical-align:middle; font-size:13px; }
  .report-table tr:hover td { background:rgba(255,255,255,.018); }
  .mono { color:#b9c3ca; font:11px "Cascadia Code", monospace; }
  .source-name { display:block; max-width:360px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:750; }
  .session-line { display:block; margin-top:5px; color:var(--faint); font:10px "Cascadia Code", monospace; }
  .open-link { display:inline-flex; min-height:34px; align-items:center; padding:0 11px; border:1px solid var(--line-hot); border-radius:7px; color:var(--ink); text-decoration:none; font:700 10px "Cascadia Code", monospace; }
  .open-link:hover { border-color:var(--acid); color:var(--acid); }
  .footer { display:flex; justify-content:space-between; gap:20px; padding:26px 2px 0; color:var(--faint); font:9px "Cascadia Code", monospace; letter-spacing:.06em; text-transform:uppercase; }
  .hidden { display:none !important; }
  @keyframes pulse { 50% { opacity:.35; transform:scale(.78); } }
  @keyframes rise { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
  .panel { animation:rise .45s both; }
  .side-stack .panel:nth-child(2) { animation-delay:.08s; }
  @media (max-width: 980px) {
    .topbar { grid-template-columns:1fr auto; }
    .nav { order:3; grid-column:1/-1; justify-self:stretch; }
    .nav a { flex:1; text-align:center; }
    .top-actions { display:none; }
    .hero { align-items:start; flex-direction:column; padding-top:38px; }
    .generator-grid { grid-template-columns:1fr; }
    .source-meta { grid-template-columns:1fr 1fr; }
    .history-tools { grid-template-columns:1fr; }
    .report-table thead { display:none; }
    .report-table, .report-table tbody, .report-table tr, .report-table td { display:block; width:100%; }
    .report-table tr { padding:13px 0; border-bottom:1px solid var(--line); }
    .report-table td { padding:6px 16px; border:0; }
  }
  @media (max-width: 560px) {
    .shell { width:min(100% - 20px,1480px); }
    .brand-copy span { display:none; }
    .nav a { padding:9px 7px; font-size:9px; }
    h1 { font-size:42px; }
    .source-meta { grid-template-columns:1fr; }
    .mode-filter { overflow:auto; }
    .footer { flex-direction:column; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior:auto !important; animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; }
  }
`;

function navigation(active: ControlPage): string {
  return `
    <header class="topbar">
      <a class="brand" href="/generator" aria-label="Report Control home">
        <span class="brand-mark">RC</span>
        <span class="brand-copy"><strong>REPORT CONTROL</strong><span>PATBv5 · LOCAL TELEMETRY OPERATIONS</span></span>
      </a>
      <nav class="nav" aria-label="Report Control">
        <a class="${active === 'generator' ? 'active' : ''}" href="/generator">Generator</a>
        <a class="${active === 'reports' ? 'active' : ''}" href="/reports">History</a>
      </nav>
      <div class="top-actions"><a class="text-link" href="/report">LIVE REPORT ↗</a><a class="text-link" href="/checker">CHECKER ↗</a></div>
    </header>
  `;
}

function documentShell(active: ControlPage, title: string, body: string, script: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>${title} · Report Control</title>
  <style>${styles}</style>
</head>
<body data-page="${active}">
  <div class="shell">
    ${navigation(active)}
    ${body}
    <footer class="footer"><span>LOCAL ONLY · REPORT PIPELINE</span><span>CLI PARITY · STATIC HTML OUTPUT</span></footer>
  </div>
  <script>${script}</script>
</body>
</html>`;
}

const sharedClient = `
  const formatBytes = (value) => {
    if (!Number.isFinite(value)) return '—';
    const units = ['B','KB','MB','GB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
    return size.toFixed(unit === 0 ? 0 : 1) + ' ' + units[unit];
  };
  const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)) : '—';
  const modeClass = (mode) => String(mode || 'UNKNOWN').toLowerCase();
  const makeBadge = (mode) => {
    const badge = document.createElement('span');
    badge.className = 'badge ' + modeClass(mode);
    badge.textContent = mode || 'UNKNOWN';
    return badge;
  };
  async function readJson(response) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }
`;

const generatorBody = `
  <section class="hero">
    <div><div class="eyebrow">Session intelligence pipeline</div><h1>Turn raw telemetry<br>into decisions.</h1></div>
    <p>Select the newest session or upload an external JSONL. Report Control runs the same analytics pipeline as <code>npm run report</code>, then archives the result.</p>
  </section>
  <main class="generator-grid">
    <section class="panel" aria-labelledby="source-title">
      <div class="panel-head"><div><div class="panel-kicker">01 · INPUT</div><h2 class="panel-title" id="source-title">Telemetry source</h2></div><span class="panel-kicker" id="source-count">SYNCING</span></div>
      <div class="source-body">
        <div class="source-tabs" role="tablist" aria-label="Source method">
          <button class="source-tab active" id="library-tab" type="button" role="tab" aria-selected="true">Session library</button>
          <button class="source-tab" id="upload-tab" type="button" role="tab" aria-selected="false">Upload JSONL</button>
        </div>
        <div id="library-panel">
          <div class="field"><label for="source-select">Available telemetry</label><select id="source-select" aria-describedby="source-help"><option>Loading sessions…</option></select><span class="panel-kicker" id="source-help">Newest source is selected automatically.</span></div>
        </div>
        <div id="upload-panel" class="hidden">
          <input id="upload-input" type="file" accept=".jsonl,application/x-ndjson">
          <label class="dropzone" id="dropzone" for="upload-input"><div><strong>Drop a telemetry file here</strong><span id="upload-label">or click to choose a .jsonl file</span></div></label>
          <div class="button-row" style="margin-top:10px"><button class="btn" id="upload-button" type="button" disabled>Upload source</button><span class="inline-status" id="upload-status"></span></div>
        </div>
        <div class="source-meta" aria-live="polite">
          <div class="metric"><span>Mode</span><strong id="meta-mode">—</strong></div>
          <div class="metric"><span>Size</span><strong id="meta-size">—</strong></div>
          <div class="metric"><span>Modified</span><strong id="meta-modified">—</strong></div>
          <div class="metric"><span>Session ID</span><strong id="meta-session">—</strong></div>
        </div>
        <pre class="command" id="command-preview">npm run report -- --file "…"</pre>
        <div class="button-row"><button class="btn primary" id="generate-button" type="button" disabled>GENERATE REPORT →</button><span class="inline-status" id="generate-hint">Select a valid source.</span></div>
      </div>
    </section>
    <aside class="side-stack">
      <section class="panel" aria-labelledby="job-title">
        <div class="panel-head"><div><div class="panel-kicker">02 · PROCESS</div><h2 class="panel-title" id="job-title">Run status</h2></div><span class="panel-kicker" id="job-id">NO ACTIVE JOB</span></div>
        <div class="job-body"><div class="job-state"><span class="state-dot" id="state-dot"></span><strong id="job-status">READY</strong></div><pre class="job-log" id="job-log">Waiting for a report request.</pre><div class="button-row" style="margin-top:12px"><a class="open-link hidden" id="open-result" target="_blank" rel="noopener">OPEN REPORT ↗</a></div></div>
      </section>
      <section class="panel" aria-labelledby="recent-title">
        <div class="panel-head"><div><div class="panel-kicker">03 · OUTPUT</div><h2 class="panel-title" id="recent-title">Recent reports</h2></div><a class="text-link" href="/reports">VIEW ALL →</a></div>
        <div class="recent-list" id="recent-list"><div class="empty">Loading report history…</div></div>
      </section>
    </aside>
  </main>
`;

const generatorClient = `
  ${sharedClient}
  (() => {
    let sources = [];
    let selectedSource = null;
    let selectedUpload = null;
    let reportWindow = null;
    const sourceSelect = document.getElementById('source-select');
    const generateButton = document.getElementById('generate-button');
    const uploadInput = document.getElementById('upload-input');
    const uploadButton = document.getElementById('upload-button');
    const uploadLabel = document.getElementById('upload-label');
    const uploadStatus = document.getElementById('upload-status');
    const dropzone = document.getElementById('dropzone');

    function selectSource(sourceId) {
      selectedSource = sources.find((source) => source.id === sourceId) || null;
      generateButton.disabled = !selectedSource;
      document.getElementById('generate-hint').textContent = selectedSource ? 'Ready to run the full report pipeline.' : 'Select a valid source.';
      document.getElementById('meta-mode').textContent = selectedSource?.mode || '—';
      document.getElementById('meta-size').textContent = selectedSource ? formatBytes(selectedSource.sizeBytes) : '—';
      document.getElementById('meta-modified').textContent = selectedSource ? formatDate(selectedSource.modifiedAt) : '—';
      document.getElementById('meta-session').textContent = selectedSource?.sessionIds?.[0] || 'UNKNOWN';
      document.getElementById('command-preview').textContent = selectedSource ? 'npm run report -- --file "' + selectedSource.name + '"' : 'npm run report -- --file "…"';
    }

    function renderSources(preferredId) {
      sourceSelect.replaceChildren();
      if (sources.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'No .jsonl sources found';
        sourceSelect.append(option);
        sourceSelect.disabled = true;
        selectSource('');
      } else {
        sourceSelect.disabled = false;
        for (const source of sources) {
          const option = document.createElement('option');
          option.value = source.id;
          option.textContent = (source.kind === 'upload' ? '[UPLOAD] ' : '') + source.name;
          sourceSelect.append(option);
        }
        const target = sources.find((source) => source.id === preferredId) || sources[0];
        sourceSelect.value = target.id;
        selectSource(target.id);
      }
      document.getElementById('source-count').textContent = sources.length + ' SOURCES';
    }

    function renderRecent(reports) {
      const list = document.getElementById('recent-list');
      list.replaceChildren();
      if (reports.length === 0) {
        const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No reports generated yet.'; list.append(empty); return;
      }
      for (const report of reports.slice(0, 5)) {
        const item = document.createElement('div'); item.className = 'report-item';
        const copy = document.createElement('div');
        const link = document.createElement('a'); link.className = 'report-name'; link.href = report.reportUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = report.sourceName || report.fileName;
        const time = document.createElement('div'); time.className = 'report-time'; time.textContent = formatDate(report.generatedAt);
        copy.append(link, time); item.append(copy, makeBadge(report.mode)); list.append(item);
      }
    }

    async function loadDashboard(preferredId) {
      const [sourcePayload, reportPayload] = await Promise.all([
        fetch('/api/report-sources').then(readJson),
        fetch('/api/reports').then(readJson),
      ]);
      sources = sourcePayload.sources;
      renderSources(preferredId);
      renderRecent(reportPayload.reports);
    }

    function setSourceTab(tab) {
      const upload = tab === 'upload';
      document.getElementById('library-tab').classList.toggle('active', !upload);
      document.getElementById('upload-tab').classList.toggle('active', upload);
      document.getElementById('library-tab').setAttribute('aria-selected', String(!upload));
      document.getElementById('upload-tab').setAttribute('aria-selected', String(upload));
      document.getElementById('library-panel').classList.toggle('hidden', upload);
      document.getElementById('upload-panel').classList.toggle('hidden', !upload);
    }

    function setUploadFile(file) {
      selectedUpload = file || null;
      uploadButton.disabled = !selectedUpload;
      uploadLabel.textContent = selectedUpload ? selectedUpload.name + ' · ' + formatBytes(selectedUpload.size) : 'or click to choose a .jsonl file';
      uploadStatus.textContent = '';
    }

    async function pollJob(jobId) {
      const job = await fetch('/api/report-jobs/' + encodeURIComponent(jobId)).then(readJson);
      document.getElementById('job-id').textContent = job.id.slice(0, 8).toUpperCase();
      document.getElementById('job-status').textContent = job.status.toUpperCase();
      document.getElementById('state-dot').className = 'state-dot ' + job.status;
      document.getElementById('job-log').textContent = job.messages.join('\\n');
      if (job.status === 'queued' || job.status === 'running') {
        setTimeout(() => pollJob(jobId).catch(showJobError), 900);
        return;
      }
      generateButton.disabled = false;
      if (job.status === 'completed' && job.reportUrl) {
        const link = document.getElementById('open-result'); link.href = job.reportUrl; link.classList.remove('hidden');
        if (reportWindow && !reportWindow.closed) reportWindow.location.replace(job.reportUrl);
        await loadDashboard(selectedSource?.id);
      } else if (reportWindow && !reportWindow.closed) {
        reportWindow.location.replace('/report-job-waiting?failed=1');
      }
    }

    function showJobError(error) {
      document.getElementById('job-status').textContent = 'FAILED';
      document.getElementById('state-dot').className = 'state-dot failed';
      document.getElementById('job-log').textContent += '\\n' + String(error.message || error);
      generateButton.disabled = false;
    }

    sourceSelect.addEventListener('change', () => selectSource(sourceSelect.value));
    document.getElementById('library-tab').addEventListener('click', () => setSourceTab('library'));
    document.getElementById('upload-tab').addEventListener('click', () => setSourceTab('upload'));
    uploadInput.addEventListener('change', () => setUploadFile(uploadInput.files?.[0]));
    ['dragenter','dragover'].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add('dragging'); }));
    ['dragleave','drop'].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
    dropzone.addEventListener('drop', (event) => setUploadFile(event.dataTransfer?.files?.[0]));

    uploadButton.addEventListener('click', async () => {
      if (!selectedUpload) return;
      uploadButton.disabled = true; uploadStatus.textContent = 'Uploading…';
      try {
        const payload = await fetch('/api/report-sources/upload', {
          method:'POST',
          headers:{ 'Content-Type':'application/octet-stream', 'X-File-Name':encodeURIComponent(selectedUpload.name) },
          body:selectedUpload,
        }).then(readJson);
        uploadStatus.textContent = 'Upload ready.';
        await loadDashboard(payload.source.id);
        setSourceTab('library');
      } catch (error) {
        uploadStatus.textContent = error.message || String(error);
        uploadButton.disabled = false;
      }
    });

    generateButton.addEventListener('click', async () => {
      if (!selectedSource) return;
      reportWindow = window.open('/report-job-waiting', '_blank');
      generateButton.disabled = true;
      document.getElementById('open-result').classList.add('hidden');
      document.getElementById('job-status').textContent = 'QUEUED';
      document.getElementById('state-dot').className = 'state-dot running';
      document.getElementById('job-log').textContent = 'Requesting report generation…';
      try {
        const job = await fetch('/api/report-jobs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sourceId:selectedSource.id}) }).then(readJson);
        if (reportWindow && !reportWindow.closed) reportWindow.location.replace('/report-job-waiting?jobId=' + encodeURIComponent(job.id));
        await pollJob(job.id);
      } catch (error) { showJobError(error); }
    });

    loadDashboard().catch((error) => {
      document.getElementById('source-count').textContent = 'OFFLINE';
      document.getElementById('job-log').textContent = error.message || String(error);
    });
  })();
`;

const reportsBody = `
  <section class="hero">
    <div><div class="eyebrow">Persistent report archive</div><h1>Every session.<br>One evidence trail.</h1></div>
    <p>Browse reports created before and after Report Control. Mode labels come from telemetry evidence, never filenames.</p>
  </section>
  <main class="panel" aria-labelledby="history-title">
    <div class="panel-head"><div><div class="panel-kicker">ARCHIVE</div><h2 class="panel-title" id="history-title">Generated reports</h2></div><span class="panel-kicker" id="history-count">SYNCING</span></div>
    <div class="history-tools">
      <input id="report-search" type="search" placeholder="Search source, session ID, or report…" aria-label="Search reports">
      <div class="mode-filter" role="group" aria-label="Filter by mode">
        <button class="filter-btn active" data-mode="ALL" type="button">ALL</button>
        <button class="filter-btn" data-mode="PAPER" type="button">PAPER</button>
        <button class="filter-btn" data-mode="LIVE" type="button">LIVE</button>
        <button class="filter-btn" data-mode="UNKNOWN" type="button">UNKNOWN</button>
      </div>
      <input id="report-date" type="date" aria-label="Filter by generated date">
    </div>
    <div style="overflow:auto"><table class="report-table"><thead><tr><th>Source</th><th>Mode</th><th>Generated</th><th>Origin</th><th>Action</th></tr></thead><tbody id="report-rows"><tr><td colspan="5"><div class="empty">Loading report archive…</div></td></tr></tbody></table></div>
  </main>
`;

const reportsClient = `
  ${sharedClient}
  (() => {
    let reports = [];
    let activeMode = 'ALL';
    const rows = document.getElementById('report-rows');
    const search = document.getElementById('report-search');
    const date = document.getElementById('report-date');

    function render() {
      const query = search.value.trim().toLowerCase();
      const dateValue = date.value;
      const filtered = reports.filter((report) => {
        if (activeMode !== 'ALL' && report.mode !== activeMode) return false;
        if (dateValue && String(report.generatedAt).slice(0,10) !== dateValue) return false;
        const haystack = [report.sourceName, report.fileName, ...(report.sessionIds || [])].join(' ').toLowerCase();
        return !query || haystack.includes(query);
      });
      document.getElementById('history-count').textContent = filtered.length + ' / ' + reports.length + ' REPORTS';
      rows.replaceChildren();
      if (filtered.length === 0) {
        const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 5;
        const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No reports match the current filters.';
        td.append(empty); tr.append(td); rows.append(tr); return;
      }
      for (const report of filtered) {
        const tr = document.createElement('tr');
        const sourceCell = document.createElement('td');
        const sourceName = document.createElement('span'); sourceName.className = 'source-name'; sourceName.textContent = report.sourceName || report.fileName;
        const session = document.createElement('span'); session.className = 'session-line'; session.textContent = report.sessionIds?.[0] || 'Session unavailable';
        sourceCell.append(sourceName, session);
        const modeCell = document.createElement('td'); modeCell.append(makeBadge(report.mode));
        const generatedCell = document.createElement('td'); generatedCell.className = 'mono'; generatedCell.textContent = formatDate(report.generatedAt);
        const originCell = document.createElement('td'); originCell.className = 'mono'; originCell.textContent = report.legacy ? 'LEGACY' : report.sourceKind.toUpperCase();
        const actionCell = document.createElement('td');
        const link = document.createElement('a'); link.className = 'open-link'; link.href = report.reportUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'OPEN ↗'; actionCell.append(link);
        tr.append(sourceCell, modeCell, generatedCell, originCell, actionCell); rows.append(tr);
      }
    }

    document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
      activeMode = button.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
      render();
    }));
    search.addEventListener('input', render);
    date.addEventListener('change', render);
    fetch('/api/reports').then(readJson).then((payload) => { reports = payload.reports; render(); }).catch((error) => {
      rows.innerHTML = '';
      const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 5; td.className = 'empty'; td.textContent = error.message || String(error); tr.append(td); rows.append(tr);
      document.getElementById('history-count').textContent = 'OFFLINE';
    });
  })();
`;

export function renderGeneratorPage(): string {
  return documentShell('generator', 'Generator', generatorBody, generatorClient);
}

export function renderReportsPage(): string {
  return documentShell('reports', 'History', reportsBody, reportsClient);
}

export function renderReportJobWaitingPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report generation · Report Control</title><style>${styles}</style></head><body><main class="shell" style="min-height:100vh;display:grid;place-items:center"><section class="panel" style="width:min(560px,100%);padding:34px"><div class="eyebrow">Report Control</div><h1 style="font-size:42px">Building evidence.</h1><p id="waiting-copy" style="color:var(--muted);line-height:1.7">This tab will open the static report as soon as generation completes.</p><pre class="job-log" id="waiting-log">Waiting for job assignment…</pre></section></main><script>${sharedClient}(() => { const params = new URLSearchParams(location.search); const jobId = params.get('jobId'); const failed = params.get('failed'); const log = document.getElementById('waiting-log'); if (failed) { log.textContent = 'Report generation failed. Return to Report Control for diagnostics.'; return; } if (!jobId) return; async function poll() { try { const job = await fetch('/api/report-jobs/' + encodeURIComponent(jobId)).then(readJson); log.textContent = job.messages.join('\\n'); if (job.status === 'completed' && job.reportUrl) { location.replace(job.reportUrl); return; } if (job.status === 'failed') { document.getElementById('waiting-copy').textContent = 'The report could not be generated.'; return; } setTimeout(poll, 900); } catch (error) { log.textContent += '\\n' + (error.message || String(error)); } } poll(); })();</script></body></html>`;
}
