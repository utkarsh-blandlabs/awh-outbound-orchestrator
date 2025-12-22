// ============================================================================
// SMS Tracker Service
// Limits SMS messages to max 1-2 per day per phone number
// Prevents SMS spam while allowing unlimited voicemail messages
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

interface SmsRecord {
  phone_number: string;
  sms_count: number;
  first_sms_timestamp: number;
  last_sms_timestamp: number;
  date: string; // YYYY-MM-DD in EST
}

interface SmsTrackerConfig {
  enabled: boolean;
  max_sms_per_day: number;
}

class SmsTrackerService {
  private records: Map<string, SmsRecord> = new Map();
  private dataDir: string;
  private currentDate: string;
  private config: SmsTrackerConfig;

  constructor() {
    this.dataDir = path.join(process.cwd(), "data", "sms-tracker");
    this.currentDate = this.getCurrentDateEST();

    // Load config from environment
    this.config = {
      enabled: process.env["SMS_TRACKER_ENABLED"] !== "false", // Enabled by default
      max_sms_per_day: parseInt(process.env["SMS_MAX_PER_DAY"] || "2"),
    };

    this.ensureDirectories();
    this.loadTodayRecords();

    logger.info("SMS tracker initialized", {
      enabled: this.config.enabled,
      max_per_day: this.config.max_sms_per_day,
    });
  }

  /**
   * Get current date in EST timezone (YYYY-MM-DD)
   */
  private getCurrentDateEST(): string {
    const now = new Date();
    const estOffset = -5 * 60; // EST is UTC-5
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const estTime = new Date(utc + estOffset * 60000);
    return estTime.toISOString().substring(0, 10); // YYYY-MM-DD
  }

  /**
   * Get current timestamp in EST
   */
  private getNowEST(): number {
    const now = new Date();
    const estOffset = -5 * 60;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    return utc + estOffset * 60000;
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info("Created sms-tracker directory", { path: this.dataDir });
    }
  }

  private getRecordFilePath(date: string): string {
    return path.join(this.dataDir, `sms-tracker_${date}.json`);
  }

  /**
   * Normalize phone number (remove non-digits)
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, "");
  }

  /**
   * Load records from today's file
   */
  private loadTodayRecords(): void {
    const filePath = this.getRecordFilePath(this.currentDate);

    if (!fs.existsSync(filePath)) {
      logger.info("No existing SMS tracker records for today", {
        date: this.currentDate,
      });
      return;
    }

    try {
      const data = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(data);

      this.records = new Map(Object.entries(parsed));

      logger.info("Loaded SMS tracker records", {
        date: this.currentDate,
        count: this.records.size,
      });
    } catch (error: any) {
      logger.error("Failed to load SMS tracker records", {
        error: error.message,
        date: this.currentDate,
      });
    }
  }

  /**
   * Save records to file
   */
  private async saveRecords(): Promise<void> {
    const filePath = this.getRecordFilePath(this.currentDate);

    try {
      // Convert Map to object for JSON
      const data: Record<string, SmsRecord> = {};
      this.records.forEach((value, key) => {
        data[key] = value;
      });

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

      logger.debug("Saved SMS tracker records", {
        date: this.currentDate,
        count: this.records.size,
      });
    } catch (error: any) {
      logger.error("Failed to save SMS tracker records", {
        error: error.message,
      });
    }
  }

  /**
   * Check if SMS can be sent to this phone number today
   * Returns true if under the limit, false if limit reached
   */
  canSendSms(phoneNumber: string): boolean {
    if (!this.config.enabled) {
      return true; // If tracker disabled, allow all SMS
    }

    // Check if date rolled over (new day)
    const today = this.getCurrentDateEST();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.records.clear();
      this.loadTodayRecords();
    }

    const normalized = this.normalizePhone(phoneNumber);
    const existing = this.records.get(normalized);

    if (!existing) {
      return true; // No SMS sent yet today
    }

    const canSend = existing.sms_count < this.config.max_sms_per_day;

    logger.debug("SMS send check", {
      phone: phoneNumber,
      sms_count: existing.sms_count,
      max: this.config.max_sms_per_day,
      can_send: canSend,
    });

    return canSend;
  }

  /**
   * Record that an SMS was sent to this phone number
   */
  async recordSmsSent(phoneNumber: string): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Check if date rolled over
    const today = this.getCurrentDateEST();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.records.clear();
      this.loadTodayRecords();
    }

    const normalized = this.normalizePhone(phoneNumber);
    const now = this.getNowEST();
    const existing = this.records.get(normalized);

    if (existing) {
      existing.sms_count += 1;
      existing.last_sms_timestamp = now;
    } else {
      this.records.set(normalized, {
        phone_number: normalized,
        sms_count: 1,
        first_sms_timestamp: now,
        last_sms_timestamp: now,
        date: this.currentDate,
      });
    }

    await this.saveRecords();

    logger.info("Recorded SMS sent", {
      phone: phoneNumber,
      count: existing ? existing.sms_count : 1,
      max: this.config.max_sms_per_day,
    });
  }

  /**
   * Get SMS count for a phone number today
   */
  getSmsCount(phoneNumber: string): number {
    // Check if date rolled over
    const today = this.getCurrentDateEST();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.records.clear();
      this.loadTodayRecords();
    }

    const normalized = this.normalizePhone(phoneNumber);
    const existing = this.records.get(normalized);

    return existing ? existing.sms_count : 0;
  }

  /**
   * Get all records for today
   */
  getAllRecords(): SmsRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Get config
   */
  getConfig(): SmsTrackerConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<SmsTrackerConfig>): SmsTrackerConfig {
    this.config = { ...this.config, ...updates };
    logger.info("SMS tracker config updated", { updates });
    return this.getConfig();
  }

  /**
   * Clean up old files (older than 7 days)
   */
  async cleanupOldFiles(): Promise<void> {
    try {
      const files = fs.readdirSync(this.dataDir);
      const now = Date.now();
      const retentionMs = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const file of files) {
        if (file.startsWith("sms-tracker_") && file.endsWith(".json")) {
          const filePath = path.join(this.dataDir, file);
          const stats = fs.statSync(filePath);
          const fileAge = now - stats.mtimeMs;

          if (fileAge > retentionMs) {
            fs.unlinkSync(filePath);
            logger.info("Deleted old SMS tracker file", {
              file,
              age_days: Math.floor(fileAge / (24 * 60 * 60 * 1000)),
            });
          }
        }
      }
    } catch (error: any) {
      logger.error("Failed to cleanup old SMS tracker files", {
        error: error.message,
      });
    }
  }
}

export const smsTrackerService = new SmsTrackerService();
