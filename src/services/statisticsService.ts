// ============================================================================
// Statistics Service - Track call metrics date-wise
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { blandService } from "./blandService";

interface DailyStats {
  date: string; // YYYY-MM-DD
  total_calls: number;
  completed_calls: number;
  failed_calls: number;
  answered_calls: number;
  transferred_calls: number;
  voicemail_calls: number;
  no_answer_calls: number;
  busy_calls: number;
  not_interested_calls: number;
  callback_requested_calls: number;
  // Calculated metrics
  connectivity_rate?: number; // (answered_calls / total_calls) * 100
  transfer_rate?: number; // (transferred_calls / answered_calls) * 100
  success_rate?: number; // (completed_calls / total_calls) * 100
}

class StatisticsService {
  private statsDir: string;

  constructor() {
    this.statsDir = path.join(process.cwd(), "data", "statistics");
    this.ensureStatsDirectory();
  }

  private ensureStatsDirectory(): void {
    if (!fs.existsSync(this.statsDir)) {
      fs.mkdirSync(this.statsDir, { recursive: true });
      logger.info("Created statistics directory", { path: this.statsDir });
    }
  }

  private getStatsFilePath(date: string): string {
    return path.join(this.statsDir, `stats_${date}.json`);
  }

  private getTodayDate(): string {
    // Use EST timezone for date-based statistics (not UTC)
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date()); // Returns YYYY-MM-DD in EST
  }

  /**
   * Get statistics for a specific date
   */
  getStatsByDate(date: string): DailyStats {
    const filePath = this.getStatsFilePath(date);

    if (!fs.existsSync(filePath)) {
      return this.initializeStats(date);
    }

    try {
      const data = fs.readFileSync(filePath, "utf-8");
      const stats = JSON.parse(data) as DailyStats;
      return this.calculateRates(stats);
    } catch (error: any) {
      logger.error("Failed to read stats file", {
        date,
        error: error.message,
      });
      return this.initializeStats(date);
    }
  }

  /**
   * Get statistics for today
   */
  getTodayStats(): DailyStats {
    return this.getStatsByDate(this.getTodayDate());
  }

  /**
   * Get statistics for a date range
   */
  getStatsByDateRange(startDate: string, endDate: string): DailyStats[] {
    const stats: DailyStats[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const datePart = d.toISOString().split("T")[0];
      const dateStr = datePart || "";
      if (dateStr) {
        stats.push(this.getStatsByDate(dateStr));
      }
    }

    return stats;
  }

  /**
   * Initialize empty statistics for a date
   */
  private initializeStats(date: string): DailyStats {
    return {
      date,
      total_calls: 0,
      completed_calls: 0,
      failed_calls: 0,
      answered_calls: 0,
      transferred_calls: 0,
      voicemail_calls: 0,
      no_answer_calls: 0,
      busy_calls: 0,
      not_interested_calls: 0,
      callback_requested_calls: 0,
      connectivity_rate: 0,
      transfer_rate: 0,
      success_rate: 0,
    };
  }

  /**
   * Calculate derived metrics
   *
   * MARLINEA'S FORMULA:
   * - connectivity_rate = (transferred_calls / answered_calls) * 100
   *   This measures: "Of the calls we answered, how many transferred successfully?"
   *   Example: 24 transferred / 50 answered = 48% connectivity rate
   *
   * - transfer_rate is kept the same (also transferred/answered) for backwards compatibility
   * - success_rate = (completed_calls / total_calls) * 100
   */
  private calculateRates(stats: DailyStats): DailyStats {
    // UPDATED: Connectivity rate now matches Marlinea's formula
    // transferred_calls / answered_calls (not answered_calls / total_calls)
    stats.connectivity_rate =
      stats.answered_calls > 0
        ? (stats.transferred_calls / stats.answered_calls) * 100
        : 0;

    // Transfer rate (same formula as connectivity rate for backwards compatibility)
    stats.transfer_rate =
      stats.answered_calls > 0
        ? (stats.transferred_calls / stats.answered_calls) * 100
        : 0;

    stats.success_rate =
      stats.total_calls > 0
        ? (stats.completed_calls / stats.total_calls) * 100
        : 0;

    // Round to 2 decimal places
    stats.connectivity_rate = Math.round(stats.connectivity_rate * 100) / 100;
    stats.transfer_rate = Math.round(stats.transfer_rate * 100) / 100;
    stats.success_rate = Math.round(stats.success_rate * 100) / 100;

    return stats;
  }

  /**
   * Save statistics to file (atomic write)
   */
  private saveStats(stats: DailyStats): void {
    const filePath = this.getStatsFilePath(stats.date);
    const tempPath = `${filePath}.tmp`;

    try {
      // Atomic write: write to temp file first, then rename
      fs.writeFileSync(tempPath, JSON.stringify(stats, null, 2), "utf-8");
      fs.renameSync(tempPath, filePath);
    } catch (error: any) {
      logger.error("Failed to save stats", {
        date: stats.date,
        error: error.message,
      });
      // Clean up temp file if it exists
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Record a call completion
   * @param outcome - Call outcome (e.g., TRANSFERRED, VOICEMAIL, NO_ANSWER)
   * @param pathway_tags - Bland pathway tags (used to match Marlinea's filtering logic)
   *
   * NOTE: answered_by and transcript parameters removed - we now use pathway_tags
   * to match Marlinea's Bland filter logic for answered/transferred counts.
   */
  recordCallComplete(
    outcome: string,
    pathway_tags?: string[]
  ): void {
    const today = this.getTodayDate();
    const stats = this.getStatsByDate(today);

    stats.total_calls++;
    stats.completed_calls++;

    // Categorize by outcome
    const normalizedOutcome = outcome.toLowerCase();

    // Normalize pathway tags for matching (filter out null/undefined and convert to lowercase)
    const tags = (pathway_tags || [])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase());

    // ============================================================================
    // MARLINEA'S LOGIC FOR ANSWERED CALLS:
    // A call is "answered" if it has EITHER:
    // - "Plan Type" tag (human engaged enough to discuss plan), OR
    // - "Voicemail Left" tag (successfully left a voicemail)
    // This matches the Bland filter: Tags includes "Plan Type" OR "Voicemail Left"
    // ============================================================================
    const hasPlanTypeTag = tags.some((tag) => tag.includes("plan type"));
    const hasVoicemailLeftTag = tags.some((tag) => tag.includes("voicemail left"));

    if (hasPlanTypeTag || hasVoicemailLeftTag) {
      stats.answered_calls++;
    }

    // ============================================================================
    // MARLINEA'S LOGIC FOR TRANSFERRED CALLS:
    // A call is "transferred" if it has "Transferred to Agent" tag
    // This matches the Bland filter: Tags includes "Transferred to Agent"
    // ============================================================================
    const hasTransferredTag = tags.some((tag) => tag.includes("transferred to agent"));

    if (hasTransferredTag) {
      stats.transferred_calls++;
    }

    // Continue tracking other outcome-based stats for internal reporting
    if (normalizedOutcome.includes("voicemail") || normalizedOutcome.includes("machine")) {
      stats.voicemail_calls++;
    }

    if (normalizedOutcome.includes("no_answer")) {
      stats.no_answer_calls++;
    }

    if (normalizedOutcome.includes("busy")) {
      stats.busy_calls++;
    }

    if (normalizedOutcome.includes("not_interested")) {
      stats.not_interested_calls++;
    }

    if (normalizedOutcome.includes("callback")) {
      stats.callback_requested_calls++;
    }

    this.saveStats(this.calculateRates(stats));

    logger.info("Statistics updated", {
      date: today,
      outcome,
      pathway_tags: tags,
      has_plan_type: hasPlanTypeTag,
      has_voicemail_left: hasVoicemailLeftTag,
      has_transferred: hasTransferredTag,
      total_calls: stats.total_calls,
      answered_calls: stats.answered_calls,
      transferred_calls: stats.transferred_calls,
    });
  }

  /**
   * Record a call failure
   */
  recordCallFailure(error: string): void {
    const today = this.getTodayDate();
    const stats = this.getStatsByDate(today);

    stats.total_calls++;
    stats.failed_calls++;

    this.saveStats(this.calculateRates(stats));

    logger.info("Call failure recorded", {
      date: today,
      error,
      failed_calls: stats.failed_calls,
    });
  }

  /**
   * Get aggregate statistics across all dates
   */
  getAllTimeStats(): DailyStats & { total_days: number } {
    const files = fs.readdirSync(this.statsDir);
    const allStats = this.initializeStats("all-time");
    let totalDays = 0;

    for (const file of files) {
      if (file.startsWith("stats_") && file.endsWith(".json")) {
        try {
          const data = fs.readFileSync(
            path.join(this.statsDir, file),
            "utf-8"
          );
          const dayStats = JSON.parse(data) as DailyStats;

          allStats.total_calls += dayStats.total_calls;
          allStats.completed_calls += dayStats.completed_calls;
          allStats.failed_calls += dayStats.failed_calls;
          allStats.answered_calls += dayStats.answered_calls;
          allStats.transferred_calls += dayStats.transferred_calls;
          allStats.voicemail_calls += dayStats.voicemail_calls;
          allStats.no_answer_calls += dayStats.no_answer_calls;
          allStats.busy_calls += dayStats.busy_calls;
          allStats.not_interested_calls += dayStats.not_interested_calls;
          allStats.callback_requested_calls += dayStats.callback_requested_calls;

          totalDays++;
        } catch (error: any) {
          logger.error("Failed to read stats file", {
            file,
            error: error.message,
          });
        }
      }
    }

    return {
      ...this.calculateRates(allStats),
      total_days: totalDays,
    };
  }

  /**
   * Recalculate statistics for a specific date by fetching call logs from Bland API
   * Uses Marlinea's logic:
   * - answered_calls = calls with "Plan Type" OR "Voicemail Left" tags
   * - transferred_calls = calls with "Transferred to Agent" tag
   * - connectivity_rate = transferred_calls / answered_calls * 100
   *
   * @param date - Date in YYYY-MM-DD format
   * @param pathwayId - Optional pathway ID filter
   * @returns Updated statistics for the date
   */
  async recalculateStatsFromBland(
    date: string,
    pathwayId?: string
  ): Promise<DailyStats> {
    logger.info("Recalculating statistics from Bland API", { date, pathwayId });

    try {
      // Fetch call logs from Bland
      const calls = await blandService.getCallLogsByDate(date, pathwayId);

      // Initialize fresh stats
      const stats = this.initializeStats(date);

      // Process each call using Marlinea's logic
      for (const call of calls) {
        stats.total_calls++;
        stats.completed_calls++;

        // Normalize tags for matching (filter out null/undefined and convert to lowercase)
        const tags = (call.pathway_tags || [])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.toLowerCase());

        // MARLINEA'S LOGIC: answered = "Plan Type" OR "Voicemail Left" tag
        const hasPlanTypeTag = tags.some((tag) => tag.includes("plan type"));
        const hasVoicemailLeftTag = tags.some((tag) =>
          tag.includes("voicemail left")
        );

        if (hasPlanTypeTag || hasVoicemailLeftTag) {
          stats.answered_calls++;
        }

        // MARLINEA'S LOGIC: transferred = "Transferred to Agent" tag
        const hasTransferredTag = tags.some((tag) =>
          tag.includes("transferred to agent")
        );

        if (hasTransferredTag) {
          stats.transferred_calls++;
        }

        // Track other stats based on answered_by for internal reporting
        const answeredBy = call.answered_by.toLowerCase();
        if (answeredBy === "voicemail" || answeredBy === "machine") {
          stats.voicemail_calls++;
        }
        if (answeredBy === "no-answer" || answeredBy === "no_answer") {
          stats.no_answer_calls++;
        }
        if (answeredBy === "busy") {
          stats.busy_calls++;
        }
      }

      // Calculate rates and save
      const finalStats = this.calculateRates(stats);
      this.saveStats(finalStats);

      logger.info("Statistics recalculated successfully", {
        date,
        total_calls: finalStats.total_calls,
        answered_calls: finalStats.answered_calls,
        transferred_calls: finalStats.transferred_calls,
        connectivity_rate: finalStats.connectivity_rate,
      });

      return finalStats;
    } catch (error: any) {
      logger.error("Failed to recalculate statistics", {
        date,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Recalculate statistics for a date range
   *
   * @param startDate - Start date in YYYY-MM-DD format
   * @param endDate - End date in YYYY-MM-DD format
   * @param pathwayId - Optional pathway ID filter
   * @returns Array of updated statistics for each date
   */
  async recalculateStatsForDateRange(
    startDate: string,
    endDate: string,
    pathwayId?: string
  ): Promise<DailyStats[]> {
    logger.info("Recalculating statistics for date range", {
      startDate,
      endDate,
      pathwayId,
    });

    const results: DailyStats[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      if (dateStr) {
        try {
          const stats = await this.recalculateStatsFromBland(dateStr, pathwayId);
          results.push(stats);

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error: any) {
          logger.error("Failed to recalculate stats for date", {
            date: dateStr,
            error: error.message,
          });
          // Continue with next date even if one fails
        }
      }
    }

    logger.info("Finished recalculating statistics for date range", {
      startDate,
      endDate,
      dates_processed: results.length,
    });

    return results;
  }
}

export const statisticsService = new StatisticsService();
