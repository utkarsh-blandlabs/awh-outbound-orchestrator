// ============================================================================
// Daily Call Tracker Service
// Tracks all calls per phone number to prevent duplicates and status conflicts
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { CallOutcome } from "../types/awh";

interface CallAttempt {
  call_id: string;
  lead_id: string;
  request_id: string;
  timestamp: number;
  status: "active" | "completed" | "failed";
  outcome?: CallOutcome;
  answered_by?: string;
  duration?: number;
}

interface DailyCallRecord {
  phone_number: string; // Normalized phone
  lead_ids: string[]; // All lead IDs for this number today
  calls: CallAttempt[]; // All call attempts today
  active_call_id: string | null; // Currently active call (if any)
  final_outcome: CallOutcome | null;
  last_call_timestamp: number;
  blocked: boolean; // Manual block flag
  blocked_reason?: string;
  failed_call_error: boolean; // Auto-blocked for today due to "Call failed" error
  failed_call_error_message?: string; // Error message from Bland AI
}

interface ProtectionConfig {
  enabled: boolean;
  rules: {
    block_on_transferred: boolean;
    block_on_sold: boolean;
    block_on_not_interested: boolean;
    allow_voicemail_retry: boolean;
    allow_no_answer_retry: boolean;
  };
  duplicate_window_minutes: number;
  max_daily_attempts_per_number: number;
  allow_different_lead_ids: boolean;
}

interface CallDecision {
  allow: boolean;
  reason?: string;
  action: "proceed" | "block" | "queue";
}

class DailyCallTrackerService {
  private records: Map<string, DailyCallRecord> = new Map();
  private config!: ProtectionConfig;
  private configPath: string;
  private dataDir: string;
  private currentDate: string;

  constructor() {
    this.configPath = path.join(
      process.cwd(),
      "data",
      "call-protection-config.json"
    );
    this.dataDir = path.join(process.cwd(), "data", "daily-calls");
    this.currentDate = this.getTodayDate();
    this.ensureDirectories();
    this.loadConfig();
    this.loadTodayRecords();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info("Created daily-calls directory", { path: this.dataDir });
    }
  }

  private getTodayDate(): string {
    // Use EST timezone for date rotation (not UTC)
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date()); // Returns YYYY-MM-DD in EST
  }

  private getRecordFilePath(date: string): string {
    return path.join(this.dataDir, `calls_${date}.json`);
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhone(phone: string): string {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, "");

    // If it starts with 1 and is 11 digits, it's already E.164 format
    if (digits.startsWith("1") && digits.length === 11) {
      return `+${digits}`;
    }

    // If it's 10 digits, add +1 prefix
    if (digits.length === 10) {
      return `+1${digits}`;
    }

    // If it already has country code
    if (digits.length > 10) {
      return `+${digits}`;
    }

    // Default: return with + prefix
    return `+${digits}`;
  }

  /**
   * Load protection configuration
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf-8");
        this.config = JSON.parse(data);
        logger.info("Call protection config loaded", this.config);
      } else {
        // Default configuration
        this.config = {
          enabled: true,
          rules: {
            block_on_transferred: true,
            block_on_sold: true,
            block_on_not_interested: true,
            allow_voicemail_retry: true,
            allow_no_answer_retry: true,
          },
          duplicate_window_minutes: 10,
          max_daily_attempts_per_number: 3,
          allow_different_lead_ids: false,
        };
        this.saveConfig();
        logger.info("Call protection config initialized with defaults");
      }
    } catch (error: any) {
      logger.error("Failed to load call protection config", {
        error: error.message,
      });
      // Use defaults on error
      this.config = {
        enabled: true,
        rules: {
          block_on_transferred: true,
          block_on_sold: true,
          block_on_not_interested: true,
          allow_voicemail_retry: true,
          allow_no_answer_retry: true,
        },
        duplicate_window_minutes: 10,
        max_daily_attempts_per_number: 3,
        allow_different_lead_ids: false,
      };
    }
  }

  /**
   * Save configuration to file
   */
  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2)
      );
      logger.info("Call protection config saved");
    } catch (error: any) {
      logger.error("Failed to save call protection config", {
        error: error.message,
      });
    }
  }

  /**
   * Load today's records from file
   */
  private loadTodayRecords(): void {
    try {
      const filePath = this.getRecordFilePath(this.currentDate);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        const records = JSON.parse(data) as DailyCallRecord[];

        this.records.clear();
        for (const record of records) {
          this.records.set(record.phone_number, record);
        }

        logger.info("Daily call records loaded", {
          date: this.currentDate,
          count: this.records.size,
        });
      } else {
        logger.info("No existing records for today", { date: this.currentDate });
      }
    } catch (error: any) {
      logger.error("Failed to load daily call records", {
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
    } catch (error: any) {
      logger.error("Failed to save daily call records", {
        error: error.message,
      });
    }
  }

  /**
   * Check if we need to rotate to new day
   */
  private checkDateRotation(): void {
    const today = this.getTodayDate();
    if (today !== this.currentDate) {
      logger.info("Date changed, rotating call records", {
        old_date: this.currentDate,
        new_date: today,
      });
      this.currentDate = today;
      this.records.clear();
      this.loadTodayRecords();
    }
  }

  /**
   * Get or create record for phone number
   */
  private getOrCreateRecord(phoneNumber: string): DailyCallRecord {
    const normalized = this.normalizePhone(phoneNumber);

    if (!this.records.has(normalized)) {
      const record: DailyCallRecord = {
        phone_number: normalized,
        lead_ids: [],
        calls: [],
        active_call_id: null,
        final_outcome: null,
        last_call_timestamp: 0,
        blocked: false,
        failed_call_error: false,
      };
      this.records.set(normalized, record);
    }

    return this.records.get(normalized)!;
  }

  /**
   * Check if call should be allowed (main decision logic)
   */
  shouldAllowCall(phoneNumber: string, leadId: string): CallDecision {
    this.checkDateRotation();

    if (!this.config.enabled) {
      return { allow: true, action: "proceed" };
    }

    const normalized = this.normalizePhone(phoneNumber);
    const record = this.records.get(normalized);

    // No previous calls - allow
    if (!record) {
      return { allow: true, action: "proceed" };
    }

    // Manual block check
    if (record.blocked) {
      return {
        allow: false,
        action: "block",
        reason: record.blocked_reason || "Number manually blocked",
      };
    }

    // Failed call error check (auto-blocked for today only)
    if (record.failed_call_error) {
      return {
        allow: false,
        action: "block",
        reason: `Blocked for today due to call failure: ${record.failed_call_error_message || "Call failed"}`,
      };
    }

    // Active call check - queue if another call is in progress
    if (record.active_call_id) {
      return {
        allow: false,
        action: "queue",
        reason: `Active call in progress (${record.active_call_id})`,
      };
    }

    // Check max daily attempts
    if (record.calls.length >= this.config.max_daily_attempts_per_number) {
      return {
        allow: false,
        action: "block",
        reason: `Max daily attempts reached (${this.config.max_daily_attempts_per_number})`,
      };
    }

    // Check duplicate request within time window
    const now = Date.now();
    const windowMs = this.config.duplicate_window_minutes * 60 * 1000;
    const recentCall = record.calls.find(
      (call) =>
        call.lead_id === leadId &&
        now - call.timestamp < windowMs
    );

    if (recentCall) {
      return {
        allow: false,
        action: "block",
        reason: `Duplicate request detected (within ${this.config.duplicate_window_minutes} min)`,
      };
    }

    // Check terminal status rules
    if (record.final_outcome) {
      // Block on TRANSFERRED
      if (
        this.config.rules.block_on_transferred &&
        record.final_outcome === CallOutcome.TRANSFERRED
      ) {
        return {
          allow: false,
          action: "block",
          reason: "Lead already transferred to licensed agent",
        };
      }

      // Block on NOT_INTERESTED
      if (
        this.config.rules.block_on_not_interested &&
        record.final_outcome === CallOutcome.NOT_INTERESTED
      ) {
        return {
          allow: false,
          action: "block",
          reason: "Lead requested no further contact",
        };
      }

      // Allow retry for VOICEMAIL if configured
      if (
        !this.config.rules.allow_voicemail_retry &&
        record.final_outcome === CallOutcome.VOICEMAIL
      ) {
        return {
          allow: false,
          action: "block",
          reason: "Voicemail retry not allowed",
        };
      }

      // Allow retry for NO_ANSWER if configured
      if (
        !this.config.rules.allow_no_answer_retry &&
        record.final_outcome === CallOutcome.NO_ANSWER
      ) {
        return {
          allow: false,
          action: "block",
          reason: "No-answer retry not allowed",
        };
      }
    }

    // All checks passed
    return { allow: true, action: "proceed" };
  }

  /**
   * Record when call starts
   */
  recordCallStart(
    phoneNumber: string,
    leadId: string,
    callId: string,
    requestId: string
  ): void {
    this.checkDateRotation();

    const record = this.getOrCreateRecord(phoneNumber);

    // Add lead_id if not already tracked
    if (!record.lead_ids.includes(leadId)) {
      record.lead_ids.push(leadId);
    }

    // Create call attempt
    const attempt: CallAttempt = {
      call_id: callId,
      lead_id: leadId,
      request_id: requestId,
      timestamp: Date.now(),
      status: "active",
    };

    record.calls.push(attempt);
    record.active_call_id = callId;
    record.last_call_timestamp = attempt.timestamp;

    this.saveRecords();

    logger.info("Call start recorded", {
      phone: record.phone_number,
      lead_id: leadId,
      call_id: callId,
      total_attempts: record.calls.length,
    });
  }

  /**
   * Record when call completes
   */
  recordCallComplete(
    phoneNumber: string,
    callId: string,
    outcome: CallOutcome,
    transcriptData: any
  ): void {
    this.checkDateRotation();

    const normalized = this.normalizePhone(phoneNumber);
    const record = this.records.get(normalized);

    if (!record) {
      logger.warn("No record found for call completion", {
        phone: normalized,
        call_id: callId,
      });
      return;
    }

    // Find and update the call attempt
    const attempt = record.calls.find((c) => c.call_id === callId);
    if (attempt) {
      attempt.status = "completed";
      attempt.outcome = outcome;
      attempt.answered_by = transcriptData.answered_by;
      attempt.duration = transcriptData.duration;
    }

    // CRITICAL FIX: For TRANSFERRED calls, DON'T clear active_call_id immediately
    // The customer is still on the call with the transferred agent!
    // Keep the line "busy" for a safety window to prevent duplicate calls
    if (record.active_call_id === callId) {
      if (outcome === CallOutcome.TRANSFERRED) {
        // Set a delayed clear for transferred calls (30 minutes)
        // This prevents duplicate calls while customer is talking to agent
        const transferSafetyWindowMs = 30 * 60 * 1000; // 30 minutes
        logger.info("Transfer detected - keeping line protected", {
          phone: record.phone_number,
          call_id: callId,
          safety_window_minutes: 30,
        });

        setTimeout(() => {
          // Re-check if this is still the active call before clearing
          if (record.active_call_id === callId) {
            record.active_call_id = null;
            this.saveRecords();
            logger.info("Transfer safety window expired - line released", {
              phone: record.phone_number,
              call_id: callId,
            });
          }
        }, transferSafetyWindowMs);
      } else {
        // For non-transferred calls, clear immediately
        record.active_call_id = null;
      }
    }

    // Update final outcome
    record.final_outcome = outcome;

    this.saveRecords();

    logger.info("Call completion recorded", {
      phone: record.phone_number,
      call_id: callId,
      outcome,
      answered_by: transcriptData.answered_by,
      active_call_cleared: outcome !== CallOutcome.TRANSFERRED,
    });
  }

  /**
   * Record call failure
   */
  recordCallFailure(phoneNumber: string, callId: string, error: string): void {
    this.checkDateRotation();

    const normalized = this.normalizePhone(phoneNumber);
    const record = this.records.get(normalized);

    if (!record) {
      logger.warn("No record found for call failure", {
        phone: normalized,
        call_id: callId,
      });
      return;
    }

    const attempt = record.calls.find((c) => c.call_id === callId);
    if (attempt) {
      attempt.status = "failed";
    }

    // Clear active call
    if (record.active_call_id === callId) {
      record.active_call_id = null;
    }

    this.saveRecords();

    logger.info("Call failure recorded", {
      phone: record.phone_number,
      call_id: callId,
      error,
    });
  }

  /**
   * Check if number has active call
   */
  hasActiveCall(phoneNumber: string): boolean {
    const normalized = this.normalizePhone(phoneNumber);
    const record = this.records.get(normalized);
    return record ? record.active_call_id !== null : false;
  }

  /**
   * Get call history for specific number
   */
  getCallHistory(phoneNumber: string): DailyCallRecord | null {
    const normalized = this.normalizePhone(phoneNumber);
    return this.records.get(normalized) || null;
  }

  /**
   * Get all records for today
   */
  getAllRecords(): DailyCallRecord[] {
    this.checkDateRotation();
    return Array.from(this.records.values());
  }

  /**
   * Get today's statistics
   */
  getTodayStats() {
    this.checkDateRotation();

    const outcomeBreakdown: Record<string, number> = {};
    let activeCallsCount = 0;
    let blockedCount = 0;
    let totalAttempts = 0;

    for (const record of this.records.values()) {
      totalAttempts += record.calls.length;

      if (record.active_call_id) {
        activeCallsCount++;
      }

      if (record.blocked) {
        blockedCount++;
      }

      if (record.final_outcome) {
        const outcome = record.final_outcome;
        outcomeBreakdown[outcome] = (outcomeBreakdown[outcome] || 0) + 1;
      }
    }

    return {
      date: this.currentDate,
      total_unique_numbers: this.records.size,
      total_call_attempts: totalAttempts,
      active_calls: activeCallsCount,
      blocked_numbers: blockedCount,
      outcomes_breakdown: outcomeBreakdown,
    };
  }

  /**
   * Manually block a number
   */
  blockNumber(phoneNumber: string, reason: string): void {
    const record = this.getOrCreateRecord(phoneNumber);
    record.blocked = true;
    record.blocked_reason = reason;
    this.saveRecords();

    logger.info("Number manually blocked", {
      phone: record.phone_number,
      reason,
    });
  }

  /**
   * Unblock a number
   */
  unblockNumber(phoneNumber: string): void {
    const normalized = this.normalizePhone(phoneNumber);
    const record = this.records.get(normalized);

    if (record) {
      record.blocked = false;
      record.blocked_reason = undefined;
      this.saveRecords();

      logger.info("Number unblocked", { phone: record.phone_number });
    }
  }

  /**
   * Mark a number as failed for today only (due to "Call failed" error)
   * This blocks the number for the rest of the day, but automatically resets at midnight EST
   */
  markAsFailedForToday(phoneNumber: string, errorMessage: string): void {
    const record = this.getOrCreateRecord(phoneNumber);
    record.failed_call_error = true;
    record.failed_call_error_message = errorMessage;
    this.saveRecords();

    logger.info("Number marked as failed for today", {
      phone: record.phone_number,
      error_message: errorMessage,
      note: "Will automatically reset at midnight EST",
    });
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ProtectionConfig>): ProtectionConfig {
    this.config = {
      ...this.config,
      ...updates,
      rules: {
        ...this.config.rules,
        ...(updates.rules || {}),
      },
    };
    this.saveConfig();
    logger.info("Call protection config updated", this.config);
    return this.config;
  }

  /**
   * Get current configuration
   */
  getConfig(): ProtectionConfig {
    return { ...this.config };
  }
}

export const dailyCallTracker = new DailyCallTrackerService();
export { DailyCallRecord, CallAttempt, ProtectionConfig, CallDecision };
