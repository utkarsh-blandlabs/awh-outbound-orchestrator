/**
 * Webhook Logger Service
 * Logs all incoming webhook requests to identify missing leads and debug issues
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

interface WebhookLogEntry {
  timestamp: number;
  request_id: string;
  phone_number: string;
  lead_id: string;
  list_id: string;
  first_name?: string;
  last_name?: string;
  state?: string;
  validation_result: "success" | "failed";
  validation_error?: string;
  blocklist_result?: "allowed" | "blocked";
  blocklist_reason?: string;
  processing_result?: "queued" | "failed";
  processing_error?: string;
  date: string; // "YYYY-MM-DD" format for easy querying
}

interface WebhookLogStats {
  total_requests: number;
  successful_validations: number;
  failed_validations: number;
  blocked_by_blocklist: number;
  successfully_processed: number;
  processing_failures: number;
}

class WebhookLoggerService {
  private dataDir: string;
  private currentDate: string;
  private logs: Map<string, WebhookLogEntry>;
  private enabled: boolean;

  constructor() {
    this.dataDir = path.join(__dirname, "../../data/webhook-logs");
    this.currentDate = this.getCurrentDateEST();
    this.logs = new Map();
    this.enabled = process.env["WEBHOOK_LOGGING_ENABLED"] !== "false"; // Enabled by default

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.loadTodayLogs();
    logger.info("Webhook logger initialized", { enabled: this.enabled });
  }

  /**
   * Get current date in EST timezone (YYYY-MM-DD format)
   */
  private getCurrentDateEST(): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    // en-CA locale returns YYYY-MM-DD format directly, no need to split
    return dateStr;
  }

  /**
   * Load today's logs from disk
   */
  private loadTodayLogs(): void {
    if (!this.enabled) return;

    try {
      const filePath = this.getFilePath(this.currentDate);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(data);
        this.logs = new Map(Object.entries<WebhookLogEntry>(parsed));
        logger.info("Loaded webhook logs for today", {
          date: this.currentDate,
          count: this.logs.size,
        });
      }
    } catch (error: any) {
      logger.error("Failed to load webhook logs", {
        error: error.message,
        date: this.currentDate,
      });
    }
  }

  /**
   * Save logs to disk
   */
  private async saveLogs(): Promise<void> {
    if (!this.enabled) return;

    try {
      const filePath = this.getFilePath(this.currentDate);
      const data = JSON.stringify(Object.fromEntries(this.logs), null, 2);
      fs.writeFileSync(filePath, data, "utf-8");
    } catch (error: any) {
      logger.error("Failed to save webhook logs", {
        error: error.message,
        date: this.currentDate,
      });
    }
  }

  /**
   * Get file path for a specific date
   */
  private getFilePath(date: string): string {
    return path.join(this.dataDir, `webhook-logs_${date}.json`);
  }

  /**
   * Log a webhook request
   */
  async logRequest(
    requestId: string,
    phoneNumber: string,
    leadId: string,
    listId: string,
    firstName?: string,
    lastName?: string,
    state?: string
  ): Promise<void> {
    if (!this.enabled) return;

    const today = this.getCurrentDateEST();

    // Check if date changed (new day)
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.logs.clear();
      this.loadTodayLogs();
    }

    const entry: WebhookLogEntry = {
      timestamp: Date.now(),
      request_id: requestId,
      phone_number: phoneNumber,
      lead_id: leadId,
      list_id: listId,
      first_name: firstName,
      last_name: lastName,
      state,
      validation_result: "success",
      date: today,
    };

    this.logs.set(requestId, entry);
    await this.saveLogs();
  }

  /**
   * Update request with validation failure
   */
  async logValidationFailure(
    requestId: string,
    error: string
  ): Promise<void> {
    if (!this.enabled) return;

    const entry = this.logs.get(requestId);
    if (entry) {
      entry.validation_result = "failed";
      entry.validation_error = error;
      await this.saveLogs();
    }
  }

  /**
   * Update request with blocklist result
   */
  async logBlocklistResult(
    requestId: string,
    blocked: boolean,
    reason?: string
  ): Promise<void> {
    if (!this.enabled) return;

    const entry = this.logs.get(requestId);
    if (entry) {
      entry.blocklist_result = blocked ? "blocked" : "allowed";
      if (reason) {
        entry.blocklist_reason = reason;
      }
      await this.saveLogs();
    }
  }

  /**
   * Update request with processing result
   */
  async logProcessingResult(
    requestId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    if (!this.enabled) return;

    const entry = this.logs.get(requestId);
    if (entry) {
      entry.processing_result = success ? "queued" : "failed";
      if (error) {
        entry.processing_error = error;
      }
      await this.saveLogs();
    }
  }

  /**
   * Get logs for a specific date
   */
  getLogsByDate(date: string): WebhookLogEntry[] {
    try {
      const filePath = this.getFilePath(date);
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const data = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(data);
      return Object.values<WebhookLogEntry>(parsed);
    } catch (error: any) {
      logger.error("Failed to get webhook logs by date", {
        error: error.message,
        date,
      });
      return [];
    }
  }

  /**
   * Get today's logs
   */
  getTodayLogs(): WebhookLogEntry[] {
    return Array.from(this.logs.values());
  }

  /**
   * Get stats for a specific date
   */
  getStatsByDate(date: string): WebhookLogStats {
    const logs = this.getLogsByDate(date);

    return {
      total_requests: logs.length,
      successful_validations: logs.filter((l) => l.validation_result === "success").length,
      failed_validations: logs.filter((l) => l.validation_result === "failed").length,
      blocked_by_blocklist: logs.filter((l) => l.blocklist_result === "blocked").length,
      successfully_processed: logs.filter((l) => l.processing_result === "queued").length,
      processing_failures: logs.filter((l) => l.processing_result === "failed").length,
    };
  }

  /**
   * Get stats for today
   */
  getTodayStats(): WebhookLogStats {
    return this.getStatsByDate(this.currentDate);
  }

  /**
   * Search logs by phone number across all dates
   */
  searchByPhone(phoneNumber: string): WebhookLogEntry[] {
    const results: WebhookLogEntry[] = [];

    try {
      const files = fs.readdirSync(this.dataDir);

      for (const file of files) {
        if (!file.startsWith("webhook-logs_") || !file.endsWith(".json")) {
          continue;
        }

        const filePath = path.join(this.dataDir, file);
        const data = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(data);

        for (const entry of Object.values<WebhookLogEntry>(parsed)) {
          if (entry.phone_number === phoneNumber) {
            results.push(entry);
          }
        }
      }
    } catch (error: any) {
      logger.error("Failed to search webhook logs by phone", {
        error: error.message,
        phone: phoneNumber,
      });
    }

    return results;
  }

  /**
   * Search logs by lead_id across all dates
   */
  searchByLeadId(leadId: string): WebhookLogEntry[] {
    const results: WebhookLogEntry[] = [];

    try {
      const files = fs.readdirSync(this.dataDir);

      for (const file of files) {
        if (!file.startsWith("webhook-logs_") || !file.endsWith(".json")) {
          continue;
        }

        const filePath = path.join(this.dataDir, file);
        const data = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(data);

        for (const entry of Object.values<WebhookLogEntry>(parsed)) {
          if (entry.lead_id === leadId) {
            results.push(entry);
          }
        }
      }
    } catch (error: any) {
      logger.error("Failed to search webhook logs by lead_id", {
        error: error.message,
        lead_id: leadId,
      });
    }

    return results;
  }
}

export const webhookLogger = new WebhookLoggerService();
