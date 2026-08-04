import { createHash, randomUUID } from 'crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { createInterface } from 'readline';

import {
  buildReportOutputPath,
  generateReport,
  normalizeReportMode,
  ReportMode,
} from '../generation';

export interface ReportControlPaths {
  sessionsDir: string;
  uploadsDir: string;
  reportsDir: string;
  reportIndexFile: string;
  jobLedgerFile: string;
  maxUploadBytes: number;
}

export interface ReportSource {
  id: string;
  kind: 'session' | 'upload';
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  sessionIds: string[];
  mode: ReportMode;
  internalPath: string;
}

export type ReportSourceSummary = Omit<ReportSource, 'internalPath'>;

export interface ReportRecord {
  id: string;
  sourceId: string | null;
  fileName: string;
  sourceName: string | null;
  sourceKind: 'session' | 'upload' | 'legacy';
  generatedAt: string;
  sessionIds: string[];
  mode: ReportMode;
  status: 'completed' | 'legacy';
  legacy: boolean;
  reportUrl: string;
}

export interface ReportJob {
  id: string;
  sourceId: string;
  sourceName: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  messages: string[];
  reportId: string | null;
  reportUrl: string | null;
  error: string | null;
}

interface ReportIndexDocument {
  version: 1;
  reports: ReportRecord[];
}

interface JobLedgerDocument {
  version: 1;
  jobs: ReportJob[];
}

const MAX_METADATA_LINES = 40;
const SOURCE_INSPECTION_CONCURRENCY = 4;

function stableId(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 20);
  return `${prefix}_${digest}`;
}

function normalizePathForId(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true });
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, filePath);
}

function modeFromSignals(declaredModes: Set<ReportMode>, hasPaper: boolean, hasLive: boolean): ReportMode {
  declaredModes.delete('UNKNOWN');
  if (declaredModes.size === 1) {
    return [...declaredModes][0];
  }
  if (declaredModes.size > 1 || (hasPaper && hasLive)) {
    return 'UNKNOWN';
  }
  if (hasPaper) return 'PAPER';
  if (hasLive) return 'LIVE';
  return 'UNKNOWN';
}

async function inspectJsonlFile(
  filePath: string,
  kind: ReportSource['kind'],
): Promise<ReportSource> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const sessionIds = new Set<string>();
  const declaredModes = new Set<ReportMode>();
  let hasPaper = false;
  let hasLive = false;
  let inspectedLines = 0;

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      inspectedLines++;
      try {
        const event = JSON.parse(line);
        const sessionId = String(event.sessionId ?? event.payload?.sessionId ?? '').trim();
        if (sessionId) sessionIds.add(sessionId);

        const declaredMode = normalizeReportMode(event.mode ?? event.payload?.mode);
        if (declaredMode !== 'UNKNOWN') declaredModes.add(declaredMode);

        const eventType = String(event.type ?? event.event ?? '').toLowerCase();
        if (eventType.startsWith('paper_trade.')) hasPaper = true;
        if (eventType.startsWith('live_trade.')) hasLive = true;
      } catch {
        // A malformed line does not prevent the source from appearing in the catalog.
      }

      if (inspectedLines >= MAX_METADATA_LINES) break;
    }
  } finally {
    lines.close();
    input.destroy();
  }

  const stats = statSync(filePath);
  return {
    id: stableId('source', `${kind}:${normalizePathForId(filePath)}`),
    kind,
    name: path.basename(filePath),
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    sessionIds: [...sessionIds],
    mode: modeFromSignals(declaredModes, hasPaper, hasLive),
    internalPath: path.resolve(filePath),
  };
}

function listJsonlFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl'))
    .map((entry) => path.join(directory, entry.name));
}

function parseEmbeddedReport(html: string): Record<string, any> | null {
  const match = html.match(/<script\s+id=["']report-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function legacyMode(html: string, embedded: Record<string, any> | null): ReportMode {
  const explicit = normalizeReportMode(embedded?.mode);
  if (explicit !== 'UNKNOWN') return explicit;

  const hasPaper = /\bPAPER\b/i.test(html);
  const hasLive = /\bLIVE\b/i.test(html);
  if (hasPaper === hasLive) return 'UNKNOWN';
  return hasPaper ? 'PAPER' : 'LIVE';
}

export function createDefaultReportControlPaths(cwd = process.cwd()): ReportControlPaths {
  const sessionCandidates = [
    path.resolve(cwd, 'polydb', 'telemetry', 'sessions'),
    path.resolve(cwd, '..', 'polydb', 'telemetry', 'sessions'),
  ];
  const sessionsDir = sessionCandidates.find((candidate) => existsSync(candidate)) ?? sessionCandidates[1];
  const reportsDir = path.resolve(cwd, 'polydb', 'reports');

  return {
    sessionsDir,
    uploadsDir: path.resolve(cwd, 'polydb', 'report-uploads'),
    reportsDir,
    reportIndexFile: path.join(reportsDir, 'report-index.json'),
    jobLedgerFile: path.join(reportsDir, 'report-jobs.json'),
    maxUploadBytes: 512 * 1024 * 1024,
  };
}

export class ReportSourceCatalog {
  private readonly cache = new Map<string, { signature: string; source: ReportSource }>();

  constructor(readonly paths: ReportControlPaths) {
    ensureDirectory(paths.sessionsDir);
    ensureDirectory(paths.uploadsDir);
  }

  async listSources(): Promise<ReportSource[]> {
    const discovered = [
      ...listJsonlFiles(this.paths.sessionsDir).map((filePath) => ({ filePath, kind: 'session' as const })),
      ...listJsonlFiles(this.paths.uploadsDir).map((filePath) => ({ filePath, kind: 'upload' as const })),
    ];
    const activePaths = new Set(discovered.map(({ filePath }) => normalizePathForId(filePath)));
    for (const cacheKey of this.cache.keys()) {
      if (!activePaths.has(cacheKey)) this.cache.delete(cacheKey);
    }

    const sources = new Array<ReportSource>(discovered.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < discovered.length) {
        const currentIndex = nextIndex++;
        const { filePath, kind } = discovered[currentIndex];
        const stats = statSync(filePath);
        const signature = `${stats.size}:${stats.mtimeMs}`;
        const cacheKey = normalizePathForId(filePath);
        const cached = this.cache.get(cacheKey);
        if (cached?.signature === signature) {
          sources[currentIndex] = cached.source;
          continue;
        }

        const source = await inspectJsonlFile(filePath, kind);
        this.cache.set(cacheKey, { signature, source });
        sources[currentIndex] = source;
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(SOURCE_INSPECTION_CONCURRENCY, Math.max(discovered.length, 1)) },
        () => worker(),
      ),
    );
    return sources.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
  }

  async getSource(sourceId: string): Promise<ReportSource | null> {
    const sources = await this.listSources();
    return sources.find((source) => source.id === sourceId) ?? null;
  }

  async inspectUploadedFile(filePath: string): Promise<ReportSource> {
    const resolved = path.resolve(filePath);
    const relative = path.relative(this.paths.uploadsDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Uploaded file resolved outside the upload directory.');
    }
    return inspectJsonlFile(resolved, 'upload');
  }

  createUploadTarget(originalName: string): string {
    const trimmed = originalName.trim();
    if (!trimmed || /[\\/]/.test(trimmed) || path.extname(trimmed).toLowerCase() !== '.jsonl') {
      throw new Error('Upload name must be a plain .jsonl filename.');
    }

    const stem = path.basename(trimmed, path.extname(trimmed))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'telemetry';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.paths.uploadsDir, `${stem}-${timestamp}-${randomUUID().slice(0, 8)}.jsonl`);
  }
}

export class ReportCatalog {
  private indexWritable = true;

  constructor(readonly paths: ReportControlPaths) {
    ensureDirectory(paths.reportsDir);
  }

  private loadIndexedReports(): ReportRecord[] {
    if (!existsSync(this.paths.reportIndexFile)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.paths.reportIndexFile, 'utf8')) as ReportIndexDocument;
      if (parsed.version !== 1 || !Array.isArray(parsed.reports)) {
        throw new Error('unsupported report index format');
      }
      this.indexWritable = true;
      return parsed.reports;
    } catch (error) {
      this.indexWritable = false;
      console.warn(`Report index could not be read: ${String(error)}`);
      return [];
    }
  }

  addGeneratedReport(record: ReportRecord): void {
    const reports = this.loadIndexedReports();
    if (!this.indexWritable) {
      throw new Error('Report index is corrupt; preserving it without overwrite.');
    }
    const merged = reports.filter((item) => item.fileName !== record.fileName);
    merged.push(record);
    writeJsonAtomic(this.paths.reportIndexFile, { version: 1, reports: merged } satisfies ReportIndexDocument);
  }

  listReports(): ReportRecord[] {
    const indexed = this.loadIndexedReports();
    const byFileName = new Map(indexed.map((record) => [record.fileName, record]));

    for (const entry of readdirSync(this.paths.reportsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.html') || byFileName.has(entry.name)) {
        continue;
      }

      const filePath = path.join(this.paths.reportsDir, entry.name);
      const html = readFileSync(filePath, 'utf8');
      const embedded = parseEmbeddedReport(html);
      const files = Array.isArray(embedded?.files) ? embedded.files : [];
      const sessionIds = Array.isArray(embedded?.sessionIds)
        ? embedded.sessionIds.map((value: unknown) => String(value))
        : [];

      byFileName.set(entry.name, {
        id: stableId('report', entry.name),
        sourceId: null,
        fileName: entry.name,
        sourceName: files.length > 0 ? path.basename(String(files[0])) : null,
        sourceKind: 'legacy',
        generatedAt: statSync(filePath).mtime.toISOString(),
        sessionIds,
        mode: legacyMode(html, embedded),
        status: 'legacy',
        legacy: true,
        reportUrl: `/reports/files/${encodeURIComponent(entry.name)}`,
      });
    }

    return [...byFileName.values()].sort(
      (a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt),
    );
  }

  findReportForSource(sourceId: string): ReportRecord | null {
    return this.listReports().find((report) => report.sourceId === sourceId) ?? null;
  }

  getReport(reportId: string): ReportRecord | null {
    return this.listReports().find((report) => report.id === reportId) ?? null;
  }

  resolveReportFile(fileName: string): string | null {
    if (path.basename(fileName) !== fileName || path.extname(fileName).toLowerCase() !== '.html') {
      return null;
    }
    const resolved = path.resolve(this.paths.reportsDir, fileName);
    const relative = path.relative(this.paths.reportsDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(resolved)) {
      return null;
    }
    return resolved;
  }
}

export class ReportJobManager {
  private readonly jobs = new Map<string, ReportJob>();
  private readonly queuedSources = new Map<string, ReportSource>();
  private readonly queue: string[] = [];
  private running = false;

  constructor(
    readonly paths: ReportControlPaths,
    private readonly reportCatalog: ReportCatalog,
  ) {
    ensureDirectory(path.dirname(paths.jobLedgerFile));
    this.loadLedger();
  }

  private loadLedger(): void {
    if (!existsSync(this.paths.jobLedgerFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.paths.jobLedgerFile, 'utf8')) as JobLedgerDocument;
      const now = new Date().toISOString();
      for (const persisted of parsed.jobs ?? []) {
        const job = { ...persisted, messages: [...persisted.messages] };
        if (job.status === 'queued' || job.status === 'running') {
          job.status = 'failed';
          job.finishedAt = now;
          job.error = 'Report server restarted before this job completed.';
          job.messages.push('Interrupted by report server restart');
        }
        this.jobs.set(job.id, job);
      }
      this.persistLedger();
    } catch (error) {
      console.warn(`Report job ledger could not be read: ${String(error)}`);
    }
  }

  private persistLedger(): void {
    const jobs = [...this.jobs.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 200);
    writeJsonAtomic(this.paths.jobLedgerFile, { version: 1, jobs } satisfies JobLedgerDocument);
  }

  createJob(source: ReportSource): ReportJob {
    const now = new Date().toISOString();
    const job: ReportJob = {
      id: randomUUID(),
      sourceId: source.id,
      sourceName: source.name,
      status: 'queued',
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      messages: ['Queued for report generation'],
      reportId: null,
      reportUrl: null,
      error: null,
    };

    this.jobs.set(job.id, job);
    this.queuedSources.set(job.id, source);
    this.queue.push(job.id);
    this.persistLedger();
    void this.pump();
    return { ...job, messages: [...job.messages] };
  }

  getJob(jobId: string): ReportJob | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job, messages: [...job.messages] } : null;
  }

  listJobs(): ReportJob[] {
    return [...this.jobs.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((job) => ({ ...job, messages: [...job.messages] }));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const jobId = this.queue.shift();
    if (!jobId) return;

    const job = this.jobs.get(jobId);
    const source = this.queuedSources.get(jobId);
    if (!job || !source) {
      void this.pump();
      return;
    }

    this.running = true;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.messages.push('Report generation started');
    this.persistLedger();

    try {
      const outputPath = buildReportOutputPath(this.paths.reportsDir, new Date(), job.id.slice(0, 8));
      const generated = await generateReport({
        files: [source.internalPath],
        outputPath,
        onProgress: (message) => {
          job.messages.push(message);
          this.persistLedger();
        },
      });
      const fileName = path.basename(generated.outputPath);
      const record: ReportRecord = {
        id: stableId('report', fileName),
        sourceId: source.id,
        fileName,
        sourceName: source.name,
        sourceKind: source.kind,
        generatedAt: new Date().toISOString(),
        sessionIds: generated.report.sessionIds,
        mode: generated.mode,
        status: 'completed',
        legacy: false,
        reportUrl: `/reports/files/${encodeURIComponent(fileName)}`,
      };
      this.reportCatalog.addGeneratedReport(record);

      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
      job.reportId = record.id;
      job.reportUrl = record.reportUrl;
      job.messages.push('Report indexed and ready to open');
    } catch (error) {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.error = error instanceof Error ? error.message : String(error);
      job.messages.push(`Failed: ${job.error}`);
    } finally {
      this.queuedSources.delete(jobId);
      this.persistLedger();
      this.running = false;
      void this.pump();
    }
  }
}

export function toSourceSummary(source: ReportSource): ReportSourceSummary {
  const { internalPath: _internalPath, ...summary } = source;
  return summary;
}
