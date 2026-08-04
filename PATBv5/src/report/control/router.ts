import express from 'express';
import { createWriteStream, renameSync, rmSync } from 'fs';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

import {
  createDefaultReportControlPaths,
  ReportCatalog,
  ReportControlPaths,
  ReportJobManager,
  ReportSourceCatalog,
  toSourceSummary,
} from './model';
import {
  renderGeneratorPage,
  renderReportJobWaitingPage,
  renderReportsPage,
} from './page';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeUploadName(value: unknown): string {
  const raw = String(value ?? '');
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new Error('Upload filename is not valid URI-encoded text.');
  }
}

export function createReportControlRouter(
  paths: ReportControlPaths = createDefaultReportControlPaths(),
): express.Router {
  const router = express.Router();
  const sourceCatalog = new ReportSourceCatalog(paths);
  const reportCatalog = new ReportCatalog(paths);
  const jobManager = new ReportJobManager(paths, reportCatalog);

  router.get('/', (_request, response) => response.redirect(302, '/generator'));
  router.get('/generator', (_request, response) => response.type('html').send(renderGeneratorPage()));
  router.get('/reports', (_request, response) => response.type('html').send(renderReportsPage()));
  router.get('/report-job-waiting', (_request, response) => response.type('html').send(renderReportJobWaitingPage()));

  router.get('/api/report-sources', async (_request, response) => {
    try {
      const sources = await sourceCatalog.listSources();
      response.json({ sources: sources.map(toSourceSummary) });
    } catch (error) {
      response.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post('/api/report-sources/upload', async (request, response) => {
    const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/octet-stream')) {
      response.status(415).json({ error: 'Upload Content-Type must be application/octet-stream.' });
      return;
    }

    let targetPath = '';
    let temporaryPath = '';
    try {
      const originalName = decodeUploadName(request.headers['x-file-name']);
      targetPath = sourceCatalog.createUploadTarget(originalName);
      temporaryPath = `${targetPath}.part`;

      const declaredLength = Number(request.headers['content-length'] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > paths.maxUploadBytes) {
        response.status(413).json({ error: 'Uploaded telemetry exceeds the configured size limit.' });
        return;
      }

      let receivedBytes = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          receivedBytes += chunk.length;
          if (receivedBytes > paths.maxUploadBytes) {
            callback(new Error('Uploaded telemetry exceeds the configured size limit.'));
            return;
          }
          callback(null, chunk);
        },
      });

      await pipeline(request, meter, createWriteStream(temporaryPath, { flags: 'wx' }));
      if (receivedBytes === 0) {
        throw new Error('Uploaded telemetry file is empty.');
      }
      renameSync(temporaryPath, targetPath);
      temporaryPath = '';

      const source = await sourceCatalog.inspectUploadedFile(targetPath);
      response.status(201).json({ source: toSourceSummary(source) });
    } catch (error) {
      if (temporaryPath) rmSync(temporaryPath, { force: true });
      if (targetPath) rmSync(targetPath, { force: true });
      const message = errorMessage(error);
      response.status(message.includes('size limit') ? 413 : 400).json({ error: message });
    }
  });

  router.post('/api/report-jobs', async (request, response) => {
    const sourceId = String(request.body?.sourceId ?? '').trim();
    if (!sourceId) {
      response.status(400).json({ error: 'sourceId is required.' });
      return;
    }

    try {
      const source = await sourceCatalog.getSource(sourceId);
      if (!source) {
        response.status(404).json({ error: 'Report source not found.' });
        return;
      }
      const existingReport = reportCatalog.findReportForSource(source.id);
      if (existingReport) {
        response.status(409).json({
          error: 'A report for this source already exists.',
          report: existingReport,
        });
        return;
      }
      response.status(202).json(jobManager.createJob(source));
    } catch (error) {
      response.status(500).json({ error: errorMessage(error) });
    }
  });

  router.get('/api/report-jobs', (_request, response) => {
    response.json({ jobs: jobManager.listJobs() });
  });

  router.get('/api/report-jobs/:jobId', (request, response) => {
    const job = jobManager.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: 'Report job not found.' });
      return;
    }
    response.json(job);
  });

  router.get('/api/reports', (request, response) => {
    try {
      const search = String(request.query.search ?? '').trim().toLowerCase();
      const mode = String(request.query.mode ?? 'ALL').trim().toUpperCase();
      const from = String(request.query.from ?? '').trim();
      const to = String(request.query.to ?? '').trim();
      const reports = reportCatalog.listReports().filter((report) => {
        if (mode !== 'ALL' && report.mode !== mode) return false;
        if (from && report.generatedAt.slice(0, 10) < from) return false;
        if (to && report.generatedAt.slice(0, 10) > to) return false;
        if (!search) return true;
        return [report.sourceName, report.fileName, ...report.sessionIds]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search);
      });
      response.json({ reports });
    } catch (error) {
      response.status(500).json({ error: errorMessage(error) });
    }
  });

  router.get('/api/reports/:reportId', (request, response) => {
    const report = reportCatalog.getReport(request.params.reportId);
    if (!report) {
      response.status(404).json({ error: 'Report not found.' });
      return;
    }
    response.json(report);
  });

  const serveReportFile: express.RequestHandler = (request, response) => {
    let fileName = '';
    try {
      const encodedFileName = request.params.fileName;
      if (Array.isArray(encodedFileName)) {
        throw new Error('Report filename must contain a single path segment.');
      }
      fileName = decodeURIComponent(encodedFileName);
    } catch {
      response.status(400).send('Invalid report filename.');
      return;
    }
    const reportFile = reportCatalog.resolveReportFile(fileName);
    if (!reportFile) {
      response.status(404).send('Report not found.');
      return;
    }
    response.sendFile(reportFile);
  };

  router.get('/reports/files/:fileName', serveReportFile);
  router.get('/reports/:fileName', serveReportFile);

  return router;
}
