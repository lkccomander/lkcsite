// src/report/index.ts
import { parseTelemetry } from './parser';
import { detectAnomalies, evaluateGateChecks } from './anomalies';
import { renderReport } from './renderer';
import { SessionReport } from './types';
import fs from 'fs';
import path from 'path';

function resolveDefaultTelemetryFile(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'polydb', 'telemetry', 'events.jsonl'),
    path.resolve(process.cwd(), '..', 'polydb', 'telemetry', 'events.jsonl')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const options = {
    files: [] as string[],
    botId: '',
    tail: 50000,
    out: '',
    serve: false,
    port: 4242
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        if (i + 1 < args.length) {
          options.files.push(args[i + 1]);
          i++;
        }
        break;
      case '--bot-id':
        if (i + 1 < args.length) {
          options.botId = args[i + 1];
          i++;
        }
        break;
      case '--tail':
        if (i + 1 < args.length) {
          options.tail = parseInt(args[i + 1]);
          i++;
        }
        break;
      case '--out':
        if (i + 1 < args.length) {
          options.out = args[i + 1];
          i++;
        }
        break;
      case '--serve':
        options.serve = true;
        break;
      case '--port':
        if (i + 1 < args.length) {
          options.port = parseInt(args[i + 1]);
          i++;
        }
        break;
    }
  }
  
  // If serving, start the server
  if (options.serve) {
    const serverModule = await import('./server');
    const app = serverModule.default;
    
    // Try to start server on specified port, fallback to next available
    let serverPort = options.port;
    const server = app.listen(serverPort, () => {
      console.log(`Report server running at http://localhost:${serverPort}`);
    });
    
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${serverPort} is busy, trying next available port...`);
        serverPort++;
        server.close(() => {
          app.listen(serverPort, () => {
            console.log(`Report server running at http://localhost:${serverPort}`);
          });
        });
      }
    });
    
    return;
  }
  
  // Parse telemetry files
  if (options.files.length === 0) {
    const defaultTelemetryFile = resolveDefaultTelemetryFile();
    if (!defaultTelemetryFile) {
      console.error('No files specified. Use --file to specify telemetry files.');
      process.exit(1);
    }
    options.files.push(defaultTelemetryFile);
  }
  
  try {
    console.log('Parsing telemetry data...');
    const report = await parseTelemetry(options.files, options.tail);
    
    // Add anomalies and gate checks
    (report as any).anomalies = detectAnomalies(report);
    (report as any).gateChecks = evaluateGateChecks(report);
    
    // Generate output path if not specified
    if (!options.out) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      options.out = path.join('polydb', 'reports', `session-review-${timestamp}.html`);
    }
    
    // Render the report
    await renderReport(report, options.out);
    
    console.log(`✓ Report written (${report.trades.length} trades · ${report.sessionIds.length} sessions · ${report.totalEvents} events)`);
  } catch (error) {
    console.error('Error generating report:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
