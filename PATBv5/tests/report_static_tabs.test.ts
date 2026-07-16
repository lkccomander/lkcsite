import assert from "node:assert/strict";

import { renderReportHtml } from "../src/report/renderer";
import { buildReportFixture } from "./report_fixture";

function run(): void {
    const html = renderReportHtml(buildReportFixture());
    const tabs = ["overview", "trade", "signals", "feed", "actions"];

    for (const tab of tabs) {
        assert.match(html, new RegExp(`data-report-tab="${tab}"`), `missing ${tab} tab control`);
        assert.match(html, new RegExp(`id="report-panel-${tab}"`), `missing ${tab} panel`);
    }

    assert.match(html, /No executed trades in this slice/, "Trade content must be server-rendered");
    assert.match(html, /signal\.momentum/, "Signals content must be server-rendered");
    assert.match(html, /Per-window feed health/, "Feed content must be server-rendered");
    assert.match(html, /What went well/, "Actions content must be server-rendered");
    assert.match(html, /data-report-tabs-controller/, "static tab controller must be embedded");
}

run();
