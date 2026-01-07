/**
 * Failed Convoso Update Logger
 *
 * Logs all failed Convoso updates with full lead data for later backfill.
 * These can be backfilled manually or automatically at end of day.
 */

import * as fs from "fs";
import * as path from "path";
import { BlandTranscript } from "../types/awh";
import { logger } from "../utils/logger";

interface FailedConvosoUpdate {
  timestamp: number;
  date: string; // YYYY-MM-DD
  lead_id: string;
  list_id: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  state: string;
  call_id: string;
  outcome: string;
  status: string; // Convoso status code
  duration: number;
  error: string;
  transcript_data: BlandTranscript; // Full transcript for reference
}

class FailedConvosoLogger {
  private dataDir: string;
  private currentDate: string;

  constructor() {
    this.dataDir = path.join(__dirname, "../../data/failed-convoso-updates");
    this.currentDate = this.getCurrentDateEST();
    this.ensureDataDir();
  }

  /**
   * Get current date in EST (YYYY-MM-DD)
   */
  private getCurrentDateEST(): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date()); // Returns YYYY-MM-DD
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Get file path for current date
   */
  private getFilePath(): string {
    return path.join(this.dataDir, `${this.currentDate}.json`);
  }

  /**
   * Load existing failed updates for today
   */
  private loadTodaysFailed(): FailedConvosoUpdate[] {
    const filePath = this.getFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error: any) {
      logger.error("Failed to load failed Convoso updates", {
        error: error.message,
        file: filePath,
      });
      return [];
    }
  }

  /**
   * Save failed updates
   */
  private saveFailed(updates: FailedConvosoUpdate[]): void {
    const filePath = this.getFilePath();
    try {
      fs.writeFileSync(filePath, JSON.stringify(updates, null, 2));
    } catch (error: any) {
      logger.error("Failed to save failed Convoso updates", {
        error: error.message,
        file: filePath,
      });
    }
  }

  /**
   * Log a failed Convoso update
   */
  logFailedUpdate(
    leadId: string,
    listId: string,
    phoneNumber: string,
    transcript: BlandTranscript,
    convosoStatus: string,
    error: string
  ): void {
    const failedUpdate: FailedConvosoUpdate = {
      timestamp: Date.now(),
      date: this.currentDate,
      lead_id: leadId,
      list_id: listId,
      phone_number: phoneNumber,
      first_name: transcript.first_name || "",
      last_name: transcript.last_name || "",
      state: transcript.state || transcript.customer_state || "",
      call_id: transcript.call_id,
      outcome: transcript.outcome,
      status: convosoStatus,
      duration: transcript.duration || 0,
      error,
      transcript_data: transcript,
    };

    const updates = this.loadTodaysFailed();
    updates.push(failedUpdate);
    this.saveFailed(updates);

    logger.info("Failed Convoso update logged for backfill", {
      lead_id: leadId,
      phone: phoneNumber,
      call_id: transcript.call_id,
      outcome: transcript.outcome,
      total_failed_today: updates.length,
    });
  }

  /**
   * Get count of failed updates for today
   */
  getFailedCount(): number {
    return this.loadTodaysFailed().length;
  }

  /**
   * Get all failed updates for a specific date
   */
  getFailedForDate(date: string): FailedConvosoUpdate[] {
    const filePath = path.join(this.dataDir, `${date}.json`);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error: any) {
      logger.error("Failed to load failed updates for date", {
        date,
        error: error.message,
      });
      return [];
    }
  }
}

// Export singleton instance
export const failedConvosoLogger = new FailedConvosoLogger();
