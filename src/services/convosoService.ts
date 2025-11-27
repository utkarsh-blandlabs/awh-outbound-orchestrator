import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { retry, isRetryableHttpError } from "../utils/retry";
import {
  ConvosoWebhookPayload,
  ConvosoLead,
  ConvosoCallLogRequest,
  ConvosoLeadUpdateRequest,
  BlandTranscript,
  CallOutcome,
} from "../types/awh";

class ConvosoService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.convoso.baseUrl,
      headers: {
        Authorization: `Bearer ${config.convoso.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  async getOrCreateLead(payload: ConvosoWebhookPayload): Promise<ConvosoLead> {
    logger.info("Getting or creating Convoso lead", {
      phone: payload.phone,
      name: `${payload.first_name} ${payload.last_name}`,
      existing_lead_id: payload.lead_id,
    });

    try {
      if (payload.lead_id) {
        try {
          const lead = await this.getLead(payload.lead_id);
          logger.info("Found existing lead", { lead_id: lead.lead_id });
          return lead;
        } catch (error) {
          logger.warn("Lead ID provided but not found, will create new lead", {
            lead_id: payload.lead_id,
          });
        }
      }

      const existingLead = await this.findLeadByPhone(payload.phone);
      if (existingLead) {
        logger.info("Found existing lead by phone", {
          lead_id: existingLead.lead_id,
        });
        return existingLead;
      }

      return await this.createLead(payload);
    } catch (error: any) {
      logger.error("Failed to get or create lead", {
        error: error.message,
        phone: payload.phone,
      });
      throw new Error(`Convoso API error: ${error.message}`);
    }
  }

  private async getLead(leadId: string): Promise<ConvosoLead> {
    const response = await retry(
      async () => {
        // TODO: Replace with actual Convoso endpoint
        logger.warn("⚠️  STUB: Using mock Convoso lead response");
        return {
          lead_id: leadId,
          first_name: "Mock",
          last_name: "Lead",
          phone: "5551234567",
          state: "CA",
          status: "active",
        };
      },
      {
        maxAttempts: config.retry.maxAttempts,
        shouldRetry: isRetryableHttpError,
      }
    );

    return response;
  }

  private async findLeadByPhone(phone: string): Promise<ConvosoLead | null> {
    try {
      const response = await retry(
        async () => {
          // TODO: Replace with actual Convoso endpoint
          logger.warn("⚠️  STUB: Using mock Convoso find by phone");
          return null;
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      return response;
    } catch (error) {
      logger.debug("Lead not found by phone", { phone });
      return null;
    }
  }

  private async createLead(
    payload: ConvosoWebhookPayload
  ): Promise<ConvosoLead> {
    logger.info("Creating new Convoso lead", {
      phone: payload.phone,
      name: `${payload.first_name} ${payload.last_name}`,
    });

    const response = await retry(
      async () => {
        // TODO: Replace with actual Convoso endpoint
        logger.warn("⚠️  STUB: Using mock Convoso create lead response");
        return {
          lead_id: `convoso_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          first_name: payload.first_name,
          last_name: payload.last_name,
          phone: payload.phone,
          state: payload.state,
          status: "new",
        };
      },
      {
        maxAttempts: config.retry.maxAttempts,
        shouldRetry: isRetryableHttpError,
      }
    );

    logger.info("Lead created successfully", { lead_id: response.lead_id });
    return response;
  }

  async logCall(
    leadId: string,
    callId: string,
    phoneNumber: string
  ): Promise<void> {
    logger.info("Logging call in Convoso", {
      lead_id: leadId,
      call_id: callId,
    });

    const callLogData: ConvosoCallLogRequest = {
      lead_id: leadId,
      call_id: callId,
      phone_number: phoneNumber,
      timestamp: new Date().toISOString(),
    };

    try {
      await retry(
        async () => {
          // TODO: Replace with actual Convoso endpoint
          logger.warn("⚠️  STUB: Simulating Convoso call log");
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      logger.info("Call logged successfully", { lead_id: leadId });
    } catch (error: any) {
      logger.error("Failed to log call in Convoso", {
        error: error.message,
        lead_id: leadId,
        call_id: callId,
      });
    }
  }

  async updateLeadFromOutcome(
    leadId: string,
    transcript: BlandTranscript
  ): Promise<void> {
    logger.info("Updating Convoso lead with outcome", {
      lead_id: leadId,
      outcome: transcript.outcome,
    });

    const { disposition, status, notes } = this.mapOutcomeToConvoso(transcript);

    const updateData: ConvosoLeadUpdateRequest = {
      lead_id: leadId,
      status,
      disposition,
      notes,
      plan_type: transcript.plan_type,
      member_count: transcript.member_count,
      zip: transcript.zip,
      state: transcript.state,
      transcript: transcript.transcript,
    };

    try {
      await retry(
        async () => {
          // TODO: Replace with actual Convoso endpoint
          logger.warn("⚠️  STUB: Simulating Convoso lead update");
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      logger.info("Lead updated successfully", {
        lead_id: leadId,
        status,
        disposition,
      });
    } catch (error: any) {
      logger.error("Failed to update lead in Convoso", {
        error: error.message,
        lead_id: leadId,
      });
      throw new Error(`Convoso update error: ${error.message}`);
    }
  }

  private mapOutcomeToConvoso(transcript: BlandTranscript): {
    disposition: string;
    status: string;
    notes: string;
  } {
    const outcome = transcript.outcome;

    switch (outcome) {
      case CallOutcome.TRANSFERRED:
        return {
          disposition: "TRANSFERRED",
          status: "hot_lead",
          notes: `Call transferred. Plan: ${transcript.plan_type || "Unknown"}, Members: ${transcript.member_count || "Unknown"}`,
        };

      case CallOutcome.VOICEMAIL:
        return {
          disposition: "VOICEMAIL",
          status: "follow_up",
          notes: "Voicemail left. Follow-up needed.",
        };

      case CallOutcome.CALLBACK:
        return {
          disposition: "CALLBACK_REQUESTED",
          status: "callback",
          notes: "Customer requested callback.",
        };

      case CallOutcome.NO_ANSWER:
        return {
          disposition: "NO_ANSWER",
          status: "retry",
          notes: "No answer. Will retry.",
        };

      case CallOutcome.BUSY:
        return {
          disposition: "BUSY",
          status: "retry",
          notes: "Line busy. Will retry.",
        };

      case CallOutcome.FAILED:
        return {
          disposition: "FAILED",
          status: "dead",
          notes: "Call failed.",
        };

      default:
        return {
          disposition: "UNKNOWN",
          status: "review",
          notes: "Call outcome unknown. Needs review.",
        };
    }
  }
}

export const convosoService = new ConvosoService();
