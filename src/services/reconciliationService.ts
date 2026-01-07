/**
 * Reconciliation Service
 * Compares webhook logs vs redial queue vs call outcomes to identify discrepancies
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import { webhookLogger } from "./webhookLogger";
import { redialQueueService } from "./redialQueueService";
import { blocklistService } from "./blocklistService";

interface ReconciliationReport {
  date: string;
  generated_at: string;

  // Webhook-level metrics
  webhooks: {
    total_received: number;
    validation_passed: number;
    validation_failed: number;
  };

  // Processing-level metrics
  processing: {
    blocklist_blocked: number;
    successfully_processed: number;
    processing_failed: number;
  };

  // Outcome breakdown
  breakdown: {
    in_redial_queue: number;
    completed_transferred: number;
    completed_other: number;
    daily_max_reached: number;
    total_accounted: number;
  };

  // Discrepancy detection
  discrepancies: {
    missing_from_queue: number; // Webhooks received but not in queue
    unaccounted_webhooks: number; // Total unaccounted
    details: string[];
  };

  // Blocklist impact
  blocklist_impact: {
    total_blocked: number;
    by_phone: number;
    by_lead_id: number;
    by_other: number;
  };
}

class ReconciliationService {
  private dataDir: string;

  constructor() {
    this.dataDir = path.join(__dirname, "../../data/reconciliation");

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    logger.info("Reconciliation service initialized");
  }

  /**
   * Get current date in EST timezone (YYYY-MM-DD format)
   */
  private getCurrentDateEST(): string {
    const now = new Date();
    return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }

  /**
   * Generate reconciliation report for a specific date
   */
  async generateReport(date: string): Promise<ReconciliationReport> {
    logger.info("Generating reconciliation report", { date });

    // Get webhook logs for the date
    const webhookLogs = webhookLogger.getLogsByDate(date);
    const webhookStats = webhookLogger.getStatsByDate(date);

    // Get redial queue stats (all-time, filtered by date in created_at)
    const redialRecords = redialQueueService.getAllRecords({});

    // Filter redial records created on this date
    const dateStart = new Date(`${date}T00:00:00-05:00`).getTime(); // EST start of day
    const dateEnd = new Date(`${date}T23:59:59-05:00`).getTime(); // EST end of day

    const redialRecordsForDate = redialRecords.filter(
      (r) => r.created_at >= dateStart && r.created_at <= dateEnd
    );

    // Get blocklist stats for the date
    const blocklistAttempts = blocklistService.getAttempts(date);
    const blockedAttempts = blocklistAttempts.filter((a) => a.blocked);

    // Calculate breakdown
    const inRedialQueue = redialRecordsForDate.filter(
      (r) => r.status === "pending" || r.status === "rescheduled" || r.status === "daily_max_reached"
    ).length;

    const completedTransferred = redialRecordsForDate.filter(
      (r) => r.status === "completed" &&
      (r.last_outcome === "TRANSFERRED" || r.last_outcome === "SALE" || r.last_outcome === "ACA")
    ).length;

    const completedOther = redialRecordsForDate.filter(
      (r) => r.status === "completed" &&
      r.last_outcome !== "TRANSFERRED" &&
      r.last_outcome !== "SALE" &&
      r.last_outcome !== "ACA"
    ).length;

    const dailyMaxReached = redialRecordsForDate.filter(
      (r) => r.status === "daily_max_reached"
    ).length;

    const totalAccounted = inRedialQueue + completedTransferred + completedOther;

    // Analyze blocklist impact
    const blocklistByPhone = blockedAttempts.filter((a) => a.field === "phone").length;
    const blocklistByLeadId = blockedAttempts.filter((a) => a.field === "lead_id").length;
    const blocklistByOther = blockedAttempts.length - blocklistByPhone - blocklistByLeadId;

    // Identify discrepancies
    const discrepancyDetails: string[] = [];

    // Missing from queue: webhooks that passed validation but aren't in redial queue
    const successfulWebhooks = webhookStats.successfully_processed;
    const expectedInQueue = successfulWebhooks - blockedAttempts.length;
    const actualInQueue = redialRecordsForDate.length;
    const missingFromQueue = Math.max(0, expectedInQueue - actualInQueue);

    if (missingFromQueue > 0) {
      discrepancyDetails.push(
        `${missingFromQueue} webhooks successfully processed but not found in redial queue`
      );
    }

    // Unaccounted webhooks
    const totalReceived = webhookStats.total_requests;
    const accountedFor =
      webhookStats.failed_validations +
      blockedAttempts.length +
      actualInQueue;
    const unaccounted = Math.max(0, totalReceived - accountedFor);

    if (unaccounted > 0) {
      discrepancyDetails.push(
        `${unaccounted} webhooks received but cannot be accounted for in validation failures, blocklist, or queue`
      );
    }

    const report: ReconciliationReport = {
      date,
      generated_at: new Date().toISOString(),

      webhooks: {
        total_received: webhookStats.total_requests,
        validation_passed: webhookStats.successful_validations,
        validation_failed: webhookStats.failed_validations,
      },

      processing: {
        blocklist_blocked: blockedAttempts.length,
        successfully_processed: webhookStats.successfully_processed,
        processing_failed: webhookStats.processing_failures,
      },

      breakdown: {
        in_redial_queue: inRedialQueue,
        completed_transferred: completedTransferred,
        completed_other: completedOther,
        daily_max_reached: dailyMaxReached,
        total_accounted: totalAccounted,
      },

      discrepancies: {
        missing_from_queue: missingFromQueue,
        unaccounted_webhooks: unaccounted,
        details: discrepancyDetails,
      },

      blocklist_impact: {
        total_blocked: blockedAttempts.length,
        by_phone: blocklistByPhone,
        by_lead_id: blocklistByLeadId,
        by_other: blocklistByOther,
      },
    };

    // Save report to disk
    await this.saveReport(date, report);

    logger.info("Reconciliation report generated", {
      date,
      total_webhooks: report.webhooks.total_received,
      discrepancies: report.discrepancies.unaccounted_webhooks,
    });

    return report;
  }

  /**
   * Save report to disk
   */
  private async saveReport(date: string, report: ReconciliationReport): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, `reconciliation_${date}.json`);
      const data = JSON.stringify(report, null, 2);
      fs.writeFileSync(filePath, data, "utf-8");

      logger.debug("Reconciliation report saved", { date, path: filePath });
    } catch (error: any) {
      logger.error("Failed to save reconciliation report", {
        error: error.message,
        date,
      });
    }
  }

  /**
   * Get saved report for a specific date
   */
  getReport(date: string): ReconciliationReport | null {
    try {
      const filePath = path.join(this.dataDir, `reconciliation_${date}.json`);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data) as ReconciliationReport;
    } catch (error: any) {
      logger.error("Failed to read reconciliation report", {
        error: error.message,
        date,
      });
      return null;
    }
  }

  /**
   * Generate report for today
   */
  async generateTodayReport(): Promise<ReconciliationReport> {
    const today = this.getCurrentDateEST();
    return this.generateReport(today);
  }

  /**
   * Get all available report dates
   */
  getAvailableReports(): string[] {
    try {
      const files = fs.readdirSync(this.dataDir);
      const dates: string[] = [];

      for (const file of files) {
        if (file.startsWith("reconciliation_") && file.endsWith(".json")) {
          // Extract date from filename: reconciliation_2026-01-05.json -> 2026-01-05
          const match = file.match(/reconciliation_(\d{4}-\d{2}-\d{2})\.json/);
          if (match && match[1]) {
            dates.push(match[1]);
          }
        }
      }

      return dates.sort().reverse(); // Most recent first
    } catch (error: any) {
      logger.error("Failed to get available reconciliation reports", {
        error: error.message,
      });
      return [];
    }
  }
}

export const reconciliationService = new ReconciliationService();
