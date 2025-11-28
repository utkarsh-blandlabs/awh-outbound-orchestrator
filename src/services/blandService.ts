// ============================================================================
// Bland Service
// Handles all interactions with Bland AI API
// ============================================================================

import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { retry, isRetryableHttpError } from "../utils/retry";
import {
  BlandOutboundCallRequest,
  BlandOutboundCallResponse,
  BlandTranscript,
  CallOutcome,
} from "../types/awh";

class BlandService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.bland.baseUrl,
      headers: {
        Authorization: `Bearer ${config.bland.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000, // 30 seconds
    });
  }

  /**
   * Send an outbound call via Bland
   */
  async sendOutboundCall(payload: {
    phoneNumber: string;
    firstName: string;
    lastName: string;
  }): Promise<BlandOutboundCallResponse> {
    logger.info("Sending outbound call to Bland", {
      phone: payload.phoneNumber,
      name: `${payload.firstName} ${payload.lastName}`,
    });

    const requestBody: BlandOutboundCallRequest = {
      phone_number: payload.phoneNumber,
      pathway_id: config.bland.pathwayId,
      start_node_id: config.bland.startNodeId,
      from_number: config.bland.fromNumber,
      transfer_phone_number: config.bland.transferNumber,
      voicemail_message: config.bland.voicemailMessage,
      caller_id: payload.phoneNumber, // Use customer's phone as caller ID
    };

    try {
      // TODO: Replace with actual Bland endpoint once you have it
      // Expected endpoint: POST /v1/calls or similar
      const response = await retry(
        async () => {
          // STUB: This is where the real API call goes
          // const result = await this.client.post('/v1/calls', requestBody);
          // return result.data;

          // For now, return mock data
          logger.warn("  STUB: Using mock Bland call response");
          return {
            call_id: `bland_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            status: "initiated",
          };
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      logger.info("Bland call initiated successfully", {
        call_id: response.call_id,
      });

      return response;
    } catch (error: any) {
      logger.error("Failed to send outbound call to Bland", {
        error: error.message,
        phone: payload.phoneNumber,
      });
      throw new Error(`Bland API error: ${error.message}`);
    }
  }

  /**
   * Get transcript and outcome from Bland
   * Polls until transcript is ready
   */
  async getTranscript(callId: string): Promise<BlandTranscript> {
    logger.info("Fetching transcript from Bland", { call_id: callId });

    const maxAttempts = config.bland.transcriptPollMaxAttempts;
    const pollInterval = config.bland.transcriptPollInterval;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // TODO: Replace with actual Bland endpoint once you have it
        // Expected endpoint: GET /v1/calls/{callId}/transcript or similar
        const response = await retry(
          async () => {
            // STUB: This is where the real API call goes
            // const result = await this.client.get(`/v1/calls/${callId}/transcript`);
            // return result.data;

            // For now, return mock data after a few attempts (simulate call in progress)
            if (attempt < 3) {
              logger.debug("Transcript not ready yet, will retry", { attempt });
              throw new Error("Transcript not ready");
            }

            logger.warn("⚠️  STUB: Using mock Bland transcript response");
            return {
              call_id: callId,
              status: "completed",
              transcript:
                "Mock transcript: Customer interested in family plan...",
              outcome: "transferred",
              plan_type: "Family",
              member_count: 4,
              zip: "90210",
              state: "CA",
              duration: 180,
            };
          },
          {
            maxAttempts: 1, // No retries within each poll attempt
            shouldRetry: () => false,
          }
        );

        // Check if transcript is ready
        if (response.status === "completed" || response.transcript) {
          const parsedTranscript = this.parseTranscript(response);
          logger.info("Transcript retrieved successfully", {
            call_id: callId,
            outcome: parsedTranscript.outcome,
          });
          return parsedTranscript;
        }

        // Transcript not ready, wait and retry
        logger.debug("Transcript not ready, polling again", {
          attempt,
          maxAttempts,
        });

        await this.sleep(pollInterval);
      } catch (error: any) {
        // If it's the last attempt, throw
        if (attempt === maxAttempts) {
          logger.error("Failed to get transcript after max attempts", {
            call_id: callId,
            attempts: maxAttempts,
          });
          throw new Error("Transcript polling timeout");
        }

        // Otherwise, wait and retry
        await this.sleep(pollInterval);
      }
    }

    throw new Error("Transcript polling timeout");
  }

  /**
   * Parse raw Bland transcript response into normalized format
   */
  private parseTranscript(raw: any): BlandTranscript {
    // TODO: Adjust this based on actual Bland response format
    const outcome = this.mapOutcome(raw.outcome || raw.call_status);

    return {
      call_id: raw.call_id,
      transcript: raw.transcript || "",
      outcome,
      plan_type: raw.plan_type,
      member_count: raw.member_count,
      zip: raw.zip,
      state: raw.state,
      duration: raw.duration,
    };
  }

  /**
   * Map Bland outcome to standardized CallOutcome enum
   */
  private mapOutcome(blandOutcome: string): CallOutcome {
    // TODO: Adjust mappings based on actual Bland outcome values
    const outcomeMap: { [key: string]: CallOutcome } = {
      transferred: CallOutcome.TRANSFERRED,
      transfer: CallOutcome.TRANSFERRED,
      voicemail: CallOutcome.VOICEMAIL,
      callback: CallOutcome.CALLBACK,
      no_answer: CallOutcome.NO_ANSWER,
      busy: CallOutcome.BUSY,
      failed: CallOutcome.FAILED,
    };

    const normalized = blandOutcome?.toLowerCase();
    return outcomeMap[normalized] || CallOutcome.UNKNOWN;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const blandService = new BlandService();
