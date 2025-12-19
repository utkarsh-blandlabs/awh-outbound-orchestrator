// ============================================================================
// Convoso Polling Service
// Polls Convoso API for lead status updates and triggers autonomous calling
// ============================================================================

import { convosoService } from "./convosoService";
import { logger } from "../utils/logger";
import { handleAwhOutbound } from "../logic/awhOrchestrator";
import { ConvosoWebhookPayload } from "../types/awh";
import { config } from "../config";

interface PollingConfig {
  enabled: boolean;
  intervalMinutes: number; // How often to poll (20-30 minutes)
  batchSize: number; // How many leads to process per cycle (25)
  maxCallAttemptsPerDay: number; // Max attempts before stopping (4)
  leadsEndpoint: string; // API endpoint for fetching leads
}

class ConvosoPollingService {
  private config: PollingConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;

  constructor() {
    // Load configuration from .env file
    this.config = {
      enabled: config.convoso.polling.enabled,
      intervalMinutes: config.convoso.polling.intervalMinutes,
      batchSize: config.convoso.polling.batchSize,
      maxCallAttemptsPerDay: config.convoso.polling.maxCallAttemptsPerDay,
      leadsEndpoint: config.convoso.polling.leadsEndpoint,
    };

    logger.info("Convoso polling service initialized", {
      config: {
        ...this.config,
        leadsEndpoint: this.config.leadsEndpoint
          ? "configured"
          : "not configured",
      },
    });

    // Auto-start if enabled in .env
    if (this.config.enabled) {
      this.start();
    }
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
   * Endpoint configured via CONVOSO_LEADS_ENDPOINT in .env
   */
  private async fetchLeadsFromConvoso(): Promise<ConvosoWebhookPayload[]> {
    try {
      // Check if endpoint is configured
      if (!this.config.leadsEndpoint) {
        logger.warn(
          "CONVOSO_LEADS_ENDPOINT not configured in .env - skipping polling"
        );
        return [];
      }

      logger.info("Fetching leads from Convoso API", {
        endpoint: this.config.leadsEndpoint,
        batchSize: this.config.batchSize,
        maxAttempts: this.config.maxCallAttemptsPerDay,
      });

      // Make API call to Convoso endpoint
      const axios = require("axios");
      const response = await axios.get(this.config.leadsEndpoint, {
        headers: {
          Authorization: `Bearer ${config.convoso.authToken}`,
          "Content-Type": "application/json",
        },
        params: {
          limit: this.config.batchSize,
          max_call_attempts: this.config.maxCallAttemptsPerDay,
          // Additional params can be added based on Convoso API requirements
        },
        timeout: 30000,
      });

      const leads: ConvosoWebhookPayload[] = response.data.leads || [];

      logger.info("Fetched leads from Convoso", {
        count: leads.length,
      });

      return leads;
    } catch (error: any) {
      logger.error("Failed to fetch leads from Convoso", {
        error: error.message,
        endpoint: this.config.leadsEndpoint,
      });
      // Don't throw - just return empty array so polling continues
      return [];
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
          // NOTE: Call attempt tracking (4 per day) is handled by Convoso
          // Leads returned from polling endpoint are already filtered by their system

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
