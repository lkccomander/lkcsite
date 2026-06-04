import { resolve } from "path";
import { listJsonFiles, writeJsonFile } from "../lib/fs";
import { SCOREBOARDS_DIR, SESSION_EVALUATIONS_DIR } from "../paths";
import { ScoreboardRow, SessionEvaluation } from "../types";

function parseEvaluationVerdict(
  current: ScoreboardRow["evaluatorVerdict"],
  next: SessionEvaluation["evaluatorVerdict"]
): ScoreboardRow["evaluatorVerdict"] {
  const rank: Record<ScoreboardRow["evaluatorVerdict"], number> = {
    PASS: 1,
    WARNING: 2,
    UNKNOWN: 3,
    FAIL: 4,
  };

  const mapped = next === "INCOMPLETE" ? "UNKNOWN" : next;
  return rank[mapped] > rank[current] ? mapped : current;
}

export async function loadCompletedEvaluations(): Promise<SessionEvaluation[]> {
  const files = await listJsonFiles(SESSION_EVALUATIONS_DIR);
  const results: SessionEvaluation[] = [];

  for (const file of files) {
    const value = JSON.parse(await (await import("fs/promises")).readFile(file, "utf8")) as SessionEvaluation;
    if (value.status === "COMPLETED") {
      results.push(value);
    }
  }

  return results;
}

export function buildScoreboard(evaluations: SessionEvaluation[]): ScoreboardRow[] {
  const grouped = new Map<string, ScoreboardRow>();

  for (const evaluation of evaluations) {
    const key = [
      evaluation.strategyVersionId,
      evaluation.botBuildVersionId,
      evaluation.gitCommit,
      evaluation.mode,
    ].join("|");

    let row = grouped.get(key);
    if (!row) {
      row = {
        strategyVersionId: evaluation.strategyVersionId,
        botBuildVersionId: evaluation.botBuildVersionId,
        gitCommit: evaluation.gitCommit,
        mode: evaluation.mode,
        sessions: 0,
        completedSessions: 0,
        incompleteSessions: 0,
        totalTrades: 0,
        paperBuys: 0,
        paperSells: 0,
        liveBuys: 0,
        liveSells: 0,
        netPnl: 0,
        wins: 0,
        losses: 0,
        flats: 0,
        winRate: null,
        profitFactor: null,
        fallbackEvents: 0,
        fallbackRecoveries: 0,
        evaluatorVerdict: "PASS",
      };
      grouped.set(key, row);
    }

    row.sessions += 1;
    row.completedSessions += 1;
    row.totalTrades += evaluation.totalTrades;
    row.paperBuys += evaluation.paperBuys;
    row.paperSells += evaluation.paperSells;
    row.liveBuys += evaluation.liveBuys;
    row.liveSells += evaluation.liveSells;
    row.fallbackEvents += evaluation.fallbackEvents;
    row.fallbackRecoveries += evaluation.fallbackRecoveries;

    if (evaluation.netPnl != null) {
      row.netPnl += evaluation.netPnl;
      if (evaluation.netPnl > 0) row.wins += 1;
      else if (evaluation.netPnl < 0) row.losses += 1;
      else row.flats += 1;
    }

    row.evaluatorVerdict = parseEvaluationVerdict(row.evaluatorVerdict, evaluation.evaluatorVerdict);
  }

  for (const row of grouped.values()) {
    const decisionSessions = row.wins + row.losses + row.flats;
    row.winRate = decisionSessions > 0 ? Number(((row.wins / decisionSessions) * 100).toFixed(2)) : null;
    row.profitFactor = row.losses > 0
      ? Number((Math.abs(row.netPnl) / row.losses).toFixed(2))
      : row.netPnl > 0
        ? Number(row.netPnl.toFixed(2))
        : null;
  }

  return [...grouped.values()].sort((a, b) => b.netPnl - a.netPnl);
}

export async function persistScoreboard(rows: ScoreboardRow[]): Promise<string> {
  const path = resolve(SCOREBOARDS_DIR, "strategy_scoreboard_latest.json");
  await writeJsonFile(path, rows);
  return path;
}

export function renderScoreboardTable(rows: ScoreboardRow[]): string {
  const headers = ["Strategy", "Build", "Commit", "Mode", "Sess", "PnL", "Win%", "PF", "Verdict"];
  const tableRows = rows.map((row) => [
    row.strategyVersionId,
    row.botBuildVersionId,
    row.gitCommit,
    row.mode,
    String(row.sessions),
    row.netPnl.toFixed(2),
    row.winRate == null ? "-" : row.winRate.toFixed(2),
    row.profitFactor == null ? "-" : row.profitFactor.toFixed(2),
    row.evaluatorVerdict,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => row[index].length))
  );

  const formatRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index])).join(" | ");

  return [
    formatRow(headers),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...tableRows.map(formatRow),
  ].join("\n");
}
