// ============================================================================
// Bad Numbers Service
// Tracks permanently failed phone numbers (e.g., "number not found" errors)
// These numbers are removed from the redial queue and stored for cross-checking
// ============================================================================

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

// Error messages that indicate a permanently bad number
const PERMANENT_FAILURE_PATTERNS = [
  "number you dialed is not found",
  "number is not in service",
  "disconnected",
  "invalid number",
  "unallocated number",
  "number does not exist",
];

interface BadNumberRecord {
  phone_number: string;
  lead_id: string;
  lead_name?: string;
  list_id?: string;
  error_message: string;
  first_failed_at: number; // Timestamp of first failure
  last_failed_at: number; // Timestamp of most recent failure
  failure_count: number; // How many times this number has failed
  call_ids: string[]; // All call IDs that failed for this number
  source: "auto" | "manual"; // How it was added
  notes?: string; // Optional notes for manual review
}

interface BadNumbersData {
  version: string;
  last_updated: number;
  total_count: number;
  records: { [phoneNumber: string]: BadNumberRecord };
}

interface BadNumberStats {
  total_bad_numbers: number;
  added_today: number;
  added_this_week: number;
  added_this_month: number;
  by_error_type: { [errorType: string]: number };
  most_recent: BadNumberRecord[];
}

class BadNumbersService {
  private dataFile: string;
  private data: BadNumbersData;

  constructor() {
    this.dataFile = path.join(process.cwd(), "data", "bad-numbers.json");
    this.ensureDataDir();
    this.data = this.loadData();
  }

  private ensureDataDir(): void {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info("Created data directory for bad numbers", { path: dataDir });
    }
  }

  private loadData(): BadNumbersData {
    try {
      if (fs.existsSync(this.dataFile)) {
        const content = fs.readFileSync(this.dataFile, "utf-8");
        const data = JSON.parse(content) as BadNumbersData;
        logger.info("Loaded bad numbers data", {
          total_count: data.total_count,
        });
        return data;
      }
    } catch (error: any) {
      logger.error("Failed to load bad numbers data", { error: error.message });
    }

    // Return empty data structure
    return {
      version: "1.0",
      last_updated: Date.now(),
      total_count: 0,
      records: {},
    };
  }

  private saveData(): void {
    const tempPath = `${this.dataFile}.tmp`;
    try {
      this.data.last_updated = Date.now();
      this.data.total_count = Object.keys(this.data.records).length;

      // Atomic write: write to temp file first, then rename
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2));
      fs.renameSync(tempPath, this.dataFile);
    } catch (error: any) {
      logger.error("Failed to save bad numbers data", { error: error.message });
      // Clean up temp file if it exists
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Normalize phone number to consistent format (digits only)
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, "").replace(/^1/, ""); // Remove non-digits and leading 1
  }

  /**
   * Check if an error message indicates a permanently bad number
   */
  isPermanentFailure(errorMessage: string | undefined): boolean {
    if (!errorMessage) return false;
    const lowerError = errorMessage.toLowerCase();
    return PERMANENT_FAILURE_PATTERNS.some((pattern) =>
      lowerError.includes(pattern)
    );
  }

  /**
   * Check if a phone number is in the bad numbers list
   */
  isBadNumber(phoneNumber: string): boolean {
    const normalized = this.normalizePhone(phoneNumber);
    return normalized in this.data.records;
  }

  /**
   * Get bad number record if exists
   */
  getBadNumberRecord(phoneNumber: string): BadNumberRecord | null {
    const normalized = this.normalizePhone(phoneNumber);
    return this.data.records[normalized] || null;
  }

  /**
   * Add a phone number to the bad numbers list
   */
  addBadNumber(
    phoneNumber: string,
    leadId: string,
    errorMessage: string,
    callId: string,
    leadName?: string,
    listId?: string,
    source: "auto" | "manual" = "auto"
  ): void {
    const normalized = this.normalizePhone(phoneNumber);
    const now = Date.now();

    const existing = this.data.records[normalized];

    if (existing) {
      // Update existing record
      existing.last_failed_at = now;
      existing.failure_count++;
      if (!existing.call_ids.includes(callId)) {
        existing.call_ids.push(callId);
        // Keep only last 20 call IDs to prevent unbounded growth
        if (existing.call_ids.length > 20) {
          existing.call_ids = existing.call_ids.slice(-20);
        }
      }
      // Update error message if different
      if (existing.error_message !== errorMessage) {
        existing.error_message = errorMessage;
      }

      logger.info("Updated bad number record", {
        phone: normalized,
        lead_id: leadId,
        failure_count: existing.failure_count,
        error: errorMessage,
      });
    } else {
      // Create new record
      this.data.records[normalized] = {
        phone_number: normalized,
        lead_id: leadId,
        lead_name: leadName,
        list_id: listId,
        error_message: errorMessage,
        first_failed_at: now,
        last_failed_at: now,
        failure_count: 1,
        call_ids: [callId],
        source,
      };

      logger.info("Added new bad number", {
        phone: normalized,
        lead_id: leadId,
        error: errorMessage,
        source,
      });
    }

    this.saveData();
  }

  /**
   * Remove a phone number from the bad numbers list (if verified as good)
   */
  removeBadNumber(phoneNumber: string, reason?: string): boolean {
    const normalized = this.normalizePhone(phoneNumber);

    const record = this.data.records[normalized];
    if (record) {
      delete this.data.records[normalized];
      this.saveData();

      logger.info("Removed bad number from list", {
        phone: normalized,
        reason: reason || "manual removal",
        was_failure_count: record.failure_count,
      });

      return true;
    }

    return false;
  }

  /**
   * Add a note to a bad number record
   */
  addNote(phoneNumber: string, note: string): boolean {
    const normalized = this.normalizePhone(phoneNumber);
    const record = this.data.records[normalized];

    if (record) {
      record.notes = note;
      this.saveData();
      return true;
    }

    return false;
  }

  /**
   * Get all bad numbers with optional filtering
   */
  getAllBadNumbers(options?: {
    limit?: number;
    offset?: number;
    sortBy?: "first_failed_at" | "last_failed_at" | "failure_count";
    sortOrder?: "asc" | "desc";
    errorContains?: string;
    addedAfter?: number;
    addedBefore?: number;
  }): {
    records: BadNumberRecord[];
    total: number;
    limit: number;
    offset: number;
  } {
    let records = Object.values(this.data.records);

    // Filter by error message
    if (options?.errorContains) {
      const searchLower = options.errorContains.toLowerCase();
      records = records.filter((r) =>
        r.error_message.toLowerCase().includes(searchLower)
      );
    }

    // Filter by date range
    if (options?.addedAfter) {
      records = records.filter((r) => r.first_failed_at >= options.addedAfter!);
    }
    if (options?.addedBefore) {
      records = records.filter(
        (r) => r.first_failed_at <= options.addedBefore!
      );
    }

    // Sort
    const sortBy = options?.sortBy || "last_failed_at";
    const sortOrder = options?.sortOrder || "desc";
    records.sort((a, b) => {
      const aVal = a[sortBy] as number;
      const bVal = b[sortBy] as number;
      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });

    const total = records.length;
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    // Paginate
    records = records.slice(offset, offset + limit);

    return { records, total, limit, offset };
  }

  /**
   * Get statistics about bad numbers
   */
  getStats(): BadNumberStats {
    const records = Object.values(this.data.records);
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Count by time period
    const addedToday = records.filter(
      (r) => r.first_failed_at >= oneDayAgo
    ).length;
    const addedThisWeek = records.filter(
      (r) => r.first_failed_at >= oneWeekAgo
    ).length;
    const addedThisMonth = records.filter(
      (r) => r.first_failed_at >= oneMonthAgo
    ).length;

    // Group by error type
    const byErrorType: { [key: string]: number } = {};
    records.forEach((r) => {
      // Extract error type (simplified)
      let errorType = "other";
      const lowerError = r.error_message.toLowerCase();
      if (lowerError.includes("not found")) errorType = "number_not_found";
      else if (lowerError.includes("disconnected")) errorType = "disconnected";
      else if (lowerError.includes("invalid")) errorType = "invalid_number";
      else if (lowerError.includes("not in service"))
        errorType = "not_in_service";

      byErrorType[errorType] = (byErrorType[errorType] || 0) + 1;
    });

    // Get most recent
    const mostRecent = [...records]
      .sort((a, b) => b.last_failed_at - a.last_failed_at)
      .slice(0, 10);

    return {
      total_bad_numbers: records.length,
      added_today: addedToday,
      added_this_week: addedThisWeek,
      added_this_month: addedThisMonth,
      by_error_type: byErrorType,
      most_recent: mostRecent,
    };
  }

  /**
   * Export all bad numbers as CSV format
   */
  exportAsCSV(): string {
    const records = Object.values(this.data.records);
    const headers = [
      "phone_number",
      "lead_id",
      "lead_name",
      "list_id",
      "error_message",
      "first_failed_at",
      "last_failed_at",
      "failure_count",
      "source",
      "notes",
    ];

    const rows = records.map((r) => [
      r.phone_number,
      r.lead_id,
      r.lead_name || "",
      r.list_id || "",
      `"${r.error_message.replace(/"/g, '""')}"`,
      new Date(r.first_failed_at).toISOString(),
      new Date(r.last_failed_at).toISOString(),
      r.failure_count.toString(),
      r.source,
      r.notes || "",
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  /**
   * Bulk check: Returns which phone numbers from a list are bad
   */
  checkBulk(phoneNumbers: string[]): {
    bad: string[];
    good: string[];
  } {
    const bad: string[] = [];
    const good: string[] = [];

    phoneNumbers.forEach((phone) => {
      if (this.isBadNumber(phone)) {
        bad.push(phone);
      } else {
        good.push(phone);
      }
    });

    return { bad, good };
  }
}

// Export singleton instance
export const badNumbersService = new BadNumbersService();
