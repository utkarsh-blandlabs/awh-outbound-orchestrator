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
  CONVOSO_STATUS_MAP,
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

      // Log full Convoso lead insert response
      logger.debug("📋 Convoso API - Lead Insert Response", {
        full_response: response,
        lead_id: response.lead_id,
      });

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
   * Map Bland.ai outcome to Convoso status code
   * Uses CONVOSO_STATUS_MAP for mapping
   *
   * All codes are validated against the official Convoso status table (71 codes)
   * HUMAN codes (27): Call answered by human, AI had conversation
   * SYSTEM codes (44): Technical outcomes, no human conversation
   */
  private mapOutcomeToConvosoStatus(outcome: string): string {
    const normalizedOutcome = outcome.toLowerCase().replace(/[_\s-]/g, "_");

    // Direct mapping from CONVOSO_STATUS_MAP
    if (CONVOSO_STATUS_MAP[normalizedOutcome]) {
      return CONVOSO_STATUS_MAP[normalizedOutcome];
    }

    // Fuzzy matching for common variations - ALL CODES ARE VALID
    // PRIORITY: Check for DNC requests first (compliance-critical)
    if (normalizedOutcome.includes("do_not_call_again") ||
        normalizedOutcome.includes("never_call") ||
        normalizedOutcome.includes("remove_from_list") ||
        normalizedOutcome.includes("stop_calling")) return "DNCA";   // SYSTEM: Do NOT Call Again (customer request)

    if (normalizedOutcome.includes("transfer")) return "ACA";        // HUMAN: Transferred to ACA
    if (normalizedOutcome.includes("voicemail") || normalizedOutcome.includes("machine")) return "A";  // HUMAN: Answering Machine
    if (normalizedOutcome.includes("callback") || normalizedOutcome.includes("call_back")) return "CB";  // HUMAN: Requested Callback
    if (normalizedOutcome.includes("sale")) return "SALE";           // HUMAN: Sale
    if (normalizedOutcome.includes("confus")) return "CD";           // HUMAN: Customer Disconnected (confused caller)
    if (normalizedOutcome.includes("not_interest") || normalizedOutcome.includes("ni")) return "NI";  // HUMAN: Not Interested
    if (normalizedOutcome.includes("no_answer") || normalizedOutcome.includes("noanswer")) return "NA";  // SYSTEM: No Answer AutoDial
    if (normalizedOutcome.includes("busy")) return "B";              // SYSTEM: System Busy
    if (normalizedOutcome.includes("hang") || normalizedOutcome.includes("hangup")) return "CALLHU";    // SYSTEM: Caller Hung Up
    if (normalizedOutcome.includes("disconnect")) return "DC";       // SYSTEM: Disconnected Number
    if (normalizedOutcome.includes("dead")) return "N";              // SYSTEM: Dead Air/System Glitch
    if (normalizedOutcome.includes("wrong")) return "WRONG";         // HUMAN: Wrong Number
    if (normalizedOutcome.includes("bad_phone")) return "BPN";       // HUMAN: Bad Phone Number

    // Default fallback - Dead Air/System Glitch (valid SYSTEM code)
    logger.warn("Unknown outcome, defaulting to N (Dead Air/System Glitch)", {
      outcome,
      normalized: normalizedOutcome,
      note: "This is a valid SYSTEM status code for unrecognized outcomes",
    });
    return "N";  // Dead Air/System Glitch - valid fallback for unknown outcomes
  }

  /**
   * Update call log with transcript and status
   * Uses /v1/log/update endpoint
   * This is how Convoso receives call outcomes and transcripts
   */
  async updateCallLog(
    leadId: string,
    phoneNumber: string,
    transcript: BlandTranscript
  ): Promise<void> {
    // Map Bland outcome to Convoso status
    const convosoStatus = this.mapOutcomeToConvosoStatus(transcript.outcome);

    logger.info("📤 STEP 4 | Updating Convoso call log", {
      lead_id: leadId,
      phone: phoneNumber,
      call_id: transcript.call_id,
      bland_outcome: transcript.outcome,
      convoso_status: convosoStatus,
      duration: transcript.duration,
    });

    // Format transcript for Convoso
    const callTranscript = this.formatTranscriptForConvoso(transcript, convosoStatus);

    const requestData: ConvosoCallLogRequest = {
      auth_token: config.convoso.authToken,
      phone_number: phoneNumber,
      lead_id: leadId,
      call_transcript: callTranscript,
      status: convosoStatus, // IMPORTANT: Only abbreviation, not description
    };

    // Log what we're sending to Convoso
    logger.info("📤 CONVOSO REQUEST | Sending call log update", {
      endpoint: "/v1/log/update",
      lead_id: leadId,
      phone_number: phoneNumber,
      status: convosoStatus,
      bland_outcome: transcript.outcome,
      transcript_preview: callTranscript.substring(0, 300),
      full_request_data: requestData,
    });

    try {
      const response = await retry(
        async () => {
          // Real Convoso API call
          const result = await this.client.post("/v1/log/update", null, {
            params: requestData,
          });
          return result.data;
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      // Log full Convoso call log update response
      logger.debug("🔀 Convoso API - Call Log Update Response", {
        full_response: response,
        lead_id: leadId,
        bland_outcome: transcript.outcome,
        convoso_status: convosoStatus,
      });

      logger.info("✅ Call log updated successfully", {
        lead_id: leadId,
        bland_outcome: transcript.outcome,
        convoso_status: convosoStatus,
      });
    } catch (error: any) {
      logger.error("Failed to update call log in Convoso", {
        error: error.message,
        response: error.response?.data,
        lead_id: leadId,
        bland_outcome: transcript.outcome,
        convoso_status: convosoStatus,
      });
      throw new Error(`Convoso log update error: ${error.message}`);
    }
  }

  /**
   * Format Bland transcript for Convoso
   * Creates a human-readable summary with status
   */
  private formatTranscriptForConvoso(transcript: BlandTranscript, convosoStatus: string): string {
    const parts: string[] = [];

    // Add Convoso status at the top
    parts.push(`Status: ${convosoStatus}`);
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

  /**
   * Get call logs from Convoso
   * Query call logs for a specific customer (Zapier Step 3)
   *
   * @param options Query options
   * @returns Array of call logs
   */
  async getCallLogs(options: {
    queueId: string;
    phoneNumber: string;
    firstName?: string;
    lastName?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
    includeRecordings?: boolean;
  }): Promise<any[]> {
    logger.info("Querying Convoso call logs", {
      queueId: options.queueId,
      phone: options.phoneNumber,
    });

    const params: any = {
      auth_token: config.convoso.authToken,
      queue_id: options.queueId,
      phone_number: options.phoneNumber,
    };

    if (options.firstName) params.first_name = options.firstName;
    if (options.lastName) params.last_name = options.lastName;
    if (options.startTime) params.start_time = options.startTime;
    if (options.endTime) params.end_time = options.endTime;
    if (options.limit) params.limit = options.limit;
    if (options.offset) params.offset = options.offset;
    if (options.includeRecordings !== undefined) {
      params.include_recordings = options.includeRecordings;
    }

    try {
      const response = await retry(
        async () => {
          // Convoso call logs endpoint
          const result = await this.client.get("/v1/calls/logs", {
            params,
          });
          return result.data;
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      logger.info("Call logs retrieved successfully", {
        queueId: options.queueId,
        count: response.logs?.length || 0,
      });

      return response.logs || [];
    } catch (error: any) {
      logger.error("Failed to retrieve call logs from Convoso", {
        error: error.message,
        response: error.response?.data,
        queueId: options.queueId,
      });
      throw new Error(`Convoso call logs error: ${error.message}`);
    }
  }
}

export const convosoService = new ConvosoService();

/**
 * Helper function for callback webhook
 */
export async function getConvosoCallLogs(options: {
  queueId: string;
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  includeRecordings?: boolean;
}): Promise<any[]> {
  return convosoService.getCallLogs(options);
}
