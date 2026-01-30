// ============================================================================
// Number Pool Service
// Intelligent number rotation with performance tracking and lead mapping
// ============================================================================

import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";
import { CallOutcome } from "../types/awh";

// ============================================================================
// Types
// ============================================================================

interface CallRecord {
  timestamp: number;
  outcome: string;
  phone_number: string;
  lead_id: string;
}

interface NumberStats {
  total_calls: number;
  pickups: number;
  pickup_rate: number;
  voicemails: number;
  no_answers: number;
  failures: number;
  failure_streak: number;
  last_call_at: number;
  last_pickup_at: number;
}

interface NumberPerformance {
  number: string;
  calls: CallRecord[];
  stats: NumberStats;
  cooldown_until: number | null;
}

interface LeadNumberMapping {
  lead_id: string;
  phone_number: string;
  preferred_number: string | null;
  area_code_match: string | null;
  last_successful_from: string | null;
  call_count: number;
  last_call_at: number;
}

// Outcomes that count as a "pickup" (human was reached)
const PICKUP_OUTCOMES = new Set([
  CallOutcome.TRANSFERRED,
  CallOutcome.CALLBACK,
  CallOutcome.CONFUSED,
  CallOutcome.SALE,
  CallOutcome.NOT_INTERESTED,
]);

// ============================================================================
// Number Pool Service
// ============================================================================

class NumberPoolService {
  private dataDir: string;
  private performanceFile: string;
  private mappingsFile: string;
  private performance: Map<string, NumberPerformance> = new Map();
  private leadMappings: Map<string, LeadNumberMapping> = new Map();
  private persistInterval: ReturnType<typeof setInterval> | null = null;
  private rollingWindowMs: number;
  private cooldownThreshold: number;
  private cooldownMinutes: number;
  private mappingExpiryDays: number;

  constructor() {
    this.dataDir = path.join(process.cwd(), "data", "number-pool");
    this.performanceFile = path.join(this.dataDir, "performance.json");
    this.mappingsFile = path.join(this.dataDir, "lead-mappings.json");

    // Config with defaults
    this.rollingWindowMs =
      parseInt(process.env["NUMBER_POOL_ROLLING_WINDOW_HOURS"] || "48") *
      60 *
      60 *
      1000;
    this.cooldownThreshold = parseInt(
      process.env["NUMBER_POOL_COOLDOWN_THRESHOLD"] || "5"
    );
    this.cooldownMinutes = parseInt(
      process.env["NUMBER_POOL_COOLDOWN_MINUTES"] || "5"
    );
    this.mappingExpiryDays = parseInt(
      process.env["NUMBER_POOL_MAPPING_EXPIRY_DAYS"] || "30"
    );

    this.ensureDirectories();
    this.loadPerformance();
    this.loadMappings();
    this.initializePoolNumbers();

    // Persist every 60 seconds
    this.persistInterval = setInterval(() => {
      this.savePerformance();
      this.saveMappings();
    }, 60000);

    logger.info("NumberPoolService initialized", {
      pool_size: config.bland.fromPool.length,
      rolling_window_hours: this.rollingWindowMs / (60 * 60 * 1000),
      cooldown_threshold: this.cooldownThreshold,
      cooldown_minutes: this.cooldownMinutes,
      mapping_expiry_days: this.mappingExpiryDays,
    });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info("Created number-pool data directory", { path: this.dataDir });
    }
  }

  /**
   * Ensure all pool numbers have performance entries
   */
  private initializePoolNumbers(): void {
    for (const number of config.bland.fromPool) {
      if (!this.performance.has(number)) {
        this.performance.set(number, this.createEmptyPerformance(number));
      }
    }
  }

  private createEmptyPerformance(number: string): NumberPerformance {
    return {
      number,
      calls: [],
      stats: {
        total_calls: 0,
        pickups: 0,
        pickup_rate: 0,
        voicemails: 0,
        no_answers: 0,
        failures: 0,
        failure_streak: 0,
        last_call_at: 0,
        last_pickup_at: 0,
      },
      cooldown_until: null,
    };
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private loadPerformance(): void {
    try {
      if (fs.existsSync(this.performanceFile)) {
        const data = fs.readFileSync(this.performanceFile, "utf-8");
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            this.performance.set(entry.number, entry);
          }
          logger.info("Loaded number pool performance data", {
            count: this.performance.size,
          });
        }
      }
    } catch (error: any) {
      logger.error("Failed to load number pool performance", {
        error: error.message,
      });
    }
  }

  private loadMappings(): void {
    try {
      if (fs.existsSync(this.mappingsFile)) {
        const data = fs.readFileSync(this.mappingsFile, "utf-8");
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            const key = `${entry.lead_id}:${entry.phone_number}`;
            this.leadMappings.set(key, entry);
          }
          logger.info("Loaded lead-number mappings", {
            count: this.leadMappings.size,
          });
        }
      }
    } catch (error: any) {
      logger.error("Failed to load lead-number mappings", {
        error: error.message,
      });
    }
  }

  private savePerformance(): void {
    try {
      // Prune old call records before saving
      this.pruneOldRecords();

      const data = Array.from(this.performance.values());
      const tempPath = `${this.performanceFile}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tempPath, this.performanceFile);
    } catch (error: any) {
      logger.error("Failed to save number pool performance", {
        error: error.message,
      });
      try {
        const tempPath = `${this.performanceFile}.tmp`;
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) {
        // ignore cleanup errors
      }
    }
  }

  private saveMappings(): void {
    try {
      // Prune expired mappings before saving
      this.pruneExpiredMappings();

      const data = Array.from(this.leadMappings.values());
      const tempPath = `${this.mappingsFile}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tempPath, this.mappingsFile);
    } catch (error: any) {
      logger.error("Failed to save lead-number mappings", {
        error: error.message,
      });
      try {
        const tempPath = `${this.mappingsFile}.tmp`;
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) {
        // ignore cleanup errors
      }
    }
  }

  private pruneOldRecords(): void {
    const cutoff = Date.now() - this.rollingWindowMs;
    for (const [, perf] of this.performance) {
      perf.calls = perf.calls.filter((c) => c.timestamp > cutoff);
      this.recalculateStats(perf);
    }
  }

  private pruneExpiredMappings(): void {
    const expiryMs = this.mappingExpiryDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - expiryMs;
    for (const [key, mapping] of this.leadMappings) {
      if (mapping.last_call_at < cutoff) {
        this.leadMappings.delete(key);
      }
    }
  }

  // ============================================================================
  // Stats Calculation
  // ============================================================================

  private recalculateStats(perf: NumberPerformance): void {
    const calls = perf.calls;
    let pickups = 0;
    let voicemails = 0;
    let noAnswers = 0;
    let failures = 0;
    let lastCallAt = 0;
    let lastPickupAt = 0;

    for (const call of calls) {
      if (call.timestamp > lastCallAt) lastCallAt = call.timestamp;

      if (PICKUP_OUTCOMES.has(call.outcome as CallOutcome)) {
        pickups++;
        if (call.timestamp > lastPickupAt) lastPickupAt = call.timestamp;
      } else if (call.outcome === CallOutcome.VOICEMAIL) {
        voicemails++;
      } else if (call.outcome === CallOutcome.NO_ANSWER) {
        noAnswers++;
      } else if (call.outcome === CallOutcome.FAILED) {
        failures++;
      }
    }

    // Calculate failure streak from most recent calls
    let failureStreak = 0;
    const sortedCalls = [...calls].sort((a, b) => b.timestamp - a.timestamp);
    for (const call of sortedCalls) {
      if (PICKUP_OUTCOMES.has(call.outcome as CallOutcome)) {
        break;
      }
      failureStreak++;
    }

    perf.stats = {
      total_calls: calls.length,
      pickups,
      pickup_rate: calls.length > 0 ? pickups / calls.length : 0,
      voicemails,
      no_answers: noAnswers,
      failures,
      failure_streak: failureStreak,
      last_call_at: lastCallAt,
      last_pickup_at: lastPickupAt,
    };
  }

  // ============================================================================
  // Number Selection (Phase 1 + Phase 2)
  // ============================================================================

  /**
   * Select the best number for making an outbound call.
   * Phase 1: Weighted selection based on performance
   * Phase 2: Lead-number mapping with area code matching
   */
  selectNumber(leadId?: string, phoneNumber?: string): string {
    const pool = config.bland.fromPool;
    if (pool.length === 0) {
      return config.bland.from;
    }

    const now = Date.now();

    // Phase 2: Check lead mapping first
    if (leadId && phoneNumber) {
      const mappingKey = `${leadId}:${phoneNumber}`;
      const mapping = this.leadMappings.get(mappingKey);

      if (mapping) {
        // Try last successful number first
        if (mapping.last_successful_from && pool.includes(mapping.last_successful_from)) {
          const perf = this.performance.get(mapping.last_successful_from);
          if (!perf || !perf.cooldown_until || perf.cooldown_until < now) {
            logger.info("Using last successful number for lead", {
              lead_id: leadId,
              number: mapping.last_successful_from,
              reason: "last_successful",
            });
            return mapping.last_successful_from;
          }
        }
      }

      // Try area code match
      const areaCode = this.extractAreaCode(phoneNumber);
      if (areaCode) {
        const areaCodeMatches = pool.filter((n) => {
          const nArea = this.extractAreaCode(n);
          return nArea === areaCode;
        });

        if (areaCodeMatches.length > 0) {
          // Filter out cooldown numbers
          const available = areaCodeMatches.filter((n) => {
            const perf = this.performance.get(n);
            return !perf || !perf.cooldown_until || perf.cooldown_until < now;
          });

          if (available.length > 0) {
            // Pick the best-performing area code match
            const best = this.selectWeighted(available, now);
            if (best) {
              logger.info("Using area code matched number for lead", {
                lead_id: leadId,
                number: best,
                area_code: areaCode,
                reason: "area_code_match",
              });

              // Update mapping with area code match
              this.updateMapping(leadId, phoneNumber, {
                area_code_match: best,
              });

              return best;
            }
          }
        }
      }
    }

    // Phase 1: Weighted selection from all available numbers
    const availableNumbers = pool.filter((n) => {
      const perf = this.performance.get(n);
      return !perf || !perf.cooldown_until || perf.cooldown_until < now;
    });

    if (availableNumbers.length === 0) {
      // All on cooldown - pick highest historical pickup rate
      logger.warn("All numbers on cooldown, using best historical performer");
      return this.getBestHistoricalNumber(pool);
    }

    const selected = this.selectWeighted(availableNumbers, now);
    if (selected) {
      return selected;
    }

    // Fallback to first available
    return availableNumbers[0] || pool[0] || config.bland.from;
  }

  /**
   * Weighted random selection based on performance
   */
  private selectWeighted(numbers: string[], now: number): string | null {
    if (numbers.length === 0) return null;
    if (numbers.length === 1) return numbers[0] || null;

    // Calculate total calls across all pool numbers for balance scoring
    let totalPoolCalls = 0;
    for (const n of config.bland.fromPool) {
      const perf = this.performance.get(n);
      if (perf) totalPoolCalls += perf.stats.total_calls;
    }
    const avgCalls =
      config.bland.fromPool.length > 0
        ? totalPoolCalls / config.bland.fromPool.length
        : 0;

    const weights: { number: string; weight: number }[] = [];

    for (const number of numbers) {
      const perf = this.performance.get(number);

      // Base weight: pickup rate (default 0.5 for new/low-data numbers)
      let weight: number;
      if (!perf || perf.stats.total_calls < 10) {
        weight = 0.5;
      } else {
        weight = perf.stats.pickup_rate;
      }

      // Ensure minimum weight so no number is completely excluded
      weight = Math.max(weight, 0.05);

      if (perf) {
        // Penalty for failure streaks
        if (perf.stats.failure_streak >= 3) {
          weight *= Math.pow(0.5, perf.stats.failure_streak / 3);
        }

        // Balance bonus: numbers with fewer calls get a boost
        if (avgCalls > 0 && perf.stats.total_calls < avgCalls) {
          weight *= 1.2;
        }
      } else {
        // New number with no data gets a slight boost to gather data
        weight *= 1.3;
      }

      weights.push({ number, weight });
    }

    // Weighted random selection
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight === 0) return numbers[0] || null;

    let random = Math.random() * totalWeight;
    for (const w of weights) {
      random -= w.weight;
      if (random <= 0) {
        return w.number;
      }
    }

    return weights[weights.length - 1]?.number || null;
  }

  private getBestHistoricalNumber(pool: string[]): string {
    let bestNumber = pool[0] || config.bland.from;
    let bestRate = -1;

    for (const number of pool) {
      const perf = this.performance.get(number);
      if (perf && perf.stats.pickup_rate > bestRate) {
        bestRate = perf.stats.pickup_rate;
        bestNumber = number;
      }
    }

    return bestNumber;
  }

  // ============================================================================
  // Outcome Recording
  // ============================================================================

  /**
   * Record a call outcome for a pool number.
   * Called from blandWebhook after call completion.
   */
  recordOutcome(
    fromNumber: string | undefined,
    outcome: string,
    phoneNumber: string,
    leadId: string
  ): void {
    if (!fromNumber) return;

    // Ensure performance entry exists
    if (!this.performance.has(fromNumber)) {
      this.performance.set(fromNumber, this.createEmptyPerformance(fromNumber));
    }

    const perf = this.performance.get(fromNumber)!;
    const now = Date.now();

    // Add call record
    perf.calls.push({
      timestamp: now,
      outcome,
      phone_number: phoneNumber,
      lead_id: leadId,
    });

    // Limit in-memory call records to prevent unbounded growth
    if (perf.calls.length > 5000) {
      perf.calls = perf.calls.slice(-3000);
    }

    // Recalculate stats
    this.recalculateStats(perf);

    // Check cooldown trigger
    this.checkCooldown(perf, now);

    // Update lead mapping
    const isPickup = PICKUP_OUTCOMES.has(outcome as CallOutcome);
    this.updateMapping(leadId, phoneNumber, {
      last_call_from: fromNumber,
      was_pickup: isPickup,
    });

    logger.info("Number pool outcome recorded", {
      from_number: fromNumber,
      outcome,
      phone_number: phoneNumber,
      lead_id: leadId,
      pickup_rate: perf.stats.pickup_rate.toFixed(3),
      failure_streak: perf.stats.failure_streak,
      on_cooldown: !!perf.cooldown_until && perf.cooldown_until > now,
    });
  }

  private checkCooldown(perf: NumberPerformance, now: number): void {
    if (perf.stats.failure_streak < this.cooldownThreshold) {
      return;
    }

    // SAFEGUARD: Never cooldown the last available number.
    // Count how many pool numbers are currently NOT on cooldown.
    const pool = config.bland.fromPool;
    const availableCount = pool.filter((n) => {
      if (n === perf.number) return false; // exclude the one we're about to cooldown
      const p = this.performance.get(n);
      return !p || !p.cooldown_until || p.cooldown_until < now;
    }).length;

    if (availableCount === 0) {
      // This is the LAST available number — don't cooldown, just log a warning
      logger.warn("Skipping cooldown — last available number in pool", {
        number: perf.number,
        failure_streak: perf.stats.failure_streak,
        pool_size: pool.length,
        note: "At least one number must remain available",
      });
      return;
    }

    if (perf.stats.failure_streak >= this.cooldownThreshold * 2) {
      // Extended cooldown for severe failure streak
      perf.cooldown_until = now + this.cooldownMinutes * 3 * 60 * 1000;
      logger.warn("Number placed on extended cooldown", {
        number: perf.number,
        failure_streak: perf.stats.failure_streak,
        cooldown_minutes: this.cooldownMinutes * 3,
        available_numbers_remaining: availableCount,
      });
    } else {
      perf.cooldown_until = now + this.cooldownMinutes * 60 * 1000;
      logger.warn("Number placed on cooldown", {
        number: perf.number,
        failure_streak: perf.stats.failure_streak,
        cooldown_minutes: this.cooldownMinutes,
        available_numbers_remaining: availableCount,
      });
    }
  }

  // ============================================================================
  // Lead Mapping (Phase 2)
  // ============================================================================

  private extractAreaCode(phoneNumber: string): string | null {
    // Strip everything except digits
    const digits = phoneNumber.replace(/\D/g, "");
    // Handle +1XXXXXXXXXX or 1XXXXXXXXXX or XXXXXXXXXX
    if (digits.length === 11 && digits.startsWith("1")) {
      return digits.substring(1, 4);
    }
    if (digits.length === 10) {
      return digits.substring(0, 3);
    }
    return null;
  }

  private updateMapping(
    leadId: string,
    phoneNumber: string,
    update: {
      last_call_from?: string;
      was_pickup?: boolean;
      area_code_match?: string;
    }
  ): void {
    const key = `${leadId}:${phoneNumber}`;
    let mapping = this.leadMappings.get(key);

    if (!mapping) {
      mapping = {
        lead_id: leadId,
        phone_number: phoneNumber,
        preferred_number: null,
        area_code_match: update.area_code_match || null,
        last_successful_from: null,
        call_count: 0,
        last_call_at: Date.now(),
      };
    }

    mapping.last_call_at = Date.now();
    mapping.call_count++;

    if (update.area_code_match) {
      mapping.area_code_match = update.area_code_match;
    }

    if (update.was_pickup && update.last_call_from) {
      mapping.last_successful_from = update.last_call_from;
      mapping.preferred_number = update.last_call_from;
    }

    this.leadMappings.set(key, mapping);
  }

  // ============================================================================
  // API Methods
  // ============================================================================

  /**
   * Get full pool status for API/UI
   */
  getPoolStatus(): {
    pool_size: number;
    strategy: string;
    numbers: Array<{
      number: string;
      formatted: string;
      stats: NumberStats;
      on_cooldown: boolean;
      cooldown_remaining_seconds: number | null;
    }>;
    total_mappings: number;
  } {
    const now = Date.now();
    const numbers = config.bland.fromPool.map((number) => {
      const perf = this.performance.get(number) ||
        this.createEmptyPerformance(number);

      const onCooldown = !!perf.cooldown_until && perf.cooldown_until > now;
      const cooldownRemaining = onCooldown && perf.cooldown_until
        ? Math.ceil((perf.cooldown_until - now) / 1000)
        : null;

      return {
        number,
        formatted: this.formatPhoneNumber(number),
        stats: { ...perf.stats },
        on_cooldown: onCooldown,
        cooldown_remaining_seconds: cooldownRemaining,
      };
    });

    return {
      pool_size: config.bland.fromPool.length,
      strategy: "weighted",
      numbers,
      total_mappings: this.leadMappings.size,
    };
  }

  /**
   * Get detailed stats for a single number
   */
  getNumberStats(
    number: string
  ): {
    number: string;
    formatted: string;
    stats: NumberStats;
    on_cooldown: boolean;
    cooldown_remaining_seconds: number | null;
    recent_calls: CallRecord[];
  } | null {
    const perf = this.performance.get(number);
    if (!perf) return null;

    const now = Date.now();
    const onCooldown = !!perf.cooldown_until && perf.cooldown_until > now;

    return {
      number,
      formatted: this.formatPhoneNumber(number),
      stats: { ...perf.stats },
      on_cooldown: onCooldown,
      cooldown_remaining_seconds:
        onCooldown && perf.cooldown_until
          ? Math.ceil((perf.cooldown_until - now) / 1000)
          : null,
      recent_calls: perf.calls.slice(-50),
    };
  }

  /**
   * Get lead-number mappings (paginated)
   */
  getLeadMappings(
    limit: number = 100,
    offset: number = 0
  ): {
    total: number;
    mappings: LeadNumberMapping[];
  } {
    const allMappings = Array.from(this.leadMappings.values()).sort(
      (a, b) => b.last_call_at - a.last_call_at
    );

    return {
      total: allMappings.length,
      mappings: allMappings.slice(offset, offset + limit),
    };
  }

  /**
   * Clear all cooldowns manually
   */
  clearAllCooldowns(): number {
    let cleared = 0;
    for (const [, perf] of this.performance) {
      if (perf.cooldown_until) {
        perf.cooldown_until = null;
        cleared++;
      }
    }
    if (cleared > 0) {
      this.savePerformance();
      logger.info("Cleared all cooldowns", { cleared });
    }
    return cleared;
  }

  /**
   * Reset all performance data
   */
  resetAll(): void {
    this.performance.clear();
    this.leadMappings.clear();
    this.initializePoolNumbers();
    this.savePerformance();
    this.saveMappings();
    logger.info("Number pool data reset");
  }

  /**
   * Stop the service (for graceful shutdown)
   */
  stop(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }
    // Final save
    this.savePerformance();
    this.saveMappings();
    logger.info("NumberPoolService stopped");
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private formatPhoneNumber(number: string): string {
    const digits = number.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      return `(${digits.substring(1, 4)}) ${digits.substring(4, 7)}-${digits.substring(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
    }
    return number;
  }
}

export const numberPoolService = new NumberPoolService();
