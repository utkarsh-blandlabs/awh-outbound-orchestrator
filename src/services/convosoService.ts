// ============================================================================
// Convoso Service
// Handles all interactions with Convoso API
// Based on actual API details from Jeff (Nov 28, 2025)
// ============================================================================

import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { retry, isRetryableHttpError } from "../utils/retry";
import {
  ConvosoWebhookPayload,
  ConvosoLead,
  ConvosoLeadInsertRequest,
  ConvosoCallLogRequest,
  BlandTranscript,
} from "../types/awh";

class ConvosoService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.convoso.baseUrl,
      timeout: 30000,
    });
  }

  /**
   * Insert or update a lead in Convoso
   * Uses /v1/leads/insert endpoint
   * Auth via query parameter
   */
  async insertOrUpdateLead(
    payload: ConvosoWebhookPayload
  ): Promise<ConvosoLead> {
    logger.info("Inserting/updating Convoso lead", {
      phone_number: payload.phone_number,
      name: `${payload.first_name} ${payload.last_name}`,
      lead_id: payload.lead_id,
    });

    const requestData: ConvosoLeadInsertRequest = {
      auth_token: config.convoso.authToken,
      list_id: payload.list_id || config.convoso.listId,
      phone_number: payload.phone_number,
      first_name: payload.first_name,
      last_name: payload.last_name,
      date_of_birth: payload.date_of_birth,
      city: payload.city,
      state: payload.state,
      postal_code: payload.postal_code,
      lead_id: payload.lead_id,
      status: payload.status || "NEW",
    };

    try {
      const response = await retry(
        async () => {
          // Real Convoso API call
          const result = await this.client.post("/v1/leads/insert", null, {
            params: requestData,
          });
          return result.data;
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      const lead: ConvosoLead = {
        lead_id: response.lead_id || payload.lead_id,
        first_name: payload.first_name,
        last_name: payload.last_name,
        phone_number: payload.phone_number,
        state: payload.state,
        city: payload.city,
        postal_code: payload.postal_code,
        date_of_birth: payload.date_of_birth,
        list_id: payload.list_id || config.convoso.listId,
        status: payload.status || "NEW",
      };

      logger.info("Lead inserted/updated successfully", {
        lead_id: lead.lead_id,
      });
      return lead;
    } catch (error: any) {
      logger.error("Failed to insert/update lead in Convoso", {
        error: error.message,
        response: error.response?.data,
        phone_number: payload.phone_number,
      });
      throw new Error(`Convoso API error: ${error.message}`);
    }
  }

  /**
   * Update call log with transcript
   * Uses /v1/log/update endpoint
   * This is how Convoso receives call outcomes and transcripts
   */
  async updateCallLog(
    leadId: string,
    phoneNumber: string,
    transcript: BlandTranscript
  ): Promise<void> {
    logger.info("Updating Convoso call log", {
      lead_id: leadId,
      phone_number: phoneNumber,
      outcome: transcript.outcome,
    });

    // Format transcript for Convoso
    const callTranscript = this.formatTranscriptForConvoso(transcript);

    const requestData: ConvosoCallLogRequest = {
      auth_token: config.convoso.authToken,
      phone_number: phoneNumber,
      lead_id: leadId,
      call_transcript: callTranscript,
    };

    try {
      await retry(
        async () => {
          // Real Convoso API call
          await this.client.post("/v1/log/update", null, {
            params: requestData,
          });
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      logger.info("Call log updated successfully", {
        lead_id: leadId,
        outcome: transcript.outcome,
      });
    } catch (error: any) {
      logger.error("Failed to update call log in Convoso", {
        error: error.message,
        response: error.response?.data,
        lead_id: leadId,
      });
      throw new Error(`Convoso log update error: ${error.message}`);
    }
  }

  /**
   * Format Bland transcript for Convoso
   * Creates a human-readable summary
   */
  private formatTranscriptForConvoso(transcript: BlandTranscript): string {
    const parts: string[] = [];

    // Call outcome
    parts.push(`Call Outcome: ${transcript.outcome}`);

    // Plan details if available
    if (transcript.plan_type) {
      parts.push(`Plan Type: ${transcript.plan_type}`);
    }
    if (transcript.member_count) {
      parts.push(`Members: ${transcript.member_count}`);
    }
    if (transcript.zip) {
      parts.push(`ZIP: ${transcript.zip}`);
    }
    if (transcript.state) {
      parts.push(`State: ${transcript.state}`);
    }

    // Call duration
    if (transcript.duration) {
      parts.push(`Duration: ${transcript.duration}s`);
    }

    // Full transcript
    parts.push(`\n--- Transcript ---\n${transcript.transcript}`);

    return parts.join("\n");
  }

  /**
   * Legacy method name for compatibility
   * Now just calls insertOrUpdateLead
   */
  async getOrCreateLead(payload: ConvosoWebhookPayload): Promise<ConvosoLead> {
    return this.insertOrUpdateLead(payload);
  }

  /**
   * Log call - now part of updateCallLog
   * Keeping for backwards compatibility during transition
   */
  async logCall(
    leadId: string,
    callId: string,
    phoneNumber: string
  ): Promise<void> {
    logger.info("Call logging now handled by updateCallLog with transcript", {
      lead_id: leadId,
      call_id: callId,
    });
    // This is now a no-op - actual logging happens in updateCallLog with transcript
  }

  /**
   * Update lead from outcome - now uses updateCallLog
   * Keeping for backwards compatibility
   */
  async updateLeadFromOutcome(
    leadId: string,
    phoneNumber: string,
    transcript: BlandTranscript
  ): Promise<void> {
    return this.updateCallLog(leadId, phoneNumber, transcript);
  }
}

export const convosoService = new ConvosoService();
