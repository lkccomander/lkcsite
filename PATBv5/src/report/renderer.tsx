// src/report/renderer.ts
import * as fs from 'fs';
import * as path from 'path';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import ReportTemplate from './template';
import { SessionReport } from './types';

export async function renderReport(
  report: SessionReport,
  outputPath: string
): Promise<void> {
  try {
    const html = renderReportHtml(report);

    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, html, 'utf8');

    console.log(`✓ Report written to ${outputPath}`);
  } catch (error) {
    console.error('Error rendering report:', error);
    throw error;
  }
}

export function renderReportHtml(report: SessionReport): string {
  const templateString = renderToString(
    React.createElement(ReportTemplate, { report })
  );

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Review Report</title>
  <script id="report-data" type="application/json">
${JSON.stringify(report, null, 2)}
  </script>
</head>
<body>
  <div id="root">${templateString}</div>
</body>
</html>
  `.trim();
}
