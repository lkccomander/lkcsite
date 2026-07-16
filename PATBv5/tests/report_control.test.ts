import assert from 'node:assert/strict';
import express from 'express';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

import {
  ReportCatalog,
  ReportControlPaths,
  ReportJob,
  ReportJobManager,
  ReportSourceCatalog,
  toSourceSummary,
} from '../src/report/control/model';
import { createReportControlRouter } from '../src/report/control/router';

function writeEvents(filePath: string, events: unknown[]): void {
  writeFileSync(filePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
}

function buildPaths(root: string): ReportControlPaths {
  const reportsDir = join(root, 'reports');
  return {
    sessionsDir: join(root, 'sessions'),
    uploadsDir: join(root, 'uploads'),
    reportsDir,
    reportIndexFile: join(reportsDir, 'report-index.json'),
    jobLedgerFile: join(reportsDir, 'report-jobs.json'),
    maxUploadBytes: 1024 * 1024,
  };
}

async function waitForJob(manager: ReportJobManager, jobId: string): Promise<ReportJob> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const job = manager.getJob(jobId);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for report job ${jobId}`);
}

async function waitForApiJob(baseUrl: string, jobId: string): Promise<any> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/report-jobs/${encodeURIComponent(jobId)}`);
    const job = await response.json() as any;
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for API report job ${jobId}`);
}

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP test server address.');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'patbv5-report-control-'));
  const paths = buildPaths(root);
  mkdirSync(paths.sessionsDir, { recursive: true });

  const olderFile = join(paths.sessionsDir, '2026-07-13-old.jsonl');
  const newerFile = join(paths.sessionsDir, '2026-07-14-new.jsonl');
  writeEvents(olderFile, [
    { type: 'bot.startup', sessionId: 'paper-session', payload: { mode: 'PAPER', strategy: 'trade_5x' } },
    { type: 'paper_trade.buy', sessionId: 'paper-session', payload: { tokenId: 'token-1', side: 'UP', entryPrice: 0.45 } },
  ]);
  writeEvents(newerFile, [
    { type: 'bot.startup', sessionId: 'live-session', payload: { mode: 'LIVE', strategy: 'trade_5x' } },
    { type: 'live_trade.buy', sessionId: 'live-session', payload: { tokenId: 'token-2', side: 'DOWN', entryPrice: 0.52 } },
  ]);
  utimesSync(olderFile, new Date('2026-07-13T12:00:00Z'), new Date('2026-07-13T12:00:00Z'));
  utimesSync(newerFile, new Date('2026-07-14T12:00:00Z'), new Date('2026-07-14T12:00:00Z'));

  try {
    const sources = new ReportSourceCatalog(paths);
    const listed = await sources.listSources();
    assert.deepEqual(listed.map((source) => source.name), ['2026-07-14-new.jsonl', '2026-07-13-old.jsonl']);
    assert.equal(listed[0].mode, 'LIVE');
    assert.equal(listed[1].mode, 'PAPER');
    assert.deepEqual(listed[0].sessionIds, ['live-session']);
    assert.ok(!('internalPath' in toSourceSummary(listed[0])), 'browser summary must omit absolute paths');
    assert.throws(() => sources.createUploadTarget('../escape.jsonl'), /plain \.jsonl filename/);
    assert.throws(() => sources.createUploadTarget('telemetry.txt'), /plain \.jsonl filename/);

    mkdirSync(paths.reportsDir, { recursive: true });
    const legacyName = 'session-review-legacy-live.html';
    writeFileSync(join(paths.reportsDir, legacyName), `<!DOCTYPE html><script id="report-data" type="application/json">${JSON.stringify({ mode: 'LIVE', sessionIds: ['legacy-live'], files: ['legacy-live.jsonl'] })}</script>`, 'utf8');
    const reportCatalog = new ReportCatalog(paths);
    const legacy = reportCatalog.listReports().find((report) => report.fileName === legacyName);
    assert.equal(legacy?.mode, 'LIVE');
    assert.equal(legacy?.status, 'legacy');

    const jobs = new ReportJobManager(paths, reportCatalog);
    const paperSource = listed.find((source) => source.mode === 'PAPER');
    assert.ok(paperSource);
    const completed = await waitForJob(jobs, jobs.createJob(paperSource).id);
    assert.equal(completed.status, 'completed', completed.error ?? 'report job should complete');
    assert.ok(completed.reportUrl);
    const generated = reportCatalog.listReports().find((report) => report.id === completed.reportId);
    assert.equal(generated?.mode, 'PAPER');
    assert.ok(generated && existsSync(join(paths.reportsDir, generated.fileName)));
    assert.match(readFileSync(paths.reportIndexFile, 'utf8'), /"mode": "PAPER"/);

    const interruptedLedger = JSON.parse(readFileSync(paths.jobLedgerFile, 'utf8'));
    interruptedLedger.jobs.push({
      id: 'interrupted-job', sourceId: 'source-x', sourceName: 'x.jsonl', status: 'running',
      createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null,
      messages: ['started'], reportId: null, reportUrl: null, error: null,
    });
    writeFileSync(paths.jobLedgerFile, JSON.stringify(interruptedLedger), 'utf8');
    const recoveredJobs = new ReportJobManager(paths, reportCatalog);
    assert.equal(recoveredJobs.getJob('interrupted-job')?.status, 'failed');
    assert.match(recoveredJobs.getJob('interrupted-job')?.error ?? '', /restarted/);

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(createReportControlRouter(paths));
    const { server, baseUrl } = await listen(app);
    try {
      const rootResponse = await fetch(baseUrl, { redirect: 'manual' });
      assert.equal(rootResponse.status, 302);
      assert.equal(rootResponse.headers.get('location'), '/generator');

      const generatorHtml = await fetch(`${baseUrl}/generator`).then((response) => response.text());
      assert.match(generatorHtml, /REPORT CONTROL/);
      assert.match(generatorHtml, /GENERATE REPORT/);
      assert.match(generatorHtml, /prefers-reduced-motion/);
      const generatorScripts = [...generatorHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      assert.ok(generatorScripts.length > 0, 'generator must include its controller script');
      for (const [, script] of generatorScripts) {
        assert.doesNotThrow(() => new Function(script), 'generator controller must contain valid JavaScript');
      }

      const historyHtml = await fetch(`${baseUrl}/reports`).then((response) => response.text());
      assert.match(historyHtml, /Generated reports/);
      assert.match(historyHtml, /UNKNOWN/);
      const historyScripts = [...historyHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      assert.ok(historyScripts.length > 0, 'history must include its controller script');
      for (const [, script] of historyScripts) {
        assert.doesNotThrow(() => new Function(script), 'history controller must contain valid JavaScript');
      }

      const sourcePayload = await fetch(`${baseUrl}/api/report-sources`).then((response) => response.json()) as any;
      assert.equal(sourcePayload.sources[0].name, '2026-07-14-new.jsonl');
      assert.ok(!('internalPath' in sourcePayload.sources[0]));

      const unsafeUpload = await fetch(`${baseUrl}/api/report-sources/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('../escape.jsonl') },
        body: Buffer.from('{}\n'),
      });
      assert.equal(unsafeUpload.status, 400);

      const uploadResponse = await fetch(`${baseUrl}/api/report-sources/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('manual-paper.jsonl') },
        body: Buffer.from(`${JSON.stringify({ type: 'bot.startup', sessionId: 'manual-paper', payload: { mode: 'PAPER' } })}\n`),
      });
      assert.equal(uploadResponse.status, 201);
      const uploadPayload = await uploadResponse.json() as any;
      assert.equal(uploadPayload.source.kind, 'upload');
      assert.equal(uploadPayload.source.mode, 'PAPER');

      const jobResponse = await fetch(`${baseUrl}/api/report-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: uploadPayload.source.id }),
      });
      assert.equal(jobResponse.status, 202);
      const apiJob = await jobResponse.json() as any;
      const apiCompleted = await waitForApiJob(baseUrl, apiJob.id);
      assert.equal(apiCompleted.status, 'completed', apiCompleted.error ?? 'API report job should complete');

      const paperReports = await fetch(`${baseUrl}/api/reports?mode=PAPER`).then((response) => response.json()) as any;
      assert.ok(paperReports.reports.length >= 2);
      assert.ok(paperReports.reports.every((report: any) => report.mode === 'PAPER'));

      const reportResponse = await fetch(`${baseUrl}${apiCompleted.reportUrl}`);
      assert.equal(reportResponse.status, 200);
      assert.match(await reportResponse.text(), /Session Review Report/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
