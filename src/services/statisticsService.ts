// ============================================================================
// Statistics Service - Track call metrics date-wise
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

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
   */
  private calculateRates(stats: DailyStats): DailyStats {
    stats.connectivity_rate =
      stats.total_calls > 0
        ? (stats.answered_calls / stats.total_calls) * 100
        : 0;

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
   * Save statistics to file
   */
  private saveStats(stats: DailyStats): void {
    const filePath = this.getStatsFilePath(stats.date);

    try {
      fs.writeFileSync(filePath, JSON.stringify(stats, null, 2), "utf-8");
    } catch (error: any) {
      logger.error("Failed to save stats", {
        date: stats.date,
        error: error.message,
      });
    }
  }

  /**
   * Check if a call is actually voicemail (not a real human conversation)
   * Uses multiple signals to accurately detect voicemails
   */
  private isActuallyVoicemail(
    transcript: string,
    answered_by: string,
    outcome: string
  ): boolean {
    // Priority 1: Explicitly marked as voicemail/no-answer by Bland
    const answeredByLower = answered_by.toLowerCase();
    if (
      answeredByLower === "voicemail" ||
      answeredByLower === "no-answer" ||
      answeredByLower === "no_answer"
    ) {
      return true;
    }

    // Priority 2: Check transcript for Ashley's voicemail script
    // This is the MOST RELIABLE indicator - if Ashley left voicemail message, it's 100% voicemail
    const voicemailIndicators = [
      "i'm reaching out because you inquired about health insurance", // Ashley's voicemail script opening
      "please give me a call back at", // Ashley's voicemail callback request
      "you've reached the voicemail", // Generic voicemail greeting
      "please leave a message", // Voicemail prompt
      "is not available right now", // Common voicemail phrase
      "cannot take your call", // Common voicemail phrase
      "press 1 to leave a message", // Voicemail system prompt
    ];

    const transcriptLower = transcript.toLowerCase();
    const hasVoicemailScript = voicemailIndicators.some((indicator) =>
      transcriptLower.includes(indicator)
    );

    if (hasVoicemailScript) {
      return true;
    }

    // Priority 3: Check outcome
    const outcomeLower = outcome.toLowerCase();
    if (
      outcomeLower.includes("voicemail") ||
      outcomeLower.includes("no_answer") ||
      outcomeLower.includes("no answer")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Record a call completion
   * @param outcome - Call outcome (e.g., TRANSFERRED, VOICEMAIL, NO_ANSWER)
   * @param answered_by - Bland's detection (human, voicemail, no-answer, busy)
   * @param transcript - Full call transcript (used to detect voicemail scripts)
   */
  recordCallComplete(
    outcome: string,
    answered_by?: string,
    transcript?: string
  ): void {
    const today = this.getTodayDate();
    const stats = this.getStatsByDate(today);

    stats.total_calls++;
    stats.completed_calls++;

    // Categorize by outcome
    const normalizedOutcome = outcome.toLowerCase();

    // CRITICAL FIX: Check if it's actually voicemail before counting as answered
    // This fixes the bug where voicemails reaching "Identity Confirmation" were counted as answered
    const isVoicemail = this.isActuallyVoicemail(
      transcript || "",
      answered_by || "",
      outcome
    );

    // Only count as "answered" if:
    // 1. NOT a voicemail (verified via transcript + Bland detection)
    // 2. AND has indicators of human interaction
    if (
      !isVoicemail &&
      (answered_by === "human" ||
        normalizedOutcome.includes("transfer") ||
        normalizedOutcome.includes("sale") ||
        normalizedOutcome.includes("not_interested"))
    ) {
      stats.answered_calls++;
    }

    if (normalizedOutcome.includes("transfer")) {
      stats.transferred_calls++;
    }

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
      total_calls: stats.total_calls,
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
}

export const statisticsService = new StatisticsService();
