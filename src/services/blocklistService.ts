import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

/**
 * Normalize phone number to consistent format (10 digits)
 * Removes +1, spaces, dashes, parentheses, etc.
 * Example: "+1 (561) 956-5858" -> "5619565858"
 */
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // If starts with 1 and has 11 digits, remove the leading 1 (US country code)
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.substring(1);
  }

  // Return as-is if already 10 digits, or if invalid length
  return digits;
}

/**
 * Blocklist Flag
 * Represents a rule to block calls based on field/value match
 */
interface BlocklistFlag {
  id: string; // Unique ID for the flag
  field: string; // Field name to check (e.g., "phone", "lead_id", "email")
  value: string; // Value to match (e.g., "3055551234")
  reason?: string; // Optional reason for blocking
  added_at: string; // ISO timestamp when flag was added
  added_by?: string; // Optional: who added this flag
}

/**
 * Blocklist Configuration
 */
interface BlocklistConfig {
  enabled: boolean;
  flags: BlocklistFlag[];
}

/**
 * Blocklist Attempt Record
 * Tracks when a blocked value was attempted to be called
 */
interface BlocklistAttempt {
  timestamp: string; // ISO timestamp
  field: string; // Field that was blocked (e.g., "phone")
  value: string; // Value that was blocked (e.g., "3055551234")
  lead_id?: string; // Lead ID if available
  phone?: string; // Phone number if available
  blocked: boolean; // true if blocked, false if allowed
  reason?: string; // Reason for blocking
  flag_id?: string; // ID of the flag that caused the block
}

/**
 * Daily Attempt Statistics
 */
interface DailyAttempts {
  [date: string]: BlocklistAttempt[];
}

/**
 * Blocklist Service
 * Manages dynamic flags to prevent calling specific numbers/leads
 * Checks happen BEFORE calling Bland AI to avoid wasting API calls
 */
class BlocklistService {
  private configPath: string;
  private attemptsDir: string;
  private config: BlocklistConfig = { enabled: true, flags: [] };

  constructor() {
    this.configPath = path.join(
      process.cwd(),
      "data",
      "blocklist-config.json"
    );
    this.attemptsDir = path.join(process.cwd(), "data", "blocklist-attempts");

    this.ensureDirectories();
    this.loadConfig();
  }

  private ensureDirectories(): void {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.attemptsDir)) {
      fs.mkdirSync(this.attemptsDir, { recursive: true });
    }
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf8");
        this.config = JSON.parse(data);
        logger.info("Blocklist config loaded", {
          flags_count: this.config.flags.length,
        });
      } else {
        // Create default config
        this.config = {
          enabled: true,
          flags: [],
        };
        this.saveConfig();
        logger.info("Created default blocklist config");
      }
    } catch (error) {
      logger.error("Failed to load blocklist config", { error });
      this.config = {
        enabled: true,
        flags: [],
      };
    }
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        "utf8"
      );
      logger.info("Blocklist config saved", {
        flags_count: this.config.flags.length,
      });
    } catch (error) {
      logger.error("Failed to save blocklist config", { error });
    }
  }

  private getTodayDate(): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date()); // Returns YYYY-MM-DD in EST
  }

  private getAttemptsFilePath(date: string): string {
    return path.join(this.attemptsDir, `attempts_${date}.json`);
  }

  private loadAttempts(date: string): BlocklistAttempt[] {
    try {
      const filePath = this.getAttemptsFilePath(date);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      logger.error("Failed to load blocklist attempts", { date, error });
      return [];
    }
  }

  private saveAttempts(date: string, attempts: BlocklistAttempt[]): void {
    try {
      const filePath = this.getAttemptsFilePath(date);
      fs.writeFileSync(filePath, JSON.stringify(attempts, null, 2), "utf8");
    } catch (error) {
      logger.error("Failed to save blocklist attempts", { date, error });
    }
  }

  private recordAttempt(attempt: BlocklistAttempt): void {
    const today = this.getTodayDate();
    const attempts = this.loadAttempts(today);
    attempts.push(attempt);
    this.saveAttempts(today, attempts);
  }

  /**
   * Check if a lead should be blocked based on current flags
   * This is called BEFORE calling Bland AI to avoid wasting API calls
   */
  public shouldBlock(leadData: {
    lead_id?: string;
    phone?: string;
    [key: string]: any;
  }): { blocked: boolean; reason?: string; flag?: BlocklistFlag } {
    if (!this.config.enabled) {
      return { blocked: false };
    }

    // Check each flag
    for (const flag of this.config.flags) {
      let fieldValue = leadData[flag.field];

      // Normalize phone numbers for comparison (both incoming and stored)
      if (flag.field === "phone" || flag.field === "phone_number") {
        if (fieldValue) {
          fieldValue = normalizePhoneNumber(fieldValue.toString());
        }
        // Also compare with normalized flag value
        const normalizedFlagValue = normalizePhoneNumber(flag.value);

        if (fieldValue && fieldValue === normalizedFlagValue) {
          // Match found - this lead should be blocked
          const reason =
            flag.reason || `Blocked by flag: ${flag.field}=${flag.value}`;

          // Record the blocked attempt
          this.recordAttempt({
            timestamp: new Date().toISOString(),
            field: flag.field,
            value: flag.value,
            lead_id: leadData.lead_id,
            phone: leadData.phone,
            blocked: true,
            reason,
            flag_id: flag.id,
          });

          logger.info("Lead blocked by blocklist flag", {
            field: flag.field,
            value: flag.value,
            lead_id: leadData.lead_id,
            phone: leadData.phone,
            reason,
          });

          return { blocked: true, reason, flag };
        }
      } else {
        // Non-phone fields: exact match
        if (fieldValue && fieldValue.toString() === flag.value) {
          // Match found - this lead should be blocked
          const reason =
            flag.reason || `Blocked by flag: ${flag.field}=${flag.value}`;

          // Record the blocked attempt
          this.recordAttempt({
            timestamp: new Date().toISOString(),
            field: flag.field,
            value: flag.value,
            lead_id: leadData.lead_id,
            phone: leadData.phone,
            blocked: true,
            reason,
            flag_id: flag.id,
          });

          logger.info("Lead blocked by blocklist flag", {
            field: flag.field,
            value: flag.value,
            lead_id: leadData.lead_id,
            phone: leadData.phone,
            reason,
          });

          return { blocked: true, reason, flag };
        }
      }
    }

    // No match - allow the call
    return { blocked: false };
  }

  /**
   * Add a new blocklist flag
   * Phone numbers are automatically normalized to 10 digits
   */
  public addFlag(
    field: string,
    value: string,
    reason?: string,
    added_by?: string
  ): BlocklistFlag {
    // Normalize phone numbers before storing
    let normalizedValue = value;
    if (field === "phone" || field === "phone_number") {
      normalizedValue = normalizePhoneNumber(value);
      logger.info("Phone number normalized for blocklist", {
        original: value,
        normalized: normalizedValue,
      });
    }

    const flag: BlocklistFlag = {
      id: `flag_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      field,
      value: normalizedValue,
      reason,
      added_at: new Date().toISOString(),
      added_by,
    };

    this.config.flags.push(flag);
    this.saveConfig();

    logger.info("Blocklist flag added", {
      id: flag.id,
      field,
      value: normalizedValue,
      original_value: value !== normalizedValue ? value : undefined,
      reason,
    });

    return flag;
  }

  /**
   * Remove a blocklist flag by ID
   */
  public removeFlag(flagId: string): boolean {
    const index = this.config.flags.findIndex((f) => f.id === flagId);

    if (index !== -1) {
      const removed = this.config.flags.splice(index, 1)[0];
      this.saveConfig();

      if (removed) {
        logger.info("Blocklist flag removed", {
          id: flagId,
          field: removed.field,
          value: removed.value,
        });
      }

      return true;
    }

    return false;
  }

  /**
   * Get all blocklist flags
   */
  public getFlags(): BlocklistFlag[] {
    return this.config.flags;
  }

  /**
   * Get blocklist configuration
   */
  public getConfig(): BlocklistConfig {
    return this.config;
  }

  /**
   * Update blocklist enabled status
   */
  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.saveConfig();
    logger.info("Blocklist enabled status updated", { enabled });
  }

  /**
   * Get attempts for a specific date
   */
  public getAttempts(date: string): BlocklistAttempt[] {
    return this.loadAttempts(date);
  }

  /**
   * Get attempts for today
   */
  public getTodayAttempts(): BlocklistAttempt[] {
    const today = this.getTodayDate();
    return this.loadAttempts(today);
  }

  /**
   * Get attempt statistics for a date range
   */
  public getAttemptStatistics(startDate: string, endDate: string): {
    total_attempts: number;
    blocked_attempts: number;
    by_flag: {
      [flagId: string]: {
        flag: BlocklistFlag | undefined;
        count: number;
        dates: { [date: string]: number };
      };
    };
    by_field: {
      [field: string]: {
        count: number;
        values: { [value: string]: number };
      };
    };
  } {
    const stats = {
      total_attempts: 0,
      blocked_attempts: 0,
      by_flag: {} as any,
      by_field: {} as any,
    };

    // Get all dates in range
    const dates = this.getDateRange(startDate, endDate);

    for (const date of dates) {
      const attempts = this.loadAttempts(date);

      for (const attempt of attempts) {
        stats.total_attempts++;

        if (attempt.blocked) {
          stats.blocked_attempts++;

          // Track by flag
          if (attempt.flag_id) {
            if (!stats.by_flag[attempt.flag_id]) {
              const flag = this.config.flags.find(
                (f) => f.id === attempt.flag_id
              );
              stats.by_flag[attempt.flag_id] = {
                flag,
                count: 0,
                dates: {},
              };
            }
            stats.by_flag[attempt.flag_id].count++;
            stats.by_flag[attempt.flag_id].dates[date] =
              (stats.by_flag[attempt.flag_id].dates[date] || 0) + 1;
          }

          // Track by field
          if (!stats.by_field[attempt.field]) {
            stats.by_field[attempt.field] = {
              count: 0,
              values: {},
            };
          }
          stats.by_field[attempt.field].count++;
          stats.by_field[attempt.field].values[attempt.value] =
            (stats.by_field[attempt.field].values[attempt.value] || 0) + 1;
        }
      }
    }

    return stats;
  }

  /**
   * Get all dates in range (inclusive)
   */
  private getDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (
      let date = new Date(start);
      date <= end;
      date.setDate(date.getDate() + 1)
    ) {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      dates.push(formatter.format(date));
    }

    return dates;
  }
}

export const blocklistService = new BlocklistService();
