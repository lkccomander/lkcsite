import path from 'path';

import { detectAnomalies, evaluateGateChecks } from './anomalies';
import { parseTelemetry } from './parser';
import { renderReport } from './renderer';
import { SessionReport } from './types';

export type ReportMode = 'PAPER' | 'LIVE' | 'UNKNOWN';

export interface GenerateReportOptions {
  files: string[];
  outputPath: string;
  tailLines?: number;
  onProgress?: (message: string) => void;
}

export interface GeneratedReport {
  outputPath: string;
  report: SessionReport;
  mode: ReportMode;
}

export function normalizeReportMode(value: unknown): ReportMode {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'PAPER' || normalized === 'LIVE') {
    return normalized;
  }
  return 'UNKNOWN';
}

export function buildReportOutputPath(
  reportsDir: string,
  now: Date = new Date(),
  suffix = '',
): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const safeSuffix = suffix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
  return path.join(
    reportsDir,
    `session-review-${timestamp}${safeSuffix ? `-${safeSuffix}` : ''}.html`,
  );
}

export async function generateReport(options: GenerateReportOptions): Promise<GeneratedReport> {
  if (options.files.length === 0) {
    throw new Error('At least one telemetry file is required.');
  }

  options.onProgress?.('Parsing telemetry data');
  const report = await parseTelemetry(options.files, options.tailLines);

  options.onProgress?.('Evaluating anomalies and release gates');
  report.anomalies = detectAnomalies(report);
  report.gateChecks = evaluateGateChecks(report);

  options.onProgress?.('Rendering static HTML report');
  await renderReport(report, options.outputPath);

  options.onProgress?.('Report file written');
  return {
    outputPath: options.outputPath,
    report,
    mode: normalizeReportMode(report.mode),
  };
}
