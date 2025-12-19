// ============================================================================
// Answering Machine Tracker Service
// Tracks call attempts for leads with specific statuses (voicemail, no answer, etc.)
// Key: lead_id + phone_number (different from dailyCallTracker which uses phone only)
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { config } from "../config";

interface AMAttemptRecord {
  lead_id: string;
  phone_number: string;
  attempts: number;
  first_attempt_timestamp: number;
  last_attempt_timestamp: number;
  statuses_encountered: string[];
}

interface AMTrackerConfig {
  enabled: boolean;
  tracked_statuses: string[]; // Configurable list: ["VOICEMAIL", "NO_ANSWER", "new", ""]
  max_attempts_per_lead: number;
  flush_hour_est: number; // Hour in EST when to flush data (20 = 8 PM)
}

interface AMDecision {
  allow: boolean;
  reason?: string;
  current_attempts?: number;
  max_attempts?: number;
}

class AnsweringMachineTrackerService {
  private records: Map<string, AMAttemptRecord> = new Map();
  private trackerConfig: AMTrackerConfig;
  private dataDir: string;
  private currentDate: string;

  constructor() {
    this.dataDir = path.join(process.cwd(), "data", "am-tracker");
    this.currentDate = this.getTodayDateEST();

    // Load config from environment variables
    this.trackerConfig = {
      enabled: config.answeringMachineTracker.enabled,
      tracked_statuses: config.answeringMachineTracker.trackedStatuses,
      max_attempts_per_lead: config.answeringMachineTracker.maxAttemptsPerLead,
      flush_hour_est: config.answeringMachineTracker.flushHourEST,
    };

    this.ensureDirectories();
    this.loadTodayRecords();
    this.scheduleFlush();

    logger.info("AM tracker initialized", {
      enabled: this.trackerConfig.enabled,
      max_attempts: this.trackerConfig.max_attempts_per_lead,
      tracked_statuses: this.trackerConfig.tracked_statuses,
    });
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info("Created am-tracker directory", { path: this.dataDir });
    }
  }

  /**
   * Get current date in EST timezone (YYYY-MM-DD)
   */
  private getTodayDateEST(): string {
    const now = new Date();
    // Convert to EST (UTC-5)
    const estOffset = -5 * 60; // EST is UTC-5
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const estTime = new Date(utc + estOffset * 60000);
    return estTime.toISOString().split("T")[0] || "";
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

  private getRecordFilePath(date: string): string {
    return path.join(this.dataDir, `am-calls_${date}.json`);
  }

  /**
   * Generate unique key from lead_id + phone_number
   */
  private generateKey(leadId: string, phoneNumber: string): string {
    const normalizedPhone = this.normalizePhone(phoneNumber);
    return `${leadId}_${normalizedPhone}`;
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");

    if (digits.startsWith("1") && digits.length === 11) {
      return `+${digits}`;
    }

    if (digits.length === 10) {
      return `+1${digits}`;
    }

    if (digits.length > 10) {
      return `+${digits}`;
    }

    return `+${digits}`;
  }


  /**
   * Load today's records from file
   */
  private loadTodayRecords(): void {
    try {
      const filePath = this.getRecordFilePath(this.currentDate);

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        const recordsArray: AMAttemptRecord[] = JSON.parse(data);

        this.records.clear();
        recordsArray.forEach((record) => {
          const key = this.generateKey(record.lead_id, record.phone_number);
          this.records.set(key, record);
        });

        logger.info("AM tracker records loaded", {
          date: this.currentDate,
          count: this.records.size,
        });
      } else {
        logger.info("No existing AM tracker records for today", {
          date: this.currentDate,
        });
      }
    } catch (error: any) {
      logger.error("Failed to load AM tracker records", {
        error: error.message,
      });
      this.records.clear();
    }
  }

  /**
   * Save records to file
   */
  private saveRecords(): void {
    try {
      const filePath = this.getRecordFilePath(this.currentDate);
      const recordsArray = Array.from(this.records.values());
      fs.writeFileSync(filePath, JSON.stringify(recordsArray, null, 2));
      logger.debug("AM tracker records saved", { count: recordsArray.length });
    } catch (error: any) {
      logger.error("Failed to save AM tracker records", {
        error: error.message,
      });
    }
  }

  /**
   * Check if we need to rotate to new day (EST timezone)
   */
  private checkDateRotation(): void {
    const today = this.getTodayDateEST();
    if (today !== this.currentDate) {
      logger.info("Date changed (EST), rotating AM tracker records", {
        old_date: this.currentDate,
        new_date: today,
      });
      this.currentDate = today;
      this.records.clear();
      this.loadTodayRecords();
    }
  }

  /**
   * Check if a status should be tracked
   */
  private shouldTrackStatus(status: string | undefined): boolean {
    if (!this.trackerConfig.enabled) {
      return false;
    }

    const normalizedStatus = (status || "").toLowerCase().trim();

    return this.trackerConfig.tracked_statuses.some((trackedStatus) => {
      const normalizedTracked = trackedStatus.toLowerCase().trim();
      return normalizedStatus === normalizedTracked;
    });
  }

  /**
   * Check if call should be allowed for this lead_id + phone combination
   * Call this BEFORE making the call
   */
  shouldAllowCall(
    leadId: string,
    phoneNumber: string,
    currentStatus?: string
  ): AMDecision {
    this.checkDateRotation();

    if (!this.trackerConfig.enabled) {
      return { allow: true };
    }

    // Only check if this is a tracked status
    if (!this.shouldTrackStatus(currentStatus)) {
      return { allow: true };
    }

    const key = this.generateKey(leadId, phoneNumber);
    const record = this.records.get(key);

    if (!record) {
      // No previous attempts for this lead_id + phone combo
      return { allow: true };
    }

    // Check if max attempts reached
    if (record.attempts >= this.trackerConfig.max_attempts_per_lead) {
      return {
        allow: false,
        reason: `Max attempts reached for this lead (${record.attempts}/${this.trackerConfig.max_attempts_per_lead})`,
        current_attempts: record.attempts,
        max_attempts: this.trackerConfig.max_attempts_per_lead,
      };
    }

    return {
      allow: true,
      current_attempts: record.attempts,
      max_attempts: this.trackerConfig.max_attempts_per_lead,
    };
  }

  /**
   * Record a call attempt
   * Call this AFTER the call completes with the outcome
   */
  recordAttempt(
    leadId: string,
    phoneNumber: string,
    status: string,
    callId: string
  ): void {
    this.checkDateRotation();

    if (!this.trackerConfig.enabled) {
      return;
    }

    // Only record if this is a tracked status
    if (!this.shouldTrackStatus(status)) {
      logger.debug("Status not tracked, skipping AM tracker record", {
        status,
        lead_id: leadId,
      });
      return;
    }

    const key = this.generateKey(leadId, phoneNumber);
    const now = this.getNowEST();

    const existing = this.records.get(key);

    if (existing) {
      // Increment existing record
      existing.attempts += 1;
      existing.last_attempt_timestamp = now;
      if (!existing.statuses_encountered.includes(status)) {
        existing.statuses_encountered.push(status);
      }

      logger.info("AM tracker: Updated attempt record", {
        lead_id: leadId,
        phone: phoneNumber,
        attempts: existing.attempts,
        max: this.trackerConfig.max_attempts_per_lead,
        status,
        call_id: callId,
      });
    } else {
      // Create new record
      const newRecord: AMAttemptRecord = {
        lead_id: leadId,
        phone_number: this.normalizePhone(phoneNumber),
        attempts: 1,
        first_attempt_timestamp: now,
        last_attempt_timestamp: now,
        statuses_encountered: [status],
      };

      this.records.set(key, newRecord);

      logger.info("AM tracker: Created new attempt record", {
        lead_id: leadId,
        phone: phoneNumber,
        attempts: 1,
        max: this.trackerConfig.max_attempts_per_lead,
        status,
        call_id: callId,
      });
    }

    this.saveRecords();
  }

  /**
   * Schedule automatic flush at configured hour (EST)
   * Supports decimal hours (e.g., 20.5 = 8:30 PM)
   */
  private scheduleFlush(): void {
    // Check every 30 minutes if it's time to flush
    setInterval(() => {
      const now = new Date();
      const estOffset = -5 * 60;
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const estTime = new Date(utc + estOffset * 60000);
      const currentHourEST = estTime.getHours();
      const currentMinuteEST = estTime.getMinutes();

      // Parse decimal hour (e.g., 20.5 = 8:30 PM)
      const targetHour = Math.floor(this.trackerConfig.flush_hour_est);
      const targetMinute = Math.round((this.trackerConfig.flush_hour_est % 1) * 60);

      // Check if current time matches or passed flush time
      if (
        currentHourEST === targetHour &&
        currentMinuteEST >= targetMinute &&
        currentMinuteEST < targetMinute + 30
      ) {
        this.flushOldRecords();
      }
    }, 30 * 60 * 1000); // Check every 30 minutes
  }

  /**
   * Flush old records (older than today)
   */
  private flushOldRecords(): void {
    try {
      const files = fs.readdirSync(this.dataDir);
      const today = this.getTodayDateEST();

      files.forEach((file) => {
        if (file.startsWith("am-calls_") && file.endsWith(".json")) {
          const dateMatch = file.match(/am-calls_(\d{4}-\d{2}-\d{2})\.json/);
          if (dateMatch && dateMatch[1] !== today) {
            const filePath = path.join(this.dataDir, file);
            fs.unlinkSync(filePath);
            logger.info("Flushed old AM tracker file", {
              file,
              date: dateMatch[1],
            });
          }
        }
      });
    } catch (error: any) {
      logger.error("Failed to flush old AM tracker records", {
        error: error.message,
      });
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): AMTrackerConfig {
    return { ...this.trackerConfig };
  }

  /**
   * Update configuration (runtime updates)
   */
  updateConfig(updates: Partial<AMTrackerConfig>): AMTrackerConfig {
    this.trackerConfig = { ...this.trackerConfig, ...updates };
    logger.info("AM tracker config updated", { updates });
    return this.getConfig();
  }

  /**
   * Get statistics
   */
  getStats(): {
    enabled: boolean;
    total_tracked_leads: number;
    leads_at_max: number;
    tracked_statuses: string[];
    max_attempts: number;
    current_date_est: string;
  } {
    this.checkDateRotation();

    const leadsAtMax = Array.from(this.records.values()).filter(
      (r) => r.attempts >= this.trackerConfig.max_attempts_per_lead
    ).length;

    return {
      enabled: this.trackerConfig.enabled,
      total_tracked_leads: this.records.size,
      leads_at_max: leadsAtMax,
      tracked_statuses: this.trackerConfig.tracked_statuses,
      max_attempts: this.trackerConfig.max_attempts_per_lead,
      current_date_est: this.currentDate,
    };
  }

  /**
   * Get all records (for debugging/admin)
   */
  getAllRecords(): AMAttemptRecord[] {
    this.checkDateRotation();
    return Array.from(this.records.values());
  }

  /**
   * Clear all records (for testing)
   */
  clearAll(): void {
    this.records.clear();
    this.saveRecords();
    logger.info("AM tracker records cleared");
  }

  /**
   * Enable/disable tracking
   */
  setEnabled(enabled: boolean): void {
    this.trackerConfig.enabled = enabled;
    logger.info(`AM tracker ${enabled ? "enabled" : "disabled"}`);
  }
}

export const answeringMachineTracker = new AnsweringMachineTrackerService();
