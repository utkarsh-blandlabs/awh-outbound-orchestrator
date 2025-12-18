// ============================================================================
// Convoso Polling Service
// Polls Convoso API for lead status updates and triggers autonomous calling
// ============================================================================

import { convosoService } from "./convosoService";
import { logger } from "../utils/logger";
import { handleAwhOutbound } from "../logic/awhOrchestrator";
import { ConvosoWebhookPayload } from "../types/awh";

interface PollingConfig {
  enabled: boolean;
  intervalMinutes: number; // How often to poll (20-30 minutes)
  batchSize: number; // How many leads to process per cycle (25)
  maxCallAttemptsPerDay: number; // Max attempts before stopping (4)
}

class ConvosoPollingService {
  private config: PollingConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;

  constructor() {
    // Default configuration
    this.config = {
      enabled: false, // Disabled by default - turn on when ready for Dec 22nd
      intervalMinutes: 30, // Poll every 30 minutes
      batchSize: 25, // Process 25 leads per cycle
      maxCallAttemptsPerDay: 4, // Max 4 attempts per lead per day
    };

    logger.info("Convoso polling service initialized", {
      config: this.config,
    });
  }

  /**
   * Start polling Convoso for leads
   */
  start(): void {
    if (!this.config.enabled) {
      logger.warn("Polling service is disabled in config");
      return;
    }

    if (this.intervalId) {
      logger.warn("Polling service already running");
      return;
    }

    logger.info("Starting Convoso polling service", {
      intervalMinutes: this.config.intervalMinutes,
      batchSize: this.config.batchSize,
    });

    // Run immediately on start
    this.pollAndProcessLeads();

    // Then run on interval
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    this.intervalId = setInterval(() => {
      this.pollAndProcessLeads();
    }, intervalMs);

    logger.info("Polling service started", {
      nextPollIn: `${this.config.intervalMinutes} minutes`,
    });
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Polling service stopped");
    }
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<PollingConfig>): PollingConfig {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...updates };

    logger.info("Polling config updated", {
      updates,
      newConfig: this.config,
    });

    // Restart if enabled status changed
    if (wasEnabled !== this.config.enabled) {
      if (this.config.enabled) {
        this.start();
      } else {
        this.stop();
      }
    }

    return this.config;
  }

  /**
   * Get current configuration
   */
  getConfig(): PollingConfig {
    return { ...this.config };
  }

  /**
   * Poll Convoso and process leads
   */
  private async pollAndProcessLeads(): Promise<void> {
    if (this.isPolling) {
      logger.warn("Previous polling cycle still running, skipping this cycle");
      return;
    }

    this.isPolling = true;
    const startTime = Date.now();

    try {
      logger.info("Starting Convoso polling cycle");

      // Fetch leads from Convoso that need to be called
      const leads = await this.fetchLeadsFromConvoso();

      if (leads.length === 0) {
        logger.info("No leads to process in this cycle");
        return;
      }

      logger.info("Fetched leads from Convoso", {
        count: leads.length,
      });

      // Process leads in batches
      await this.processLeadsInBatches(leads);

      const duration = Date.now() - startTime;
      logger.info("Polling cycle completed", {
        duration: `${duration}ms`,
        leadsProcessed: leads.length,
      });
    } catch (error: any) {
      logger.error("Polling cycle failed", {
        error: error.message,
        stack: error.stack,
      });
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Fetch leads from Convoso API
   * TODO: Update with actual Convoso API endpoint from Jeff
   */
  private async fetchLeadsFromConvoso(): Promise<ConvosoWebhookPayload[]> {
    try {
      // TODO: Replace with actual Convoso API endpoint
      // This is a placeholder - Jeff will provide the actual endpoint
      logger.info("Fetching leads from Convoso API");

      // Placeholder: Return empty array for now
      // Once Jeff provides the endpoint, implement actual API call here
      const leads: ConvosoWebhookPayload[] = [];

      /*
      Example implementation once endpoint is provided:

      const response = await convosoService.searchLeads({
        status: ['NEW', 'CALLBACK', 'NO_ANSWER'],
        call_attempts_lt: this.config.maxCallAttemptsPerDay,
        limit: this.config.batchSize
      });

      leads = response.leads;
      */

      return leads;
    } catch (error: any) {
      logger.error("Failed to fetch leads from Convoso", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process leads in batches to avoid overwhelming the system
   */
  private async processLeadsInBatches(
    leads: ConvosoWebhookPayload[]
  ): Promise<void> {
    const batchSize = this.config.batchSize;
    let processed = 0;
    let failed = 0;

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);

      logger.info("Processing lead batch", {
        batchNumber: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
        totalLeads: leads.length,
      });

      // Process batch with delay between calls
      for (const lead of batch) {
        try {
          // Check if lead should be called based on attempts
          if (
            lead.call_attempts &&
            lead.call_attempts >= this.config.maxCallAttemptsPerDay
          ) {
            logger.info("Skipping lead - max attempts reached", {
              lead_id: lead.lead_id,
              call_attempts: lead.call_attempts,
            });
            continue;
          }

          // Trigger outbound call via orchestrator
          const result = await handleAwhOutbound(lead, `poll_${Date.now()}`);

          if (result.success) {
            processed++;
            logger.info("Lead call initiated", {
              lead_id: lead.lead_id,
              call_id: result.call_id,
            });
          } else {
            failed++;
            logger.warn("Lead call failed", {
              lead_id: lead.lead_id,
              error: result.error,
            });
          }

          // Small delay between calls to avoid rate limiting
          await this.sleep(200); // 200ms between calls
        } catch (error: any) {
          failed++;
          logger.error("Error processing lead", {
            lead_id: lead.lead_id,
            error: error.message,
          });
        }
      }
    }

    logger.info("Batch processing completed", {
      total: leads.length,
      processed,
      failed,
    });
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get polling status
   */
  getStatus(): {
    enabled: boolean;
    isPolling: boolean;
    config: PollingConfig;
  } {
    return {
      enabled: this.config.enabled,
      isPolling: this.isPolling,
      config: this.getConfig(),
    };
  }
}

export const convosoPollingService = new ConvosoPollingService();
