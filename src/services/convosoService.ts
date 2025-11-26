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
      timeout: 30000, // 30 seconds
    });
  }

  async getOrCcreateLead(payload: ConvosoWebhookPayload): Promise<ConvosoLead> {
    logger.info("Getting or creating Convoso lead", {
      phone: payload.phone,
      name: `${payload.first_name} ${payload.last_name}`,
      existing_lead_id: payload.lead_id,
    });

    try {
      // If lead_id is provided, try to fetch it first
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

      // Otherwise, search by phone number
      const existingLead = await this.findLeadByPhone(payload.phone);
      if (existingLead) {
        logger.info("Found existing lead by phone", {
          lead_id: existingLead.lead_id,
        });
        return existingLead;
      }

      // No existing lead, create new one
      return await this.createLead(payload);
    } catch (error: any) {
      logger.error("Failed to get or create lead", {
        error: error.message,
        phone: payload.phone,
      });
      throw new Error(`Convoso API error: ${error.message}`);
    }
  }

  /**
   * Get a lead by ID
   */
  private async getLead(leadId: string): Promise<ConvosoLead> {
    // TODO: Replace with actual Convoso endpoint once you have it
    // Expected endpoint: GET /v1/leads/{leadId} or similar
    const response = await retry(
      async () => {
        // STUB: This is where the real API call goes
        // const result = await this.client.get(`/v1/leads/${leadId}`);
        // return result.data;

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

  /**
   * Find a lead by phone number
   */
  private async findLeadByPhone(phone: string): Promise<ConvosoLead | null> {
    // TODO: Replace with actual Convoso endpoint once you have it
    // Expected endpoint: GET /v1/leads?phone={phone} or similar
    try {
      const response = await retry(
        async () => {
          // STUB: This is where the real API call goes
          // const result = await this.client.get('/v1/leads', { params: { phone } });
          // return result.data;

          logger.warn("⚠️  STUB: Using mock Convoso find by phone");
          return null; // Simulate no existing lead
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

  /**
   * Create a new lead
   */
  private async createLead(
    payload: ConvosoWebhookPayload
  ): Promise<ConvosoLead> {
    logger.info("Creating new Convoso lead", {
      phone: payload.phone,
      name: `${payload.first_name} ${payload.last_name}`,
    });

    // TODO: Replace with actual Convoso endpoint once you have it
    // Expected endpoint: POST /v1/leads or similar
    const response = await retry(
      async () => {
        // STUB: This is where the real API call goes
        // const result = await this.client.post('/v1/leads', {
        //   first_name: payload.first_name,
        //   last_name: payload.last_name,
        //   phone: payload.phone,
        //   state: payload.state,
        //   ...payload, // Include any additional fields
        // });
        // return result.data;

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

  /**
   * Log a call in Convoso
   */
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
      // TODO: Add other required fields
    };

    try {
      // TODO: Replace with actual Convoso endpoint once you have it
      // Expected endpoint: POST /v1/calls or /v1/call-logs or similar
      await retry(
        async () => {
          // STUB: This is where the real API call goes
          // await this.client.post('/v1/calls', callLogData);

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
      // Don't throw - logging failure shouldn't stop the flow
    }
  }

  /**
   * Update lead with transcript and outcome
   */
  async updateLeadFromOutcome(
    leadId: string,
    transcript: BlandTranscript
  ): Promise<void> {
    logger.info("Updating Convoso lead with outcome", {
      lead_id: leadId,
      outcome: transcript.outcome,
    });

    // Map outcome to Convoso disposition and status
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
      // TODO: Add other update fields
    };

    try {
      // TODO: Replace with actual Convoso endpoint once you have it
      // Expected endpoint: PUT /v1/leads/{leadId} or PATCH /v1/leads/{leadId}
      await retry(
        async () => {
          // STUB: This is where the real API call goes
          // await this.client.put(`/v1/leads/${leadId}`, updateData);

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

  /**
   * Map Bland transcript outcome to Convoso disposition and status
   */
  private mapOutcomeToConvoso(transcript: BlandTranscript): {
    disposition: string;
    status: string;
    notes: string;
  } {
    // TODO: Get the actual disposition codes and status values from Jeff/Delaine
    // This is a placeholder mapping based on typical CRM patterns

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
