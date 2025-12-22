// ============================================================================
// Redial Queue Service
// Automatically redials leads that didn't result in sale/transfer/rescheduled
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { config } from "../config";
import { schedulerService } from "./schedulerService";

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
  redial_interval_minutes: number; // Time between redial attempts
  max_redial_attempts: number; // Max redial attempts per lead
  success_outcomes: string[]; // Outcomes that stop redialing
  retention_days: number; // Keep files for X days
  process_interval_minutes: number; // How often to check queue
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
    this.queueConfig = {
      enabled: process.env["REDIAL_QUEUE_ENABLED"] === "true",
      redial_interval_minutes: parseInt(
        process.env["REDIAL_INTERVAL_MINUTES"] || "30"
      ),
      max_redial_attempts: parseInt(
        process.env["REDIAL_MAX_ATTEMPTS"] || "4"
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
    };

    this.ensureDirectories();
    this.loadCurrentMonthRecords();

    // Auto-start if enabled
    if (this.queueConfig.enabled) {
      this.startProcessor();
    }

    logger.info("Redial queue service initialized", {
      enabled: this.queueConfig.enabled,
      redial_interval: this.queueConfig.redial_interval_minutes,
      max_attempts: this.queueConfig.max_redial_attempts,
      success_outcomes: this.queueConfig.success_outcomes,
    });
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
    const now = new Date();
    const estOffset = -5 * 60; // EST is UTC-5
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const estTime = new Date(utc + estOffset * 60000);
    return estTime.toISOString().substring(0, 7); // YYYY-MM
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
   * Generate unique key from lead_id + phone_number
   */
  private generateKey(leadId: string, phoneNumber: string): string {
    const normalized = phoneNumber.replace(/\D/g, "");
    return `${leadId}_${normalized}`;
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

      this.records = new Map(Object.entries(parsed));

      logger.info("Loaded redial queue records", {
        month: this.currentMonth,
        count: this.records.size,
      });
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
      existing.attempts += 1;
      existing.last_call_timestamp = now;
      existing.last_outcome = outcome;
      existing.outcomes.push(outcome);
      existing.last_call_id = callId;
      existing.updated_at = now;

      // Calculate next redial time
      if (scheduledCallbackTime) {
        existing.next_redial_timestamp = scheduledCallbackTime;
        existing.scheduled_callback_time = scheduledCallbackTime;
        existing.status = "rescheduled";
      } else {
        existing.next_redial_timestamp =
          now + this.queueConfig.redial_interval_minutes * 60 * 1000;
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
      });
    } else {
      // Create new record
      const newRecord: RedialRecord = {
        lead_id: leadId,
        phone_number: phoneNumber,
        list_id: listId,
        first_name: firstName,
        last_name: lastName,
        state: state,
        attempts: 1,
        last_call_timestamp: now,
        next_redial_timestamp: scheduledCallbackTime ||
          now + this.queueConfig.redial_interval_minutes * 60 * 1000,
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
   */
  async processQueue(): Promise<void> {
    if (!this.queueConfig.enabled) {
      return;
    }

    if (this.isProcessing) {
      logger.warn("Redial queue already processing, skipping");
      return;
    }

    // Check if scheduler is active (business hours)
    if (!schedulerService.isActive()) {
      logger.info("Redial queue: Scheduler inactive, skipping processing");
      return;
    }

    this.isProcessing = true;

    try {
      const now = this.getNowEST();
      const readyLeads = Array.from(this.records.values()).filter(
        (record) =>
          record.status === "pending" ||
          (record.status === "rescheduled" &&
            record.scheduled_callback_time &&
            record.scheduled_callback_time <= now)
      ).filter(
        (record) =>
          record.next_redial_timestamp <= now &&
          record.attempts < this.queueConfig.max_redial_attempts
      );

      logger.info("Redial queue processing", {
        total_records: this.records.size,
        ready_to_dial: readyLeads.length,
      });

      if (readyLeads.length === 0) {
        return;
      }

      // Import orchestrator dynamically to avoid circular dependency
      const { handleAwhOutbound } = await import("../logic/awhOrchestrator");

      // Process leads sequentially to respect rate limits
      for (const lead of readyLeads) {
        try {
          logger.info("Redialing lead", {
            lead_id: lead.lead_id,
            phone: lead.phone_number,
            attempt: lead.attempts + 1,
            last_outcome: lead.last_outcome,
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

          logger.info("Redial call initiated", {
            lead_id: lead.lead_id,
            phone: lead.phone_number,
            call_id: result.call_id,
            success: result.success,
          });

          // Note: The webhook will update the record when call completes
        } catch (error: any) {
          logger.error("Failed to redial lead", {
            lead_id: lead.lead_id,
            phone: lead.phone_number,
            error: error.message,
          });

          // Update record to retry later
          lead.next_redial_timestamp =
            now + this.queueConfig.redial_interval_minutes * 60 * 1000;
          await this.saveRecords();
        }
      }
    } catch (error: any) {
      logger.error("Error processing redial queue", {
        error: error.message,
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
