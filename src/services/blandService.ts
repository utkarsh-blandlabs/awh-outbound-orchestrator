// ============================================================================
// Bland Service
// Handles all interactions with Bland AI API
// ============================================================================

import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { retry, isRetryableHttpError } from "../utils/retry";
import { blandRateLimiter } from "../utils/rateLimiter";
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
   * Real Bland API: POST /v1/calls
   */
  async sendOutboundCall(payload: {
    phoneNumber: string;
    firstName: string;
    lastName: string;
  }): Promise<BlandOutboundCallResponse> {
    // Wait for rate limit slot before proceeding
    // This enforces:
    // 1. Global limit: Max 5 calls/sec (Enterprise: 5.5/sec)
    // 2. Per-number limit: Min 10 seconds between calls to same number
    const waitTime = blandRateLimiter.getWaitTime(payload.phoneNumber);
    if (waitTime > 0) {
      logger.info("Rate limit: waiting before call", {
        phone: payload.phoneNumber,
        waitTimeMs: waitTime,
      });
    }
    await blandRateLimiter.waitForSlot(payload.phoneNumber);

    logger.info("Sending outbound call to Bland", {
      phone: payload.phoneNumber,
      name: `${payload.firstName} ${payload.lastName}`,
    });

    // Build dynamic task, first sentence, and voicemail message with customer's name
    const task = config.bland.taskTemplate
      ? config.bland.taskTemplate
          .replace(/\{\{first_name\}\}/g, payload.firstName)
          .replace(/\{\{last_name\}\}/g, payload.lastName)
      : undefined;

    const firstSentence = config.bland.firstSentenceTemplate
      ? config.bland.firstSentenceTemplate
          .replace(/\{\{first_name\}\}/g, payload.firstName)
          .replace(/\{\{last_name\}\}/g, payload.lastName)
      : undefined;

    // Personalize voicemail message with first name (like Zapier)
    const voicemailMessage = config.bland.voicemailMessage
      ? config.bland.voicemailMessage
          .replace(/\{\{first_name\}\}/g, payload.firstName)
          .replace(/\{\{last_name\}\}/g, payload.lastName)
      : "";

    // Log the personalized templates
    logger.debug("🎭 Personalized Call Templates", {
      task: task?.substring(0, 100) + "...",
      first_sentence: firstSentence,
      voicemail_message: voicemailMessage,
    });

    // Build request body matching Zapier configuration
    const requestBody: BlandOutboundCallRequest = {
      phone_number: payload.phoneNumber,

      // Core settings
      ...(config.bland.pathwayId && { pathway_id: config.bland.pathwayId }),
      ...(config.bland.startNodeId && {
        start_node_id: config.bland.startNodeId,
      }),
      ...(task && { task }),

      // Phone numbers
      ...(config.bland.from && { from: config.bland.from }),
      ...(config.bland.transferPhoneNumber && {
        transfer_phone_number: config.bland.transferPhoneNumber,
      }),

      // Voice and behavior
      ...(config.bland.voiceId && { voice: config.bland.voiceId }),
      max_duration: config.bland.maxDuration,
      amd: config.bland.answeringMachineDetection,
      answered_by_enabled: config.bland.answeredByEnabled,
      wait_for_greeting: config.bland.waitForGreeting,
      block_interruptions: config.bland.blockInterruptions,
      record: config.bland.record,

      // First sentence
      ...(firstSentence && { first_sentence: firstSentence }),

      // Voicemail settings (personalized with customer's first name)
      voicemail_message: voicemailMessage,
      ...(config.bland.voicemailAction && {
        voicemail_action: config.bland.voicemailAction as
          | "leave_message"
          | "hangup",
      }),
      sensitive_voicemail_detection: config.bland.sensitiveVoicemailDetection,

      // Webhook URL - Bland will POST to this URL when call completes
      ...(config.bland.webhookUrl && { webhook: config.bland.webhookUrl }),

      // Additional settings
      wait: false, // Don't wait for call to complete (async)
    };

    // Log the request body being sent to Bland
    logger.debug("📤 Bland API Request Body", {
      request_body: requestBody,
    });

    try {
      const response = await retry(
        async () => {
          // Real Bland API call
          const result = await this.client.post("/v1/calls", requestBody);
          return result.data;
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      // Log full Bland call initiation response
      logger.debug("📞 Bland API - Call Initiation Response", {
        full_response: response,
        call_id: response.call_id,
        status: response.status,
      });

      logger.info("Bland call initiated successfully", {
        call_id: response.call_id,
        status: response.status,
      });

      return {
        call_id: response.call_id,
        status: response.status || "success",
      };
    } catch (error: any) {
      logger.error("Failed to send outbound call to Bland", {
        error: error.message,
        response: error.response?.data,
        phone: payload.phoneNumber,
      });
      throw new Error(`Bland API error: ${error.message}`);
    }
  }

  /**
   * Get transcript and outcome from Bland
   * Real Bland API: GET /v1/calls/{call_id}
   * Polls until call is completed
   *
   * @deprecated This method is DEPRECATED and only kept as a fallback.
   * Use webhook-based completion instead (POST /webhooks/bland-callback).
   * Polling is inefficient and doesn't scale well with concurrent calls.
   */
  async getTranscript(callId: string): Promise<BlandTranscript> {
    logger.info("Fetching transcript from Bland", { call_id: callId });

    const maxAttempts = config.bland.transcriptPollMaxAttempts;
    const pollInterval = config.bland.transcriptPollInterval;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await retry(
          async () => {
            // Real Bland API call
            const result = await this.client.get(`/v1/calls/${callId}`);
            return result.data;
          },
          {
            maxAttempts: 1, // No retries within each poll attempt
            shouldRetry: () => false,
          }
        );

        // Check if call is completed
        // Note: Bland sometimes returns status="completed" but completed=false while processing transcript
        // We need to check if the transcript is actually available
        const hasTranscript =
          response.concatenated_transcript &&
          response.concatenated_transcript.length > 0;
        const isCompleted =
          response.completed === true ||
          (response.status === "completed" && hasTranscript);

        if (isCompleted) {
          // Log full raw response from Bland
          logger.debug("📝 Bland API - Full Transcript Response (RAW)", {
            full_response: response,
          });

          const parsedTranscript = this.parseTranscript(response);

          logger.info("Transcript retrieved successfully", {
            call_id: callId,
            outcome: parsedTranscript.outcome,
            duration: response.call_length,
          });

          return parsedTranscript;
        }

        // Call not completed yet, wait and retry
        logger.info("Call not completed yet, polling again", {
          attempt,
          maxAttempts,
          status: response.status,
          completed: response.completed,
          has_transcript: hasTranscript,
        });

        await this.sleep(pollInterval);
      } catch (error: any) {
        // If it's the last attempt, throw
        if (attempt === maxAttempts) {
          logger.error("Failed to get transcript after max attempts", {
            call_id: callId,
            attempts: maxAttempts,
            error: error.message,
          });
          throw new Error("Transcript polling timeout");
        }

        // Otherwise, wait and retry
        logger.warn("Error fetching transcript, will retry", {
          attempt,
          error: error.message,
        });
        await this.sleep(pollInterval);
      }
    }

    throw new Error("Transcript polling timeout");
  }

  /**
   * Parse raw Bland API response into normalized format
   * Based on actual Bland API /v1/calls/{call_id} response
   */
  private parseTranscript(raw: any): BlandTranscript {
    // Log raw response for debugging
    logger.info("Raw Bland transcript response", {
      call_id: raw.call_id,
      status: raw.status,
      completed: raw.completed,
      answered_by: raw.answered_by,
      call_ended_by: raw.call_ended_by,
      warm_transfer: raw.warm_transfer_call,
      error_message: raw.error_message,
    });

    // Extract outcome from call status and answered_by
    const outcome = this.determineOutcome(raw);

    // Extract variables (custom data from call)
    const variables = raw.variables || {};

    return {
      call_id: raw.call_id || raw.c_id,
      transcript: raw.concatenated_transcript || "",
      outcome,
      // Extract custom variables if they exist
      plan_type: variables.plan_type,
      member_count: variables.member_count,
      zip: variables.zip || raw.variables?.zip || variables.postal_code,
      state:
        variables.state || raw.variables?.state || variables.customer_state,
      duration: raw.call_length || raw.corrected_duration,
      // Additional useful fields from Bland
      summary: raw.summary,
      answered_by: raw.answered_by,
      call_ended_by: raw.call_ended_by,
      completed: raw.completed,
      status: raw.status,
      // Customer information from variables
      customer_age: variables.customer_age,
      postal_code: variables.postal_code,
      customer_state: variables.customer_state,
      first_name: variables.first_name,
      last_name: variables.last_name,
      // Pathway information
      pathway_tags: raw.pathway_tags || [],
      // Transfer information
      transferred_to: raw.transferred_to,
      transferred_at: raw.transferred_at,
      // Recording
      recording_url: raw.recording_url,
      // Warm transfer details
      warm_transfer_call: raw.warm_transfer_call,
    };
  }

  /**
   * Determine call outcome from Bland API response
   * Based on status, answered_by, and other indicators
   */
  private determineOutcome(raw: any): CallOutcome {
    // If there was a warm transfer, it was transferred
    if (raw.warm_transfer_call && raw.warm_transfer_call.state === "MERGED") {
      return CallOutcome.TRANSFERRED;
    }

    // Check answered_by field
    const answeredBy = raw.answered_by?.toLowerCase();
    if (answeredBy === "voicemail") {
      return CallOutcome.VOICEMAIL;
    }
    if (answeredBy === "no-answer" || answeredBy === "no_answer") {
      return CallOutcome.NO_ANSWER;
    }
    if (answeredBy === "busy") {
      return CallOutcome.BUSY;
    }

    // Check if call completed successfully with human
    if (raw.completed && answeredBy === "human") {
      // Check if there's a callback request in variables
      if (raw.variables?.callback_requested === true) {
        return CallOutcome.CALLBACK;
      }
      // Default to transferred if completed with human
      return CallOutcome.TRANSFERRED;
    }

    // Check error status
    if (raw.error_message || raw.status === "failed") {
      return CallOutcome.FAILED;
    }

    // Default unknown
    return CallOutcome.UNKNOWN;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const blandService = new BlandService();
