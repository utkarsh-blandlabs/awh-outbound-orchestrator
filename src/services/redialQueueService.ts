// ============================================================================
// Redial Queue Service
// Automatically redials leads that didn't result in sale/transfer/rescheduled
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { config } from "../config";
import { schedulerService } from "./schedulerService";
import { convosoService } from "./convosoService";

interface RedialRecord {
  lead_id: string;
  phone_number: string;
  list_id: string;
  first_name: string;
  last_name: string;
  state: string; // Required by Convoso payload
  attempts: number;
  last_call_timestamp: number;
  next_redial_timestamp: number;
  scheduled_callback_time?: number; // If customer requested callback at specific time
  outcomes: string[]; // Track all outcomes
  last_outcome: string;
  last_call_id: string;
  created_at: number;
  updated_at: number;
  status: "pending" | "rescheduled" | "completed" | "max_attempts" | "paused";
}

interface RedialQueueConfig {
  enabled: boolean;
  redial_interval_minutes: number; // DEPRECATED - use progressive_intervals instead
  progressive_intervals: number[]; // Progressive intervals: [10, 30, 40, 60] minutes
  max_redial_attempts: number; // Max redial attempts per lead
  success_outcomes: string[]; // Outcomes that stop redialing
  retention_days: number; // Keep files for X days
  process_interval_minutes: number; // How often to check queue
  // Three-tier day-based intervals (overrides progressive_intervals when set)
  day0_interval_minutes: number; // Same day as first call (aggressive)
  day1_interval_minutes: number; // Next day (moderate)
  day2_plus_interval_minutes: number; // 2+ days old (gentle)
}

class RedialQueueService {
  private records: Map<string, RedialRecord> = new Map();
  private queueConfig: RedialQueueConfig;
  private dataDir: string;
  private currentMonth: string;
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private fileLock: boolean = false;

  constructor() {
    this.dataDir = path.join(process.cwd(), "data", "redial-queue");
    this.currentMonth = this.getCurrentMonthEST();

    // Load config from environment variables
    // Default: 0,0,5,10,30,60,120 (matches Fronter dialing behavior)
    // 2nd call: INSTANT, 3rd: INSTANT, 4th: 5min, 5th: 10min, 6th: 30min, 7th: 1hr, 8th: 2hr
    const progressiveIntervalsStr = process.env["REDIAL_PROGRESSIVE_INTERVALS"] || "0,0,5,10,30,60,120";
    const progressiveIntervals = progressiveIntervalsStr
      .split(",")
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n));

    this.queueConfig = {
      enabled: process.env["REDIAL_QUEUE_ENABLED"] === "true",
      redial_interval_minutes: parseInt(
        process.env["REDIAL_INTERVAL_MINUTES"] || "30"
      ),
      progressive_intervals: progressiveIntervals.length > 0 ? progressiveIntervals : [0, 0, 5, 10, 30, 60, 120],
      max_redial_attempts: parseInt(
        process.env["REDIAL_MAX_ATTEMPTS"] || "8"
      ),
      success_outcomes: (
        process.env["REDIAL_SUCCESS_OUTCOMES"] ||
        "TRANSFERRED,SALE,ACA,CALLBACK"
      )
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0),
      retention_days: parseInt(process.env["REDIAL_RETENTION_DAYS"] || "30"),
      process_interval_minutes: parseInt(
        process.env["REDIAL_PROCESS_INTERVAL"] || "5"
      ),
      // Three-tier day-based intervals
      day0_interval_minutes: parseInt(process.env["REDIAL_INTERVAL_DAY0_MINUTES"] || "45"),
      day1_interval_minutes: parseInt(process.env["REDIAL_INTERVAL_DAY1_MINUTES"] || "120"),
      day2_plus_interval_minutes: parseInt(process.env["REDIAL_INTERVAL_DAY2_PLUS_MINUTES"] || "240"),
    };

    this.ensureDirectories();
    this.loadCurrentMonthRecords();

    // Auto-start if enabled
    if (this.queueConfig.enabled) {
      this.startProcessor();
    }

    logger.info("Redial queue service initialized", {
      enabled: this.queueConfig.enabled,
      progressive_intervals: this.queueConfig.progressive_intervals,
      max_attempts: this.queueConfig.max_redial_attempts,
      success_outcomes: this.queueConfig.success_outcomes,
    });
  }

  /**
   * Get progressive interval for specific attempt number
   * Default cadence (Fronter behavior):
   * 2nd call: 0 min (INSTANT), 3rd: 0 min (INSTANT), 4th: 5 min, 5th: 10 min,
   * 6th: 30 min, 7th: 60 min (1hr), 8th: 120 min (2hr)
   */
  /**
   * Calculate which "day" a lead is on (0, 1, or 2+) based on created_at timestamp
   * Day 0: Same day as first call (created_at date = today's date in EST)
   * Day 1: Next day after first call (created_at date = yesterday's date in EST)
   * Day 2+: 2 or more days after first call (created_at date >= 2 days ago in EST)
   */
  private getLeadDaysSinceCreation(createdAtTimestamp: number): number {
    const now = this.getNowEST();

    // Get start of day (12:00 AM EST) for created_at and now
    const createdDate = new Date(createdAtTimestamp);
    const createdStartOfDay = new Date(
      createdDate.getFullYear(),
      createdDate.getMonth(),
      createdDate.getDate()
    ).getTime();

    const nowDate = new Date(now);
    const nowStartOfDay = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate()
    ).getTime();

    // Calculate difference in days
    const daysDiff = Math.floor((nowStartOfDay - createdStartOfDay) / (24 * 60 * 60 * 1000));

    return Math.max(0, daysDiff);
  }

  /**
   * Get redial interval based on lead age (days since creation)
   * Uses three-tier system: Day 0 (45min), Day 1 (120min), Day 2+ (240min)
   */
  private getProgressiveInterval(attemptNumber: number, createdAtTimestamp?: number): number {
    // If no created_at provided, fall back to old progressive intervals
    if (!createdAtTimestamp) {
      const intervals = this.queueConfig.progressive_intervals;
      const index = attemptNumber - 1;
      if (index < 0) return intervals[0] || 0;
      if (index >= intervals.length) return intervals[intervals.length - 1] || 120;
      return intervals[index] || 30;
    }

    // Use day-based intervals
    const daysSinceCreation = this.getLeadDaysSinceCreation(createdAtTimestamp);

    if (daysSinceCreation === 0) {
      // Same day: aggressive (45 min)
      return this.queueConfig.day0_interval_minutes;
    } else if (daysSinceCreation === 1) {
      // Day 1: moderate (120 min / 2 hours)
      return this.queueConfig.day1_interval_minutes;
    } else {
      // Day 2+: gentle (240 min / 4 hours)
      return this.queueConfig.day2_plus_interval_minutes;
    }
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info("Created redial-queue directory", { path: this.dataDir });
    }
  }

  /**
   * Get current month in EST timezone (YYYY-MM)
   */
  private getCurrentMonthEST(): string {
    // Use proper EST timezone handling (handles daylight saving automatically)
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === "year")?.value || "";
    const month = parts.find(p => p.type === "month")?.value || "";
    return `${year}-${month}`; // YYYY-MM
  }

  /**
   * Get current date in EST timezone (YYYY-MM-DD)
   */
  private getCurrentDateEST(): string {
    // Use proper EST timezone handling (handles daylight saving automatically)
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date()); // Returns YYYY-MM-DD in EST/EDT
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

  private getRecordFilePath(month: string): string {
    return path.join(this.dataDir, `redial-queue_${month}.json`);
  }

  /**
   * Generate unique key from phone_number ONLY
   * CHANGED: Previously used lead_id + phone to allow same phone in different lists
   * NOW: Use phone only to prevent duplicate calls to same number from different lists
   * Per Delaine's feedback: "treat as 1 lead, otherwise they would get double the redials"
   */
  private generateKey(leadId: string, phoneNumber: string): string {
    const normalized = phoneNumber.replace(/\D/g, "");
    return normalized; // Use phone number only, not lead_id + phone
  }

  /**
   * Load records from current month file with file locking
   */
  private async loadCurrentMonthRecords(): Promise<void> {
    const filePath = this.getRecordFilePath(this.currentMonth);

    if (!fs.existsSync(filePath)) {
      logger.info("No existing redial queue file for current month", {
        month: this.currentMonth,
      });
      return;
    }

    try {
      // Wait for file lock
      await this.waitForFileLock();
      this.fileLock = true;

      const data = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(data);

      // CRITICAL FIX: Migrate old key format (lead_id_phone) to new format (phone-only)
      // This prevents duplicate entries for the same phone number
      const migratedRecords = new Map<string, RedialRecord>();
      let migrationCount = 0;
      let mergeCount = 0;

      for (const [oldKey, record] of Object.entries<RedialRecord>(parsed)) {
        // Generate new key (phone-only)
        const newKey = this.generateKey(record.lead_id, record.phone_number);

        // Check if we already have a record with this phone number
        const existing = migratedRecords.get(newKey);

        if (existing) {
          // MERGE: Keep the record with more attempts (more history)
          if (record.attempts > existing.attempts) {
            migratedRecords.set(newKey, record);
            logger.warn("Merged duplicate redial record - keeping record with more attempts", {
              phone: record.phone_number,
              old_key: oldKey,
              new_key: newKey,
              kept_attempts: record.attempts,
              discarded_attempts: existing.attempts,
            });
          }
          mergeCount++;
        } else {
          migratedRecords.set(newKey, record);
          if (oldKey !== newKey) {
            migrationCount++;
          }
        }
      }

      this.records = migratedRecords;

      logger.info("Loaded and migrated redial queue records", {
        month: this.currentMonth,
        total_loaded: Object.keys(parsed).length,
        final_count: this.records.size,
        migrated: migrationCount,
        merged_duplicates: mergeCount,
      });

      // Save migrated records back to file if migration occurred
      if (migrationCount > 0 || mergeCount > 0) {
        await this.saveRecords();
        logger.info("Saved migrated redial queue records to disk", {
          migrated: migrationCount,
          merged: mergeCount,
        });
      }
    } catch (error: any) {
      logger.error("Failed to load redial queue records", {
        error: error.message,
        month: this.currentMonth,
      });
    } finally {
      this.fileLock = false;
    }
  }

  /**
   * Save records to file with atomic write and file locking
   */
  private async saveRecords(): Promise<void> {
    const filePath = this.getRecordFilePath(this.currentMonth);
    const tempPath = `${filePath}.tmp`;

    try {
      // Wait for file lock
      await this.waitForFileLock();
      this.fileLock = true;

      // Convert Map to object for JSON
      const data: Record<string, RedialRecord> = {};
      this.records.forEach((value, key) => {
        data[key] = value;
      });

      // Write to temp file first (atomic write)
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));

      // Rename temp to actual (atomic operation)
      fs.renameSync(tempPath, filePath);

      logger.debug("Saved redial queue records", {
        month: this.currentMonth,
        count: this.records.size,
      });
    } catch (error: any) {
      logger.error("Failed to save redial queue records", {
        error: error.message,
      });
    } finally {
      this.fileLock = false;
    }
  }

  /**
   * Wait for file lock to be released
   */
  private async waitForFileLock(maxWait: number = 5000): Promise<void> {
    const startTime = Date.now();
    while (this.fileLock && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Check if outcome is a success (should stop redialing)
   */
  private isSuccessOutcome(outcome: string): boolean {
    const normalizedOutcome = outcome.toUpperCase().trim();
    return this.queueConfig.success_outcomes.some(
      (success) => normalizedOutcome === success || normalizedOutcome.includes(success)
    );
  }

  /**
   * Add or update a lead in redial queue
   * Called from webhook after call completes
   */
  async addOrUpdateLead(
    leadId: string,
    phoneNumber: string,
    listId: string,
    firstName: string,
    lastName: string,
    state: string,
    outcome: string,
    callId: string,
    scheduledCallbackTime?: number
  ): Promise<void> {
    if (!this.queueConfig.enabled) {
      return;
    }

    // CRITICAL: Check if there's an active call to this phone number
    // This prevents duplicate calls while a call is still ongoing
    const { CallStateManager } = await import("./callStateManager");
    const activeCalls = CallStateManager.getAllPendingCalls();
    const activeCallToNumber = activeCalls.find(
      (call) =>
        call.phone_number === phoneNumber &&
        call.status === "pending" &&
        call.call_id !== callId // Exclude the current call that just triggered the webhook
    );

    if (activeCallToNumber) {
      logger.warn("Skipping redial queue add - active call in progress to this number", {
        lead_id: leadId,
        phone: phoneNumber,
        active_call_id: activeCallToNumber.call_id,
        webhook_call_id: callId,
      });
      return; // Don't add to redial queue while call is active
    }

    // Check if this is a success outcome - if yes, mark as completed
    if (this.isSuccessOutcome(outcome)) {
      await this.markCompleted(leadId, phoneNumber, outcome);
      return;
    }

    const key = this.generateKey(leadId, phoneNumber);
    const now = this.getNowEST();
    const existing = this.records.get(key);

    if (existing) {
      // Check if this is a duplicate webhook (same call_id)
      if (existing.last_call_id === callId) {
        logger.warn("Duplicate webhook detected, skipping attempt increment", {
          lead_id: leadId,
          phone: phoneNumber,
          call_id: callId,
          existing_attempts: existing.attempts,
        });
        // Update outcome if different, but don't increment attempts
        if (existing.last_outcome !== outcome) {
          existing.last_outcome = outcome;
          if (!existing.outcomes.includes(outcome)) {
            existing.outcomes.push(outcome);
          }
          existing.updated_at = now;
          await this.saveRecords();
        }
        return;
      }

      // Update existing record (new call)
      // IMPORTANT: Update lead metadata (lead_id, list_id, name) in case same phone comes from different list
      const leadChanged = existing.lead_id !== leadId || existing.list_id !== listId;
      if (leadChanged) {
        logger.info("Same phone from different list - updating to most recent lead info", {
          phone: phoneNumber,
          old_lead_id: existing.lead_id,
          old_list_id: existing.list_id,
          new_lead_id: leadId,
          new_list_id: listId,
          current_attempts: existing.attempts,
        });
      }
      existing.lead_id = leadId; // Use most recent lead_id
      existing.list_id = listId; // Use most recent list_id
      existing.first_name = firstName; // Use most recent name
      existing.last_name = lastName;
      existing.state = state; // Use most recent state
      existing.attempts += 1;
      existing.last_call_timestamp = now;
      existing.last_outcome = outcome;
      existing.outcomes.push(outcome);
      existing.last_call_id = callId;
      existing.updated_at = now;

      // Calculate next redial time using progressive intervals
      if (scheduledCallbackTime) {
        existing.next_redial_timestamp = scheduledCallbackTime;
        existing.scheduled_callback_time = scheduledCallbackTime;
        existing.status = "rescheduled";
      } else {
        // Use day-based interval (days since lead creation)
        const intervalMinutes = this.getProgressiveInterval(existing.attempts, existing.created_at);
        // IMPORTANT: Add minimum 2-minute delay even for "instant" (0 min) intervals
        // This prevents race conditions where call is still active/completing
        const actualIntervalMs = intervalMinutes === 0
          ? 2 * 60 * 1000 // 2 minutes minimum
          : intervalMinutes * 60 * 1000;
        existing.next_redial_timestamp = now + actualIntervalMs;
        existing.status = "pending";
      }

      // Check if max attempts reached
      if (existing.attempts >= this.queueConfig.max_redial_attempts) {
        existing.status = "max_attempts";
      }

      logger.info("Updated redial queue record", {
        lead_id: leadId,
        phone: phoneNumber,
        attempts: existing.attempts,
        max: this.queueConfig.max_redial_attempts,
        status: existing.status,
        next_redial: new Date(existing.next_redial_timestamp).toISOString(),
        next_interval_minutes: this.getProgressiveInterval(existing.attempts, existing.created_at),
        days_since_creation: this.getLeadDaysSinceCreation(existing.created_at),
      });
    } else {
      // Create new record with day-based interval for first attempt
      const firstIntervalMinutes = this.getProgressiveInterval(1, now);
      // IMPORTANT: Add minimum 2-minute delay even for "instant" (0 min) intervals
      // This prevents race conditions where call is still active/completing
      const actualIntervalMs = firstIntervalMinutes === 0
        ? 2 * 60 * 1000 // 2 minutes minimum
        : firstIntervalMinutes * 60 * 1000;

      const newRecord: RedialRecord = {
        lead_id: leadId,
        phone_number: phoneNumber,
        list_id: listId,
        first_name: firstName,
        last_name: lastName,
        state: state,
        attempts: 1,
        last_call_timestamp: now,
        next_redial_timestamp: scheduledCallbackTime || (now + actualIntervalMs),
        scheduled_callback_time: scheduledCallbackTime,
        outcomes: [outcome],
        last_outcome: outcome,
        last_call_id: callId,
        created_at: now,
        updated_at: now,
        status: scheduledCallbackTime ? "rescheduled" : "pending",
      };

      this.records.set(key, newRecord);

      logger.info("Added new lead to redial queue", {
        lead_id: leadId,
        phone: phoneNumber,
        outcome,
        next_redial: new Date(newRecord.next_redial_timestamp).toISOString(),
        next_interval_minutes: firstIntervalMinutes,
      });
    }

    await this.saveRecords();
  }

  /**
   * Mark lead as completed (successful outcome)
   */
  private async markCompleted(
    leadId: string,
    phoneNumber: string,
    outcome: string
  ): Promise<void> {
    const key = this.generateKey(leadId, phoneNumber);
    const existing = this.records.get(key);

    if (existing) {
      existing.status = "completed";
      existing.last_outcome = outcome;
      existing.updated_at = this.getNowEST();

      logger.info("Marked redial queue record as completed", {
        lead_id: leadId,
        phone: phoneNumber,
        outcome,
        total_attempts: existing.attempts,
      });

      await this.saveRecords();
    }
  }

  /**
   * Start automatic queue processor
   */
  startProcessor(): void {
    if (this.processingInterval) {
      logger.warn("Redial queue processor already running");
      return;
    }

    logger.info("Starting redial queue processor", {
      interval_minutes: this.queueConfig.process_interval_minutes,
    });

    // Process immediately on start
    this.processQueue();

    // Then process on interval
    const intervalMs = this.queueConfig.process_interval_minutes * 60 * 1000;
    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, intervalMs);
  }

  /**
   * Stop automatic queue processor
   */
  stopProcessor(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.info("Redial queue processor stopped");
    }
  }

  /**
   * Process redial queue - make calls for leads that are ready
   * SAFE IMPLEMENTATION: Multiple validation layers before calling
   */
  async processQueue(): Promise<void> {
    // Safety Check #1: Service enabled
    if (!this.queueConfig.enabled) {
      logger.debug("Redial queue disabled, skipping processing");
      return;
    }

    // Safety Check #2: Prevent concurrent processing
    if (this.isProcessing) {
      logger.warn("Redial queue already processing, skipping to prevent race condition");
      return;
    }

    // Safety Check #3: Check if scheduler is active (business hours)
    if (!schedulerService.isActive()) {
      logger.debug("Redial queue: Scheduler inactive (outside business hours), skipping");
      return;
    }

    this.isProcessing = true;

    try {
      const now = this.getNowEST();

      // Safety Check #4: Reload current month records to get latest data
      await this.loadCurrentMonthRecords();

      // SAFE FILTERING: Multiple validation layers
      const allRecords = Array.from(this.records.values());

      logger.info("Redial queue processing started", {
        total_records: allRecords.length,
        max_attempts: this.queueConfig.max_redial_attempts,
        current_time: new Date(now).toISOString(),
      });

      // Filter #1: Only records within retention period (CHANGED: not just today - include old leads)
      const retentionMs = this.queueConfig.retention_days * 24 * 60 * 60 * 1000;
      const cutoffTimestamp = now - retentionMs;
      const withinRetentionRecords = allRecords.filter((record) => {
        if (!record || !record.created_at) return false;
        return record.created_at >= cutoffTimestamp;
      });

      logger.debug("Filtered to records within retention period", {
        retention_days: this.queueConfig.retention_days,
        within_retention: withinRetentionRecords.length,
        total: allRecords.length,
        cutoff_date: new Date(cutoffTimestamp).toISOString(),
      });

      // Filter #2: Only favorable statuses (pending or rescheduled ready)
      const favorableRecords = withinRetentionRecords.filter((record) => {
        // Null safety checks
        if (!record || !record.status) return false;

        // Pending records are favorable
        if (record.status === "pending") return true;

        // Rescheduled records that are due
        if (record.status === "rescheduled") {
          if (!record.scheduled_callback_time) return false;
          return record.scheduled_callback_time <= now;
        }

        // All other statuses (completed, max_attempts, paused) are not favorable
        return false;
      });

      logger.debug("Filtered to favorable statuses", {
        favorable_records: favorableRecords.length,
        pending: favorableRecords.filter(r => r.status === "pending").length,
        rescheduled_ready: favorableRecords.filter(r => r.status === "rescheduled").length,
      });

      // Filter #3: Only records under max attempts
      const underMaxAttempts = favorableRecords.filter((record) => {
        if (!record || typeof record.attempts !== "number") return false;
        return record.attempts < this.queueConfig.max_redial_attempts;
      });

      logger.debug("Filtered to under max attempts", {
        under_max: underMaxAttempts.length,
        max_attempts: this.queueConfig.max_redial_attempts,
      });

      // Filter #4: Only records that are due for redial (timestamp passed)
      const readyLeads = underMaxAttempts.filter((record) => {
        if (!record || typeof record.next_redial_timestamp !== "number") return false;
        return record.next_redial_timestamp <= now;
      });

      // Categorize ready leads by attempt number for visibility
      const leadsByAttempt = new Map<number, number>();
      for (const lead of readyLeads) {
        const attemptNum = (lead.attempts || 0) + 1; // Next attempt number
        leadsByAttempt.set(attemptNum, (leadsByAttempt.get(attemptNum) || 0) + 1);
      }

      // Convert to sorted array for logging
      const attemptDistribution: Record<string, number> = {};
      Array.from(leadsByAttempt.keys())
        .sort((a, b) => a - b)
        .forEach((attemptNum) => {
          attemptDistribution[`attempt_${attemptNum}`] = leadsByAttempt.get(attemptNum) || 0;
        });

      logger.info("Redial queue ready leads identified", {
        ready_to_dial: readyLeads.length,
        breakdown: {
          total: allRecords.length,
          within_retention: withinRetentionRecords.length,
          favorable_status: favorableRecords.length,
          under_max_attempts: underMaxAttempts.length,
          time_ready: readyLeads.length,
        },
        attempt_distribution: attemptDistribution,
      });

      if (readyLeads.length === 0) {
        logger.debug("No leads ready for redial at this time");
        return;
      }

      // Import orchestrator and CallStateManager dynamically to avoid circular dependency
      const { handleAwhOutbound } = await import("../logic/awhOrchestrator");
      const { CallStateManager } = await import("./callStateManager");

      // Process leads sequentially to respect rate limits
      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const lead of readyLeads) {
        try {
          // Null safety checks before processing
          if (!lead || !lead.phone_number || !lead.lead_id) {
            logger.error("Invalid lead record, skipping", { lead });
            skippedCount++;
            continue;
          }

          // PRE-CALL SAFETY CHECK #1: Verify record still under max attempts
          if (lead.attempts >= this.queueConfig.max_redial_attempts) {
            logger.warn("Lead reached max attempts since filtering, skipping", {
              lead_id: lead.lead_id,
              phone: lead.phone_number,
              attempts: lead.attempts,
              max: this.queueConfig.max_redial_attempts,
            });
            lead.status = "max_attempts";
            await this.saveRecords();
            skippedCount++;
            continue;
          }

          // PRE-CALL SAFETY CHECK #2: Check for active/pending calls to this number
          const activeCalls = CallStateManager.getAllPendingCalls();
          const activeCallToNumber = activeCalls.find(
            (call) => call.phone_number === lead.phone_number && call.status === "pending"
          );

          if (activeCallToNumber) {
            logger.info("SAFETY: Skipping redial - active/pending call detected", {
              lead_id: lead.lead_id,
              phone: lead.phone_number,
              active_call_id: activeCallToNumber.call_id,
              next_attempt: lead.attempts + 1,
            });

            // Push redial ahead by 5 minutes to avoid conflict
            const pushAheadMinutes = 5;
            lead.next_redial_timestamp = now + pushAheadMinutes * 60 * 1000;
            lead.updated_at = now;
            await this.saveRecords();
            skippedCount++;
            continue; // Skip to next lead
          }

          // PRE-CALL SAFETY CHECK #3: Verify status is still favorable
          if (lead.status !== "pending" && lead.status !== "rescheduled") {
            logger.warn("Lead status changed since filtering, skipping", {
              lead_id: lead.lead_id,
              phone: lead.phone_number,
              status: lead.status,
            });
            skippedCount++;
            continue;
          }

          // PRE-CALL SAFETY CHECK #4: Check Convoso for success status
          // This prevents calling leads that were successfully contacted via other channels
          const skipCheck = await convosoService.shouldSkipLead(
            lead.phone_number,
            this.queueConfig.success_outcomes
          );

          if (skipCheck.skip) {
            logger.info("SAFETY: Skipping redial - lead already processed in Convoso", {
              lead_id: lead.lead_id,
              phone: lead.phone_number,
              convoso_status: skipCheck.status,
              reason: skipCheck.reason,
            });

            // Mark lead as completed to prevent future redialing
            lead.status = "completed";
            lead.updated_at = now;
            await this.saveRecords();
            skippedCount++;
            continue;
          }

          // ALL SAFETY CHECKS PASSED - PROCEED WITH CALL
          logger.info("CALLING: All safety checks passed, initiating redial", {
            lead_id: lead.lead_id,
            phone: lead.phone_number,
            attempt_number: lead.attempts + 1,
            max_attempts: this.queueConfig.max_redial_attempts,
            last_outcome: lead.last_outcome,
            time_since_last_call: Math.floor((now - lead.last_call_timestamp) / 60000) + " minutes",
          });

          // Make the call
          const result = await handleAwhOutbound({
            lead_id: lead.lead_id,
            list_id: lead.list_id,
            phone_number: lead.phone_number,
            first_name: lead.first_name,
            last_name: lead.last_name,
            state: lead.state,
            status: lead.last_outcome, // Pass last outcome as status
          });

          logger.info("CALL INITIATED: Redial successful", {
            lead_id: lead.lead_id,
            phone: lead.phone_number,
            call_id: result.call_id,
            success: result.success,
            attempt_number: lead.attempts + 1,
          });

          processedCount++;

          // Note: The webhook will update the record when call completes
          // Do NOT update attempts here - let webhook handle it to prevent double-counting

        } catch (error: any) {
          errorCount++;
          logger.error("ERROR: Failed to redial lead", {
            lead_id: lead.lead_id,
            phone: lead.phone_number,
            attempt_number: lead.attempts + 1,
            error: error.message,
            stack: error.stack,
          });

          // Safe error recovery: Schedule retry with day-based interval
          try {
            const retryIntervalMinutes = this.getProgressiveInterval(lead.attempts + 1, lead.created_at);
            const retryIntervalMs = retryIntervalMinutes === 0
              ? 2 * 60 * 1000 // Minimum 2 minutes
              : retryIntervalMinutes * 60 * 1000;

            lead.next_redial_timestamp = now + retryIntervalMs;
            lead.updated_at = now;
            await this.saveRecords();

            logger.info("Scheduled retry after error", {
              lead_id: lead.lead_id,
              phone: lead.phone_number,
              retry_in_minutes: retryIntervalMinutes || 2,
              days_since_creation: this.getLeadDaysSinceCreation(lead.created_at),
            });
          } catch (saveError: any) {
            logger.error("Failed to save retry schedule", {
              lead_id: lead.lead_id,
              error: saveError.message,
            });
          }
        }
      }

      // Final summary
      logger.info("Redial queue processing completed", {
        total_ready: readyLeads.length,
        calls_made: processedCount,
        skipped: skippedCount,
        errors: errorCount,
      });

    } catch (error: any) {
      logger.error("CRITICAL: Error processing redial queue", {
        error: error.message,
        stack: error.stack,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): RedialQueueConfig {
    return { ...this.queueConfig };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RedialQueueConfig>): RedialQueueConfig {
    const wasEnabled = this.queueConfig.enabled;
    const oldInterval = this.queueConfig.process_interval_minutes;

    this.queueConfig = { ...this.queueConfig, ...updates };

    // If enabled state changed
    if (updates.enabled !== undefined && updates.enabled !== wasEnabled) {
      if (this.queueConfig.enabled && !this.processingInterval) {
        this.startProcessor();
      } else if (!this.queueConfig.enabled && this.processingInterval) {
        this.stopProcessor();
      }
    }

    // If interval changed, restart processor
    if (
      updates.process_interval_minutes !== undefined &&
      updates.process_interval_minutes !== oldInterval &&
      this.processingInterval
    ) {
      this.stopProcessor();
      this.startProcessor();
    }

    logger.info("Redial queue config updated", { updates });
    return this.getConfig();
  }

  /**
   * Get statistics
   */
  getStats(): {
    enabled: boolean;
    total_records: number;
    pending: number;
    rescheduled: number;
    completed: number;
    max_attempts: number;
    paused: number;
    ready_to_dial: number;
    current_month: string;
  } {
    const now = this.getNowEST();
    const records = Array.from(this.records.values());

    return {
      enabled: this.queueConfig.enabled,
      total_records: records.length,
      pending: records.filter((r) => r.status === "pending").length,
      rescheduled: records.filter((r) => r.status === "rescheduled").length,
      completed: records.filter((r) => r.status === "completed").length,
      max_attempts: records.filter((r) => r.status === "max_attempts").length,
      paused: records.filter((r) => r.status === "paused").length,
      ready_to_dial: records.filter(
        (r) =>
          (r.status === "pending" || r.status === "rescheduled") &&
          r.next_redial_timestamp <= now &&
          r.attempts < this.queueConfig.max_redial_attempts
      ).length,
      current_month: this.currentMonth,
    };
  }

  /**
   * Get all records with filtering
   */
  getAllRecords(filter?: {
    status?: string;
    ready?: boolean;
    limit?: number;
    offset?: number;
  }): RedialRecord[] {
    let records = Array.from(this.records.values());
    const now = this.getNowEST();

    // Apply filters
    if (filter?.status) {
      records = records.filter((r) => r.status === filter.status);
    }

    if (filter?.ready) {
      records = records.filter(
        (r) =>
          (r.status === "pending" || r.status === "rescheduled") &&
          r.next_redial_timestamp <= now &&
          r.attempts < this.queueConfig.max_redial_attempts
      );
    }

    // Sort by next_redial_timestamp (earliest first)
    records.sort((a, b) => a.next_redial_timestamp - b.next_redial_timestamp);

    // Apply pagination
    if (filter?.offset !== undefined) {
      records = records.slice(filter.offset);
    }

    if (filter?.limit !== undefined) {
      records = records.slice(0, filter.limit);
    }

    return records;
  }

  /**
   * Manually trigger queue processing
   */
  async triggerProcessing(): Promise<{ success: boolean; message: string }> {
    if (!this.queueConfig.enabled) {
      return {
        success: false,
        message: "Redial queue is disabled",
      };
    }

    if (this.isProcessing) {
      return {
        success: false,
        message: "Queue is already being processed",
      };
    }

    this.processQueue();

    return {
      success: true,
      message: "Queue processing triggered",
    };
  }

  /**
   * Remove a lead from queue
   */
  async removeLead(leadId: string, phoneNumber: string): Promise<boolean> {
    const key = this.generateKey(leadId, phoneNumber);
    const deleted = this.records.delete(key);

    if (deleted) {
      await this.saveRecords();
      logger.info("Removed lead from redial queue", { lead_id: leadId, phone: phoneNumber });
    }

    return deleted;
  }

  /**
   * Pause a lead (stop redialing temporarily)
   */
  async pauseLead(leadId: string, phoneNumber: string): Promise<boolean> {
    const key = this.generateKey(leadId, phoneNumber);
    const record = this.records.get(key);

    if (record) {
      record.status = "paused";
      record.updated_at = this.getNowEST();
      await this.saveRecords();
      logger.info("Paused lead in redial queue", { lead_id: leadId, phone: phoneNumber });
      return true;
    }

    return false;
  }

  /**
   * Resume a paused lead
   */
  async resumeLead(leadId: string, phoneNumber: string): Promise<boolean> {
    const key = this.generateKey(leadId, phoneNumber);
    const record = this.records.get(key);

    if (record && record.status === "paused") {
      record.status = "pending";
      record.updated_at = this.getNowEST();
      await this.saveRecords();
      logger.info("Resumed lead in redial queue", { lead_id: leadId, phone: phoneNumber });
      return true;
    }

    return false;
  }

  /**
   * Clean up old files (keep only retention_days)
   */
  async cleanupOldFiles(): Promise<void> {
    try {
      const files = fs.readdirSync(this.dataDir);
      const now = Date.now();
      const retentionMs = this.queueConfig.retention_days * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (file.startsWith("redial-queue_") && file.endsWith(".json")) {
          const filePath = path.join(this.dataDir, file);
          const stats = fs.statSync(filePath);
          const fileAge = now - stats.mtimeMs;

          if (fileAge > retentionMs) {
            fs.unlinkSync(filePath);
            logger.info("Deleted old redial queue file", {
              file,
              age_days: Math.floor(fileAge / (24 * 60 * 60 * 1000)),
            });
          }
        }
      }
    } catch (error: any) {
      logger.error("Failed to cleanup old redial queue files", {
        error: error.message,
      });
    }
  }

  /**
   * Get status
   */
  getStatus(): {
    running: boolean;
    enabled: boolean;
    is_processing: boolean;
    interval_minutes: number;
    redial_interval_minutes: number;
    max_attempts: number;
  } {
    return {
      running: this.processingInterval !== null,
      enabled: this.queueConfig.enabled,
      is_processing: this.isProcessing,
      interval_minutes: this.queueConfig.process_interval_minutes,
      redial_interval_minutes: this.queueConfig.redial_interval_minutes,
      max_attempts: this.queueConfig.max_redial_attempts,
    };
  }
}

export const redialQueueService = new RedialQueueService();
