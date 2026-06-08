import {
  buildScoreboard,
  loadCompletedEvaluations,
  loadScoreboardCoverage,
  persistScoreboard,
  renderCoverageSummary,
  renderScoreboardTable,
} from "../src/evaluation/scoreboard";

async function main(): Promise<void> {
  const coverage = await loadScoreboardCoverage();
  const evaluations = await loadCompletedEvaluations();
  const scoreboard = buildScoreboard(evaluations);
  const outputPath = await persistScoreboard(scoreboard);

  console.log(renderCoverageSummary(coverage));
  console.log("");
  if (coverage.missingEvaluations > 0) {
    console.log("Missing session IDs:");
    coverage.missingSessionIds.forEach((sessionId) => console.log(`  - ${sessionId}`));
    console.log("");
  }
  console.log(renderScoreboardTable(scoreboard));
  console.log(`\nSaved scoreboard to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
