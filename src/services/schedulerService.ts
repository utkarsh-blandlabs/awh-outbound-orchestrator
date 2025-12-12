// ============================================================================
// Scheduler Service
// Controls when the orchestrator is active and queues requests when offline
// ============================================================================

import { logger } from "../utils/logger";
import fs from "fs";
import path from "path";

interface ScheduleConfig {
  enabled: boolean; // Master on/off switch
  callbacksEnabled: boolean; // Enable/disable callback processing
  timezone: string; // e.g., "America/New_York"
  schedule: {
    days: number[]; // 0=Sunday, 1=Monday, etc. Empty = all days
    startTime: string; // "09:00" (24-hour format)
    endTime: string; // "17:00" (24-hour format)
  };
}

interface QueuedRequest {
  id: string;
  timestamp: number;
  type: "call" | "callback";
  payload: any;
  retryCount: number;
}

class SchedulerService {
  private config!: ScheduleConfig;
  private queue: QueuedRequest[] = [];
  private configPath: string;

  constructor() {
    this.configPath = path.join(__dirname, "../../data/scheduler-config.json");
    this.loadConfig();
    this.loadQueue();
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf-8");
        this.config = JSON.parse(data);
        logger.info("Scheduler config loaded", this.config);
      } else {
        // Default configuration
        this.config = {
          enabled: true, // Enabled by default
          callbacksEnabled: true,
          timezone: "America/New_York",
          schedule: {
            days: [1, 2, 3, 4, 5], // Monday-Friday
            startTime: "09:00",
            endTime: "17:00",
          },
        };
        this.saveConfig();
        logger.info("Scheduler config initialized with defaults", this.config);
      }
    } catch (error: any) {
      logger.error("Failed to load scheduler config", { error: error.message });
      // Use defaults
      this.config = {
        enabled: true,
        callbacksEnabled: true,
        timezone: "America/New_York",
        schedule: {
          days: [1, 2, 3, 4, 5],
          startTime: "09:00",
          endTime: "17:00",
        },
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
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      logger.info("Scheduler config saved");
    } catch (error: any) {
      logger.error("Failed to save scheduler config", { error: error.message });
    }
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ScheduleConfig>): ScheduleConfig {
    this.config = {
      ...this.config,
      ...updates,
      schedule: {
        ...this.config.schedule,
        ...(updates.schedule || {}),
      },
    };
    this.saveConfig();
    logger.info("Scheduler config updated", this.config);
    return this.config;
  }

  /**
   * Get current configuration
   */
  getConfig(): ScheduleConfig {
    return { ...this.config };
  }

  /**
   * Check if system is currently active based on schedule
   */
  isActive(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    try {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        timeZone: this.config.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        weekday: "short",
      };

      const formatter = new Intl.DateTimeFormat("en-US", options);
      const parts = formatter.formatToParts(now);

      // Get current day (0=Sunday, 1=Monday, etc.)
      const dayName = parts.find((p) => p.type === "weekday")?.value;
      const dayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const currentDay = dayName ? (dayMap[dayName] ?? now.getDay()) : now.getDay();

      // Check if current day is in allowed days (empty = all days)
      if (
        this.config.schedule.days.length > 0 &&
        !this.config.schedule.days.includes(currentDay)
      ) {
        return false;
      }

      // Get current time in configured timezone
      const hour = parts.find((p) => p.type === "hour")?.value || "00";
      const minute = parts.find((p) => p.type === "minute")?.value || "00";
      const currentTime = `${hour}:${minute}`;

      // Check if current time is within schedule
      const isWithinTime =
        currentTime >= this.config.schedule.startTime &&
        currentTime <= this.config.schedule.endTime;

      return isWithinTime;
    } catch (error: any) {
      logger.error("Error checking schedule", { error: error.message });
      // Default to enabled on error
      return this.config.enabled;
    }
  }

  /**
   * Check if callbacks are enabled
   */
  areCallbacksEnabled(): boolean {
    return this.config.callbacksEnabled;
  }

  /**
   * Add request to queue when system is inactive
   */
  queueRequest(type: "call" | "callback", payload: any): string {
    const id = `queue_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const request: QueuedRequest = {
      id,
      timestamp: Date.now(),
      type,
      payload,
      retryCount: 0,
    };

    this.queue.push(request);
    this.saveQueue();

    logger.info("Request queued", {
      id,
      type,
      queue_size: this.queue.length,
    });

    return id;
  }

  /**
   * Get all queued requests
   */
  getQueue(): QueuedRequest[] {
    return [...this.queue];
  }

  /**
   * Get queue statistics
   */
  getQueueStats() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    return {
      total: this.queue.length,
      calls: this.queue.filter((r) => r.type === "call").length,
      callbacks: this.queue.filter((r) => r.type === "callback").length,
      recent: this.queue.filter((r) => r.timestamp > oneHourAgo).length,
      oldest:
        this.queue.length > 0
          ? new Date(Math.min(...this.queue.map((r) => r.timestamp))).toISOString()
          : null,
    };
  }

  /**
   * Process queue (called when system becomes active)
   */
  async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    logger.info("Processing queued requests", { count: this.queue.length });

    const toProcess = [...this.queue];
    this.queue = [];
    this.saveQueue();

    // Import handleAwhOutbound dynamically to avoid circular dependency
    const { handleAwhOutbound } = await import("../logic/awhOrchestrator");

    let processed = 0;
    let failed = 0;

    for (const request of toProcess) {
      try {
        logger.info("Processing queued request", {
          queue_id: request.id,
          type: request.type,
          phone: request.payload.phone_number,
        });

        const result = await handleAwhOutbound(
          request.payload,
          `queued_${request.id}`
        );

        if (result.success) {
          processed++;
        } else {
          failed++;
          logger.error("Failed to process queued request", {
            queue_id: request.id,
            error: result.error,
          });
        }

        // Add delay between calls to respect rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error: any) {
        failed++;
        logger.error("Error processing queued request", {
          queue_id: request.id,
          error: error.message,
        });
      }
    }

    logger.info("Queue processing completed", {
      total: toProcess.length,
      processed,
      failed,
    });
  }

  /**
   * Clear queue
   */
  clearQueue(): number {
    const count = this.queue.length;
    this.queue = [];
    this.saveQueue();
    logger.info("Queue cleared", { cleared: count });
    return count;
  }

  /**
   * Save queue to file
   */
  private saveQueue(): void {
    try {
      const queuePath = path.join(__dirname, "../../data/request-queue.json");
      const dir = path.dirname(queuePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(queuePath, JSON.stringify(this.queue, null, 2));
    } catch (error: any) {
      logger.error("Failed to save queue", { error: error.message });
    }
  }

  /**
   * Load queue from file
   */
  private loadQueue(): void {
    try {
      const queuePath = path.join(__dirname, "../../data/request-queue.json");
      if (fs.existsSync(queuePath)) {
        const data = fs.readFileSync(queuePath, "utf-8");
        this.queue = JSON.parse(data);
        logger.info("Queue loaded", { count: this.queue.length });
      }
    } catch (error: any) {
      logger.error("Failed to load queue", { error: error.message });
      this.queue = [];
    }
  }
}

export const schedulerService = new SchedulerService();
export { ScheduleConfig, QueuedRequest };