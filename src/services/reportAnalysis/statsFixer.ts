// ============================================================================
// Stats Fixer - Updates AWH statistics files using transcript analysis
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../../utils/logger";
import { TranscriptAnalyzer } from "./analyzer";
import { AnalysisStats } from "./types";

/**
 * Fix statistics for a single date using transcript analysis
 */
export async function fixStatsForDate(
  date: string,
  analyzer: TranscriptAnalyzer,
  dataDir: string,
  dryRun = false
): Promise<{ oldStats: any; newStats: AnalysisStats; changed: boolean } | null> {
  const statsFile = path.join(dataDir, "statistics", `stats_${date}.json`);
  const callsFile = path.join(dataDir, "daily-calls", `calls_${date}.json`);

  if (!fs.existsSync(statsFile)) {
    logger.info("No stats file, skipping", { date });
    return null;
  }

  if (!fs.existsSync(callsFile)) {
    logger.info("No calls file, skipping", { date });
    return null;
  }

  // Read current stats
  const oldStats = JSON.parse(fs.readFileSync(statsFile, "utf-8"));

  // Read call IDs from daily-calls file
  const dailyData = JSON.parse(fs.readFileSync(callsFile, "utf-8"));
  const records = Array.isArray(dailyData) ? dailyData : Object.values(dailyData);

  const callIds: Array<{ callId: string; phone: string }> = [];
  for (const record of records as any[]) {
    const phone = (record as any).phone_number || "";
    for (const call of (record as any).calls || []) {
      if (call.call_id) {
        callIds.push({ callId: call.call_id, phone });
      }
    }
  }

  if (callIds.length === 0) {
    logger.info("No calls found", { date });
    return null;
  }

  logger.info("Analyzing calls", { date, count: callIds.length });

  // Analyze all calls
  const results = await analyzer.fetchAndAnalyzeCallIds(callIds);
  const newStats = analyzer.calculateStats(date, results);

  // Check if anything changed
  const changed =
    oldStats.answered_calls !== newStats.answered_calls ||
    oldStats.transferred_calls !== newStats.transferred_calls ||
    oldStats.voicemail_calls !== newStats.voicemail_calls ||
    oldStats.busy_calls !== newStats.busy_calls ||
    oldStats.callback_requested_calls !== newStats.callback_requested_calls ||
    oldStats.failed_calls !== newStats.failed_calls ||
    oldStats.not_interested_calls !== newStats.not_interested_calls ||
    oldStats.no_answer_calls !== newStats.no_answer_calls;

  if (!dryRun && changed) {
    // Update stats file with ALL recalculated values
    const updated = {
      ...oldStats,
      total_calls: newStats.total_calls,
      completed_calls: newStats.completed_calls,
      failed_calls: newStats.failed_calls,
      answered_calls: newStats.answered_calls,
      transferred_calls: newStats.transferred_calls,
      voicemail_calls: newStats.voicemail_calls,
      busy_calls: newStats.busy_calls,
      no_answer_calls: newStats.no_answer_calls,
      callback_requested_calls: newStats.callback_requested_calls,
      not_interested_calls: newStats.not_interested_calls,
      connectivity_rate: newStats.connectivity_rate,
      transfer_rate: newStats.transfer_rate,
      success_rate: newStats.success_rate,
      last_updated: new Date().toISOString(),
    };

    fs.writeFileSync(statsFile, JSON.stringify(updated, null, 2), "utf-8");
    logger.info("Stats updated", { date });
  }

  return { oldStats, newStats, changed };
}

/**
 * Fix statistics for all dates
 */
export async function fixAllStats(
  analyzer: TranscriptAnalyzer,
  dataDir: string,
  dryRun = false
): Promise<Array<{ date: string; oldStats: any; newStats: AnalysisStats; changed: boolean }>> {
  const statsDir = path.join(dataDir, "statistics");

  if (!fs.existsSync(statsDir)) {
    logger.error("Statistics directory not found", { statsDir });
    return [];
  }

  const files = fs.readdirSync(statsDir)
    .filter((f) => f.startsWith("stats_") && f.endsWith(".json"))
    .sort();

  const results: Array<{ date: string; oldStats: any; newStats: AnalysisStats; changed: boolean }> = [];

  for (const file of files) {
    const date = file.replace("stats_", "").replace(".json", "");
    const result = await fixStatsForDate(date, analyzer, dataDir, dryRun);

    if (result) {
      results.push({ date, ...result });
    }
  }

  return results;
}
