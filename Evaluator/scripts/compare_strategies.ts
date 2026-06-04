import { buildScoreboard, loadCompletedEvaluations, persistScoreboard, renderScoreboardTable } from "../src/evaluation/scoreboard";

async function main(): Promise<void> {
  const evaluations = await loadCompletedEvaluations();
  const scoreboard = buildScoreboard(evaluations);
  const outputPath = await persistScoreboard(scoreboard);

  console.log(renderScoreboardTable(scoreboard));
  console.log(`\nSaved scoreboard to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
