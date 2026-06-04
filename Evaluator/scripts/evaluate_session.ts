import { evaluateSessionFile, persistSessionEvaluation, resolveSessionFile } from "../src/evaluation/sessionEvaluator";
import { getArgValue } from "../src/lib/cli";

async function main(): Promise<void> {
  const sessionId = getArgValue("--session-id");
  const telemetryFile = getArgValue("--telemetry-file");
  const sessionFile = await resolveSessionFile({ sessionId, telemetryFile });
  const evaluation = await evaluateSessionFile(sessionFile);
  const outputPath = await persistSessionEvaluation(evaluation);

  console.log(`Evaluated session ${evaluation.sessionId}`);
  console.log(`Status: ${evaluation.status}`);
  console.log(`Verdict: ${evaluation.evaluatorVerdict}`);
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
