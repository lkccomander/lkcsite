// src/report/renderer.ts
import * as fs from 'fs';
import * as path from 'path';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import ReportTemplate from './template';
import { SessionReport } from './types';

const reportTabStyles = `
  [data-report-tab][aria-selected="true"] {
    background: #fff !important;
    color: #0f172a !important;
    box-shadow: 0 1px 3px rgba(0,0,0,.1) !important;
  }
  [data-report-tab]:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
  html.report-tabs-enabled [data-report-panel][data-report-active="false"] {
    display: none;
  }
`;

const reportTabsController = `
  <script data-report-tabs-controller>
    (() => {
      const tabs = Array.from(document.querySelectorAll('[data-report-tab]'));
      const panels = Array.from(document.querySelectorAll('[data-report-panel]'));
      if (tabs.length === 0 || panels.length === 0) return;

      const activate = (tabId, moveFocus = false) => {
        tabs.forEach((tab) => {
          const selected = tab.getAttribute('data-report-tab') === tabId;
          tab.setAttribute('aria-selected', selected ? 'true' : 'false');
          tab.tabIndex = selected ? 0 : -1;
          if (selected && moveFocus) tab.focus();
        });
        panels.forEach((panel) => {
          panel.setAttribute(
            'data-report-active',
            panel.getAttribute('data-report-panel') === tabId ? 'true' : 'false'
          );
        });
      };

      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
          activate(tab.getAttribute('data-report-tab') || 'overview');
        });
        tab.addEventListener('keydown', (event) => {
          let nextIndex = index;
          if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = tabs.length - 1;
          else return;

          event.preventDefault();
          const nextTab = tabs[nextIndex];
          activate(nextTab.getAttribute('data-report-tab') || 'overview', true);
        });
      });

      const initiallySelected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
      activate(initiallySelected?.getAttribute('data-report-tab') || 'overview');
    })();
  </script>
`;

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
  <script>document.documentElement.classList.add('report-tabs-enabled');</script>
  <style>${reportTabStyles}</style>
  <script id="report-data" type="application/json">
${JSON.stringify(report, null, 2)}
  </script>
</head>
<body>
  <div id="root">${templateString}</div>
${reportTabsController}
</body>
</html>
  `.trim();
}
