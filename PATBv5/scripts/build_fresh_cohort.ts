import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

type Mode = "PAPER" | "LIVE" | "UNKNOWN";

type SessionSummary = {
  fileName: string;
  filePath: string;
  sessionId: string;
  sessionDate: string;
  mode: Mode;
  strategy: string | null;
  loadedStrategySection: string | null;
  momentumEvents: number;
  momentumRawEvents: number;
  monteCarloEvents: number;
  acceptedSignals: number;
  paperBuys: number;
  paperSells: number;
  liveBuys: number;
  liveSells: number;
  fallbackEvents: number;
  reasonsExcluded: string[];
};

type CliOptions = {
  since: string;
  mode: Mode | "ANY";
  strategy: string;
  requireRawMomentum: boolean;
  requireMonteCarlo: boolean;
  excludeZeroSignalCoverage: boolean;
  outFile: string;
  reportFile: string;
  sessionsDir: string;
};

const projectRoot = path.resolve(__dirname, "..");
const defaultSessionsDir = path.resolve(projectRoot, "..", "polydb", "telemetry", "sessions");

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    since: "2026-06-05",
    mode: "PAPER",
    strategy: "trade_5x",
    requireRawMomentum: true,
    requireMonteCarlo: true,
    excludeZeroSignalCoverage: true,
    outFile: path.resolve(projectRoot, "sessions_fresh_comparable.txt"),
    reportFile: path.resolve(projectRoot, "sessions_fresh_comparable_report.json"),
    sessionsDir: defaultSessionsDir,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--since" || arg === "--date-from") && next) {
      opts.since = next;
      i += 1;
    } else if (arg === "--mode" && next) {
      const mode = next.toUpperCase();
      if (mode === "PAPER" || mode === "LIVE" || mode === "ANY") {
        opts.mode = mode;
      } else {
        throw new Error(`Unsupported --mode value: ${next}`);
      }
      i += 1;
    } else if (arg === "--strategy" && next) {
      opts.strategy = next;
      i += 1;
    } else if (arg === "--out-file" && next) {
      opts.outFile = path.resolve(projectRoot, next);
      i += 1;
    } else if (arg === "--report-file" && next) {
      opts.reportFile = path.resolve(projectRoot, next);
      i += 1;
    } else if (arg === "--sessions-dir" && next) {
      opts.sessionsDir = path.resolve(projectRoot, next);
      i += 1;
    } else if (arg === "--allow-zero-signal-coverage") {
      opts.excludeZeroSignalCoverage = false;
    } else if (arg === "--allow-missing-raw-momentum") {
      opts.requireRawMomentum = false;
    } else if (arg === "--allow-missing-montecarlo") {
      opts.requireMonteCarlo = false;
    }
  }

  return opts;
}

function normalizeDate(dateText: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error(`Expected YYYY-MM-DD for --since, got: ${dateText}`);
  }
  return dateText;
}

async function summarizeSession(filePath: string): Promise<SessionSummary> {
  const fileName = path.basename(filePath);
  const sessionIdMatch = fileName.match(/__([0-9a-f-]{36})\.jsonl$/i);
  if (!sessionIdMatch) {
    throw new Error(`Could not derive sessionId from ${fileName}`);
  }

  const sessionDate = fileName.slice(0, 10);
  const session: SessionSummary = {
    fileName,
    filePath,
    sessionId: sessionIdMatch[1],
    sessionDate,
    mode: "UNKNOWN",
    strategy: null,
    loadedStrategySection: null,
    momentumEvents: 0,
    momentumRawEvents: 0,
    monteCarloEvents: 0,
    acceptedSignals: 0,
    paperBuys: 0,
    paperSells: 0,
    liveBuys: 0,
    liveSells: 0,
    fallbackEvents: 0,
    reasonsExcluded: [],
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const type = event?.type;
    const payload = event?.payload ?? {};

    if (type === "bot.startup") {
      if (payload.mode === "PAPER" || payload.mode === "LIVE") {
        session.mode = payload.mode;
      }
    } else if (type === "bot.startup_config") {
      session.strategy = typeof payload.strategy === "string" ? payload.strategy : session.strategy;
      session.loadedStrategySection = typeof payload.loadedStrategySection === "string"
        ? payload.loadedStrategySection
        : session.loadedStrategySection;
    } else if (type === "signal.momentum") {
      session.momentumEvents += 1;
      const hasRaw =
        Object.prototype.hasOwnProperty.call(payload, "rawDelta1m")
        || Object.prototype.hasOwnProperty.call(payload, "rawDelta5m")
        || Object.prototype.hasOwnProperty.call(payload, "rawVolRatio");
      if (hasRaw) {
        session.momentumRawEvents += 1;
      }
    } else if (type === "signal.montecarlo") {
      session.monteCarloEvents += 1;
    } else if (type === "trade.signal_accepted") {
      session.acceptedSignals += 1;
    } else if (type === "paper_trade.buy") {
      session.paperBuys += 1;
    } else if (type === "paper_trade.sell") {
      session.paperSells += 1;
    } else if (type === "live_trade.buy") {
      session.liveBuys += 1;
    } else if (type === "live_trade.sell") {
      session.liveSells += 1;
    } else if (type === "feed.fallback") {
      session.fallbackEvents += 1;
    }
  }

  return session;
}

function applyFilters(session: SessionSummary, opts: CliOptions, since: string): void {
  if (session.sessionDate < since) {
    session.reasonsExcluded.push(`before_since:${since}`);
  }

  if (opts.mode !== "ANY" && session.mode !== opts.mode) {
    session.reasonsExcluded.push(`mode:${session.mode}`);
  }

  if (session.strategy !== opts.strategy) {
    session.reasonsExcluded.push(`strategy:${session.strategy ?? "missing"}`);
  }

  if (opts.requireRawMomentum && session.momentumEvents > 0 && session.momentumRawEvents !== session.momentumEvents) {
    session.reasonsExcluded.push(`raw_momentum:${session.momentumRawEvents}/${session.momentumEvents}`);
  }

  if (opts.requireRawMomentum && session.momentumEvents === 0) {
    session.reasonsExcluded.push("no_momentum_events");
  }

  if (opts.requireMonteCarlo && session.monteCarloEvents === 0) {
    session.reasonsExcluded.push("no_montecarlo_events");
  }

  if (opts.excludeZeroSignalCoverage) {
    const usefulCoverage =
      session.acceptedSignals
      + session.paperBuys
      + session.paperSells
      + session.liveBuys
      + session.liveSells
      + session.momentumEvents
      + session.monteCarloEvents;
    if (usefulCoverage === 0) {
      session.reasonsExcluded.push("zero_signal_coverage");
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const since = normalizeDate(opts.since);

  if (!fs.existsSync(opts.sessionsDir)) {
    throw new Error(`Sessions dir not found: ${opts.sessionsDir}`);
  }

  const files = fs.readdirSync(opts.sessionsDir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .filter((name) => name.slice(0, 10) >= since)
    .map((name) => path.join(opts.sessionsDir, name));

  const sessions: SessionSummary[] = [];
  for (const filePath of files) {
    const summary = await summarizeSession(filePath);
    applyFilters(summary, opts, since);
    sessions.push(summary);
  }

  const included = sessions.filter((session) => session.reasonsExcluded.length === 0);
  const excluded = sessions.filter((session) => session.reasonsExcluded.length > 0);

  const reasonCounts = new Map<string, number>();
  for (const session of excluded) {
    for (const reason of session.reasonsExcluded) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  fs.writeFileSync(opts.outFile, `${included.map((session) => session.sessionId).join("\n")}${included.length ? "\n" : ""}`, "utf8");
  fs.writeFileSync(opts.reportFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    filters: {
      since,
      mode: opts.mode,
      strategy: opts.strategy,
      requireRawMomentum: opts.requireRawMomentum,
      requireMonteCarlo: opts.requireMonteCarlo,
      excludeZeroSignalCoverage: opts.excludeZeroSignalCoverage,
    },
    counts: {
      totalSessionsScanned: sessions.length,
      includedSessions: included.length,
      excludedSessions: excluded.length,
    },
    includedSessions: included.map((session) => ({
      sessionId: session.sessionId,
      fileName: session.fileName,
      mode: session.mode,
      strategy: session.strategy,
      momentumEvents: session.momentumEvents,
      momentumRawEvents: session.momentumRawEvents,
      monteCarloEvents: session.monteCarloEvents,
      acceptedSignals: session.acceptedSignals,
      paperBuys: session.paperBuys,
      liveBuys: session.liveBuys,
      fallbackEvents: session.fallbackEvents,
    })),
    excludedSessions: excluded.map((session) => ({
      sessionId: session.sessionId,
      fileName: session.fileName,
      mode: session.mode,
      strategy: session.strategy,
      reasonsExcluded: session.reasonsExcluded,
    })),
    exclusionReasonCounts: Object.fromEntries([...reasonCounts.entries()].sort((a, b) => b[1] - a[1])),
  }, null, 2), "utf8");

  console.log(`Fresh cohort written: ${opts.outFile}`);
  console.log(`Cohort report written: ${opts.reportFile}`);
  console.log(`Sessions scanned: ${sessions.length}`);
  console.log(`Included: ${included.length}`);
  console.log(`Excluded: ${excluded.length}`);
  if (included.length) {
    console.log("Included session IDs:");
    for (const session of included) {
      console.log(`  - ${session.sessionId} | ${session.mode} | ${session.fileName}`);
    }
  }
  if (reasonCounts.size) {
    console.log("Top exclusion reasons:");
    for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  - ${reason}: ${count}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
