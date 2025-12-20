// ============================================================================
// Queue Processor Service
// Automatically processes queued calls every 30 minutes during business hours
// ============================================================================

import { schedulerService } from "./schedulerService";
import { logger } from "../utils/logger";
import { config } from "../config";

interface QueueProcessorConfig {
  enabled: boolean;
  intervalMinutes: number;
}

class QueueProcessorService {
  private intervalId: NodeJS.Timeout | null = null;
  private config: QueueProcessorConfig;
  private isProcessing: boolean = false;

  constructor() {
    // Load config from environment variables
    this.config = {
      enabled: config.queueProcessor.enabled,
      intervalMinutes: config.queueProcessor.intervalMinutes,
    };

    logger.info("Queue processor service initialized", {
      enabled: this.config.enabled,
      intervalMinutes: this.config.intervalMinutes,
    });

    // Auto-start queue processor if enabled
    if (this.config.enabled) {
      this.start();
    } else {
      logger.info("Queue processor auto-start disabled (use API to start manually)");
    }
  }

  /**
   * Start the queue processor
   */
  start(): void {
    if (this.intervalId) {
      logger.warn("Queue processor already running");
      return;
    }

    logger.info("Starting queue processor", {
      intervalMinutes: this.config.intervalMinutes,
    });

    // Run immediately on start (if active)
    this.processQueueIfActive();

    // Then run on configured interval
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    this.intervalId = setInterval(() => {
      this.processQueueIfActive();
    }, intervalMs);

    logger.info("Queue processor started", {
      nextCheckIn: `${this.config.intervalMinutes} minutes`,
    });
  }

  /**
   * Stop the queue processor
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Queue processor stopped");
    }
  }

  /**
   * Process queue if system is currently active (business hours)
   */
  private async processQueueIfActive(): Promise<void> {
    if (this.isProcessing) {
      logger.info("Queue processing already in progress, skipping");
      return;
    }

    // Check if system is currently active (within business hours)
    const isActive = schedulerService.isActive();

    if (!isActive) {
      logger.info("System inactive - skipping queue processing", {
        nextCheckIn: `${this.config.intervalMinutes} minutes`,
      });
      return;
    }

    // Check if there are items in queue
    const queueStats = schedulerService.getQueueStats();
    if (queueStats.total === 0) {
      logger.debug("Queue is empty - nothing to process");
      return;
    }

    try {
      this.isProcessing = true;

      logger.info("Processing queued requests", {
        queueSize: queueStats.total,
        calls: queueStats.calls,
        callbacks: queueStats.callbacks,
      });

      // Process the queue
      const result = await schedulerService.processQueue();

      logger.info("Queue processing completed", {
        total: result.total,
        processed: result.processed,
        failed: result.failed,
        remaining: result.remaining,
      });
    } catch (error: any) {
      logger.error("Queue processing failed", {
        error: error.message,
        stack: error.stack,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Force process queue immediately (for manual triggering via API)
   */
  async processNow(): Promise<{
    total: number;
    processed: number;
    failed: number;
    remaining: number;
  }> {
    logger.info("Manual queue processing triggered");

    if (this.isProcessing) {
      throw new Error("Queue processing already in progress");
    }

    const isActive = schedulerService.isActive();
    if (!isActive) {
      throw new Error("System is currently inactive (outside business hours)");
    }

    try {
      this.isProcessing = true;
      const result = await schedulerService.processQueue();
      logger.info("Manual queue processing completed", result);
      return result;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get processor status
   */
  getStatus(): {
    enabled: boolean;
    running: boolean;
    processing: boolean;
    intervalMinutes: number;
    systemActive: boolean;
    queueStats: any;
  } {
    return {
      enabled: this.config.enabled,
      running: this.intervalId !== null,
      processing: this.isProcessing,
      intervalMinutes: this.config.intervalMinutes,
      systemActive: schedulerService.isActive(),
      queueStats: schedulerService.getQueueStats(),
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): QueueProcessorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (runtime updates)
   */
  updateConfig(updates: Partial<QueueProcessorConfig>): QueueProcessorConfig {
    const wasEnabled = this.config.enabled;
    const oldInterval = this.config.intervalMinutes;

    this.config = { ...this.config, ...updates };

    // If enabled state changed
    if (updates.enabled !== undefined && updates.enabled !== wasEnabled) {
      if (this.config.enabled && !this.intervalId) {
        this.start();
      } else if (!this.config.enabled && this.intervalId) {
        this.stop();
      }
    }

    // If interval changed and processor is running, restart
    if (updates.intervalMinutes !== undefined &&
        updates.intervalMinutes !== oldInterval &&
        this.intervalId) {
      logger.info("Interval changed, restarting queue processor");
      this.stop();
      this.start();
    }

    logger.info("Queue processor config updated", { updates });
    return this.getConfig();
  }

  /**
   * Enable queue processor
   */
  setEnabled(enabled: boolean): void {
    this.updateConfig({ enabled });
  }
}

export const queueProcessorService = new QueueProcessorService();
