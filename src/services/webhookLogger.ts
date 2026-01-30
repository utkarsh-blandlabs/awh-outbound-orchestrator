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
  private maxLogsInMemory: number = 10000; // Limit memory usage
  private lastSaveTime: number = 0;
  private saveIntervalMs: number = 60000; // Save every 60 seconds instead of every request
  private flushIntervalId: NodeJS.Timeout | null = null; // MEMORY LEAK FIX: Store interval ID

  constructor() {
    this.dataDir = path.join(__dirname, "../../data/webhook-logs");
    this.currentDate = this.getCurrentDateEST();
    this.logs = new Map();
    this.enabled = process.env["WEBHOOK_LOGGING_ENABLED"] !== "false"; // Enabled by default

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.loadTodayLogs();
    logger.info("Webhook logger initialized", {
      enabled: this.enabled,
      maxLogsInMemory: this.maxLogsInMemory,
    });

    // Periodic save to reduce write frequency
    // MEMORY LEAK FIX: Store interval ID so it can be cleared on shutdown
    if (this.enabled) {
      this.flushIntervalId = setInterval(() => this.flushToDisk(), this.saveIntervalMs);
    }
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
   * Only load if under memory limit to prevent memory bloat
   */
  private loadTodayLogs(): void {
    if (!this.enabled) return;

    try {
      const filePath = this.getFilePath(this.currentDate);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(data);
        const entries = Object.entries<WebhookLogEntry>(parsed);

        // Only load recent entries to limit memory usage
        if (entries.length > this.maxLogsInMemory) {
          // Keep only the most recent entries
          const recentEntries = entries
            .sort((a, b) => b[1].timestamp - a[1].timestamp)
            .slice(0, this.maxLogsInMemory);
          this.logs = new Map(recentEntries);
          logger.warn("Loaded only recent webhook logs (memory limit)", {
            date: this.currentDate,
            total_on_disk: entries.length,
            loaded_in_memory: this.logs.size,
            max_limit: this.maxLogsInMemory,
          });
        } else {
          this.logs = new Map(entries);
          logger.info("Loaded webhook logs for today", {
            date: this.currentDate,
            count: this.logs.size,
          });
        }
      }
    } catch (error: any) {
      logger.error("Failed to load webhook logs", {
        error: error.message,
        date: this.currentDate,
      });
    }
  }

  /**
   * Save logs to disk (batched, called periodically)
   */
  private flushToDisk(): void {
    if (!this.enabled || this.logs.size === 0) return;

    try {
      const filePath = this.getFilePath(this.currentDate);

      // Read existing data from disk to merge with memory
      let existingData: Record<string, WebhookLogEntry> = {};
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        existingData = JSON.parse(data);
      }

      // Merge memory logs with disk logs
      const mergedData = { ...existingData, ...Object.fromEntries(this.logs) };

      // Write merged data
      fs.writeFileSync(filePath, JSON.stringify(mergedData, null, 2), "utf-8");
      this.lastSaveTime = Date.now();
    } catch (error: any) {
      logger.error("Failed to flush webhook logs to disk", {
        error: error.message,
        date: this.currentDate,
      });
    }
  }

  /**
   * Immediate save (for critical updates only)
   */
  private async saveLogs(): Promise<void> {
    // Just set a flag that data needs saving, actual save happens in flushToDisk
    // This reduces disk I/O dramatically
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
      this.flushToDisk(); // Save before clearing
      this.currentDate = today;
      this.logs.clear();
      this.loadTodayLogs();
    }

    // Enforce memory limit - remove oldest entries if needed
    if (this.logs.size >= this.maxLogsInMemory) {
      // Remove 10% oldest entries to make room
      const entriesToRemove = Math.floor(this.maxLogsInMemory * 0.1);
      const sortedEntries = Array.from(this.logs.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      for (let i = 0; i < entriesToRemove && i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        if (entry) {
          this.logs.delete(entry[0]);
        }
      }

      logger.debug("Removed old webhook logs to stay under memory limit", {
        removed: entriesToRemove,
        remaining: this.logs.size,
      });
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
    // Don't save immediately - batched saves happen every 60 seconds
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
      // Batched saves every 60 seconds
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
      // Batched saves every 60 seconds
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
      // Batched saves every 60 seconds
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

  /**
   * MEMORY LEAK FIX: Stop the periodic flush interval
   * Called during graceful shutdown to prevent memory leaks
   */
  stop(): void {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
      logger.info("Webhook logger flush interval stopped");
    }

    // Flush any remaining logs to disk before shutdown
    this.flushToDisk();
  }
}

export const webhookLogger = new WebhookLoggerService();
