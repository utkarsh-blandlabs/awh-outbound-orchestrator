/**
 * Daily Report Service
 * Provides comprehensive daily reporting for team sync meetings
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import { webhookLogger } from "./webhookLogger";
import { redialQueueService } from "./redialQueueService";
import { blocklistService } from "./blocklistService";

interface DailyReport {
  date: string;
  generated_at: string;

  // New leads today
  new_leads: {
    total_webhooks_received: number;
    unique_phone_numbers: number;
    unique_lead_ids: number;
    validation_passed: number;
    validation_failed: number;
    blocklist_blocked: number;
    successfully_queued: number;
  };

  // Redial queue stats
  redial_queue: {
    total_lifetime: number; // All leads ever in redial queue
    active_today: number; // Leads being redialed today
    from_yesterday: number; // Leads pushed from yesterday
    from_older_days: number; // Leads from 2+ days ago
    daily_max_reached_today: number; // Leads that hit 8 calls today
    completed_today: number; // Leads completed today (transferred, sale, etc.)
    breakdown_by_age: {
      day_0: number; // Same day leads (45 min intervals)
      day_1: number; // Yesterday's leads (120 min intervals)
      day_2_plus: number; // 2+ days old (240 min intervals)
    };
  };

  // Call outcomes today
  outcomes_today: {
    total_calls_made: number;
    transferred: number;
    voicemail: number;
    no_answer: number;
    busy: number;
    not_interested: number;
    callback_requested: number;
    failed: number;
  };
}

class DailyReportService {
  private dataDir: string;

  constructor() {
    this.dataDir = path.join(__dirname, "../../data/daily-reports");

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    logger.info("Daily report service initialized");
  }

  /**
   * Get current date in EST timezone (YYYY-MM-DD format)
   */
  private getCurrentDateEST(): string {
    const now = new Date();
    return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }

  /**
   * Get yesterday's date in EST timezone
   */
  private getYesterdayDateEST(): string {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }

  /**
   * Calculate days between two dates
   */
  private getDaysBetween(date1: string, date2: string): number {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Generate comprehensive daily report
   */
  async generateReport(date: string): Promise<DailyReport> {
    logger.info("Generating daily report", { date });

    // Get webhook logs for the date
    const webhookLogs = webhookLogger.getLogsByDate(date);
    const webhookStats = webhookLogger.getStatsByDate(date);

    // Get unique phone numbers and lead IDs from webhooks
    const uniquePhones = new Set(webhookLogs.map(l => l.phone_number)).size;
    const uniqueLeadIds = new Set(webhookLogs.map(l => l.lead_id)).size;

    // Get blocklist stats
    const blocklistAttempts = blocklistService.getAttempts(date);
    const blockedCount = blocklistAttempts.filter(a => a.blocked).length;

    // Get all redial queue records
    const allRedialRecords = redialQueueService.getAllRecords({});

    // Total lifetime leads in redial queue
    const totalLifetime = allRedialRecords.length;

    // Get today's date boundaries
    const dateStart = new Date(`${date}T00:00:00-05:00`).getTime();
    const dateEnd = new Date(`${date}T23:59:59-05:00`).getTime();

    // Leads created today
    const createdToday = allRedialRecords.filter(
      r => r.created_at >= dateStart && r.created_at <= dateEnd
    );

    // Leads active today (being called today - not completed, not paused)
    const activeToday = allRedialRecords.filter(
      r => r.status === "pending" || r.status === "rescheduled" || r.status === "daily_max_reached"
    );

    // Leads from yesterday
    const yesterday = this.getYesterdayDateEST();
    const yesterdayStart = new Date(`${yesterday}T00:00:00-05:00`).getTime();
    const yesterdayEnd = new Date(`${yesterday}T23:59:59-05:00`).getTime();

    const fromYesterday = allRedialRecords.filter(
      r => r.created_at >= yesterdayStart && r.created_at <= yesterdayEnd &&
      (r.status === "pending" || r.status === "rescheduled" || r.status === "daily_max_reached")
    );

    // Leads from 2+ days ago
    const twoDaysAgoStart = new Date(`${date}T00:00:00-05:00`).getTime() - (2 * 24 * 60 * 60 * 1000);

    const fromOlderDays = allRedialRecords.filter(
      r => r.created_at < yesterdayStart &&
      (r.status === "pending" || r.status === "rescheduled" || r.status === "daily_max_reached")
    );

    // Leads that hit daily max today
    const dailyMaxReachedToday = allRedialRecords.filter(
      r => r.status === "daily_max_reached" &&
      r.daily_max_reached_at &&
      r.daily_max_reached_at >= dateStart &&
      r.daily_max_reached_at <= dateEnd
    ).length;

    // Leads completed today
    const completedToday = allRedialRecords.filter(
      r => r.status === "completed" &&
      r.updated_at >= dateStart &&
      r.updated_at <= dateEnd
    ).length;

    // Breakdown by age (for active leads)
    const today = this.getCurrentDateEST();
    const day0 = activeToday.filter(r => {
      const createdDate = new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      return createdDate === today;
    }).length;

    const day1 = activeToday.filter(r => {
      const createdDate = new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      return createdDate === yesterday;
    }).length;

    const day2Plus = activeToday.filter(r => {
      const createdDate = new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      return createdDate !== today && createdDate !== yesterday;
    }).length;

    // Get outcome stats from redial queue records updated today
    const callsToday = allRedialRecords.filter(
      r => r.last_call_timestamp >= dateStart && r.last_call_timestamp <= dateEnd
    );

    const outcomes = {
      total_calls_made: callsToday.length,
      transferred: callsToday.filter(r => r.last_outcome?.includes("TRANSFER")).length,
      voicemail: callsToday.filter(r => r.last_outcome?.includes("VOICEMAIL")).length,
      no_answer: callsToday.filter(r => r.last_outcome?.includes("NO_ANSWER")).length,
      busy: callsToday.filter(r => r.last_outcome?.includes("BUSY")).length,
      not_interested: callsToday.filter(r => r.last_outcome?.includes("NOT_INTERESTED")).length,
      callback_requested: callsToday.filter(r => r.last_outcome?.includes("CALLBACK")).length,
      failed: 0, // Would need to track failures separately
    };

    const report: DailyReport = {
      date,
      generated_at: new Date().toISOString(),

      new_leads: {
        total_webhooks_received: webhookStats.total_requests,
        unique_phone_numbers: uniquePhones,
        unique_lead_ids: uniqueLeadIds,
        validation_passed: webhookStats.successful_validations,
        validation_failed: webhookStats.failed_validations,
        blocklist_blocked: blockedCount,
        successfully_queued: webhookStats.successfully_processed - blockedCount,
      },

      redial_queue: {
        total_lifetime: totalLifetime,
        active_today: activeToday.length,
        from_yesterday: fromYesterday.length,
        from_older_days: fromOlderDays.length,
        daily_max_reached_today: dailyMaxReachedToday,
        completed_today: completedToday,
        breakdown_by_age: {
          day_0: day0,
          day_1: day1,
          day_2_plus: day2Plus,
        },
      },

      outcomes_today: outcomes,
    };

    // Save report
    await this.saveReport(date, report);

    logger.info("Daily report generated", {
      date,
      total_lifetime_leads: totalLifetime,
      active_today: activeToday.length,
    });

    return report;
  }

  /**
   * Save report to disk
   */
  private async saveReport(date: string, report: DailyReport): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, `daily-report_${date}.json`);
      const data = JSON.stringify(report, null, 2);
      fs.writeFileSync(filePath, data, "utf-8");
    } catch (error: any) {
      logger.error("Failed to save daily report", {
        error: error.message,
        date,
      });
    }
  }

  /**
   * Get saved report
   */
  getReport(date: string): DailyReport | null {
    try {
      const filePath = path.join(this.dataDir, `daily-report_${date}.json`);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data) as DailyReport;
    } catch (error: any) {
      logger.error("Failed to read daily report", {
        error: error.message,
        date,
      });
      return null;
    }
  }

  /**
   * Generate today's report
   */
  async generateTodayReport(): Promise<DailyReport> {
    const today = this.getCurrentDateEST();
    return this.generateReport(today);
  }
}

export const dailyReportService = new DailyReportService();
