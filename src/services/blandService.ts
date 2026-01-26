// ============================================================================
// Bland Service
// Handles all interactions with Bland AI API
// ============================================================================

import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { retry, isRetryableHttpError } from "../utils/retry";
import { blandRateLimiter } from "../utils/rateLimiter";
import { smsTrackerService } from "./smsTrackerService";
import {
  BlandOutboundCallRequest,
  BlandOutboundCallResponse,
  BlandTranscript,
  CallOutcome,
} from "../types/awh";

class BlandService {
  private client: AxiosInstance;
  private poolIndex: number = 0; // For round-robin selection

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
   * Select a phone number from the pool (if enabled)
   * Supports both round-robin and random selection strategies
   */
  private selectFromNumber(): string {
    // If pool is not enabled or empty, use single number
    if (!config.bland.usePool || config.bland.fromPool.length === 0) {
      return config.bland.from;
    }

    const pool = config.bland.fromPool;
    const strategy = config.bland.poolStrategy;

    if (strategy === "random") {
      // Random selection
      const randomIndex = Math.floor(Math.random() * pool.length);
      return pool[randomIndex] || config.bland.from;
    } else {
      // Round-robin selection (default)
      const selectedNumber = pool[this.poolIndex] || config.bland.from;
      this.poolIndex = (this.poolIndex + 1) % pool.length;
      return selectedNumber;
    }
  }

  /**
   * Send an outbound call via Bland
   * Real Bland API: POST /v1/calls
   */
  async sendOutboundCall(payload: {
    phoneNumber: string;
    firstName: string;
    lastName: string;
    leadId?: string;
    listId?: string;
  }): Promise<BlandOutboundCallResponse> {
    // Select phone number from pool (or use single number if pool disabled)
    const selectedFromNumber = this.selectFromNumber();

    // Wait for rate limit slot before proceeding
    // This enforces:
    // 1. Global limit: Max 5 calls/sec (Enterprise: 5.5/sec)
    // 2. Per-number limit: Min 2 minutes (120 seconds) between calls to same number
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
      from_number: selectedFromNumber, // Log which number is being used
      pool_enabled: config.bland.usePool,
      pool_strategy: config.bland.poolStrategy,
    });

    // IMPORTANT: Build request_data (parameters) for Bland pathway to access
    // This is how the AI can retrieve customer information during the call
    // The pathway accesses these via {{first_name}}, {{last_name}}, {{lead_id}}, {{list_id}} syntax
    const requestData: Record<string, any> = {
      first_name: payload.firstName,
      last_name: payload.lastName,
      ...(payload.leadId && { lead_id: payload.leadId }),
      ...(payload.listId && { list_id: payload.listId }),
    };

    // Get templates from config (WITHOUT replacing placeholders)
    // Bland.ai will replace {{first_name}} and {{last_name}} at runtime
    const task = config.bland.taskTemplate || undefined;
    const firstSentence = config.bland.firstSentenceTemplate || undefined;

    // For voicemail and SMS, replace placeholders with actual values
    // Bland doesn't have access to request_data in voicemail/SMS context
    // Format callback number for voicemail: (561) 956-5858
    const callbackNumber = config.bland.smsFrom || config.bland.from || "";
    const formattedCallback = callbackNumber
      ? callbackNumber.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")
      : "";

    const voicemailMessage = config.bland.voicemailMessage
      ? config.bland.voicemailMessage
          .replace(/\{\{first_name\}\}/g, payload.firstName)
          .replace(/\{\{last_name\}\}/g, payload.lastName)
      : "";

    // Add callback number to voicemail if not already included
    const voicemailWithCallback = voicemailMessage ?? "";

    const smsMessage = config.bland.smsMessage
      ? config.bland.smsMessage
          .replace(/\{\{first_name\}\}/g, payload.firstName)
          .replace(/\{\{last_name\}\}/g, payload.lastName)
      : "";

    // Check if we can send SMS (limit 1-2 per day per number)
    const canSendSms = smsTrackerService.canSendSms(payload.phoneNumber);
    const shouldIncludeSms =
      config.bland.smsEnabled &&
      config.bland.smsFrom &&
      smsMessage &&
      canSendSms;

    if (config.bland.smsEnabled && smsMessage && !canSendSms) {
      logger.info("SMS limit reached for today, voicemail only", {
        phone: payload.phoneNumber,
        sms_count: smsTrackerService.getSmsCount(payload.phoneNumber),
        max: smsTrackerService.getConfig().max_sms_per_day,
      });
    }

    // Build voicemail object following Bland API v1 format with nested SMS
    const voicemailConfig = voicemailWithCallback
      ? {
          message: voicemailWithCallback,
          action: (config.bland.voicemailAction || "leave_message") as
            | "leave_message"
            | "hangup",
          // Include SMS if enabled and under daily limit (nested within voicemail object)
          ...(shouldIncludeSms && {
            sms: {
              to: payload.phoneNumber,
              from: config.bland.smsFrom,
              message: smsMessage,
            },
          }),
          // IMPORTANT: Set to true for LLM-based sensitive voicemail detection
          sensitive: config.bland.sensitiveVoicemailDetection,
        }
      : undefined;

    // Build request body matching Bland API v1 specification
    const requestBody: BlandOutboundCallRequest = {
      phone_number: payload.phoneNumber,

      // Core settings
      ...(config.bland.pathwayId && { pathway_id: config.bland.pathwayId }),
      ...(config.bland.startNodeId && {
        start_node_id: config.bland.startNodeId,
      }),
      ...(task && { task }),

      // CRITICAL: Pass request_data so pathway can access customer info
      request_data: requestData,

      // Phone numbers
      ...(selectedFromNumber && { from: selectedFromNumber }),
      ...(config.bland.transferPhoneNumber && {
        transfer_phone_number: config.bland.transferPhoneNumber,
      }),

      // Voice and behavior
      ...(config.bland.voiceId && { voice: config.bland.voiceId }),
      max_duration: config.bland.maxDuration,
      wait_for_greeting: config.bland.waitForGreeting,
      block_interruptions: config.bland.blockInterruptions,
      record: config.bland.record,

      // First sentence (with template variables for Bland to replace)
      ...(firstSentence && { first_sentence: firstSentence }),

      // Voicemail configuration (Bland API v1 format)
      ...(voicemailConfig && { voicemail: voicemailConfig }),

      // Webhook URL - Bland will POST to this URL when call completes
      ...(config.bland.webhookUrl && { webhook: config.bland.webhookUrl }),

      // Additional settings
      wait: false, // Don't wait for call to complete (async)
    };

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

      logger.info("Bland call initiated successfully", {
        call_id: response.call_id,
        status: response.status,
      });

      // Record SMS sent if it was included in the request
      if (shouldIncludeSms) {
        try {
          await smsTrackerService.recordSmsSent(payload.phoneNumber);
        } catch (error: any) {
          // SMS tracker failed - this is critical but don't block the call
          logger.error("CRITICAL: SMS tracker failed to record SMS - spam prevention may be broken!", {
            phone: payload.phoneNumber,
            error: error.message,
            call_id: response.call_id,
          });
        }
      }

      return {
        call_id: response.call_id,
        status: response.status || "success",
        from_number: selectedFromNumber, // Track which pool number was used
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
    // CRITICAL FIX: Check answered_by FIRST before checking transfer state
    // NEVER transfer voicemail, no-answer, or busy calls to agents!
    const answeredBy = raw.answered_by?.toLowerCase();

    // Priority 1: Check if call went to voicemail/no-answer/busy (never transfer these!)
    if (answeredBy === "voicemail") {
      return CallOutcome.VOICEMAIL;
    }
    if (answeredBy === "no-answer" || answeredBy === "no_answer") {
      return CallOutcome.NO_ANSWER;
    }
    if (answeredBy === "busy") {
      return CallOutcome.BUSY;
    }

    // Priority 2: ONLY mark as TRANSFERRED if warm_transfer_call.state === "MERGED"
    // This is the ONLY reliable indicator that customer (HUMAN) actually connected to agent
    if (raw.warm_transfer_call && raw.warm_transfer_call.state === "MERGED") {
      return CallOutcome.TRANSFERRED;
    }

    // Check if call completed successfully with human
    if (raw.completed && answeredBy === "human") {
      // Check if there's a callback request in variables
      if (raw.variables?.callback_requested === true) {
        return CallOutcome.CALLBACK;
      }
      // If completed with human but NO successful transfer, mark as CONFUSED
      // Customer may have qualified but hung up before/during transfer
      return CallOutcome.CONFUSED;
    }

    // Check error status
    if (raw.error_message || raw.status === "failed") {
      return CallOutcome.FAILED;
    }

    // Default - confused caller (unable to determine outcome)
    return CallOutcome.CONFUSED;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Processed call object - only fields we need (memory efficient)
   */
  private processCallObject(call: any): {
    call_id: string;
    pathway_tags: string[];
    status: string;
    answered_by: string;
    created_at: string;
  } {
    return {
      call_id: call.call_id,
      pathway_tags: call.pathway_tags || [],
      status: call.status,
      answered_by: call.answered_by || "",
      created_at: call.created_at,
    };
  }

  /**
   * Fetch a single hour's call logs from Bland API
   * Returns only necessary fields to minimize memory usage
   * @private
   */
  private async fetchHourlyCallLogs(
    date: string,
    hour: number,
    pathwayId?: string
  ): Promise<{
    hour: number;
    hourLabel: string;
    calls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }>;
    count: number;
    hitLimit: boolean;
    error?: string;
  }> {
    const hourStart = hour.toString().padStart(2, "0");
    const hourEnd = hour === 23 ? "23:59:59.999" : `${(hour + 1).toString().padStart(2, "0")}:00:00.000`;

    const fromDate = `${date}T${hourStart}:00:00.000Z`;
    const toDate = `${date}T${hourEnd}Z`;

    const params: Record<string, any> = {
      limit: 1000,
      from_date: fromDate,
      to_date: toDate,
      ...(pathwayId && { pathway_id: pathwayId }),
    };

    try {
      const response = await this.client.get("/v1/calls", { params });
      const rawCalls = response.data.calls || [];

      // Process immediately to free raw response memory
      // Only keep the fields we need
      const calls = rawCalls.map((call: any) => this.processCallObject(call));

      return {
        hour,
        hourLabel: `${hourStart}:00`,
        calls,
        count: calls.length,
        hitLimit: rawCalls.length >= 1000,
      };
    } catch (error: any) {
      return {
        hour,
        hourLabel: `${hourStart}:00`,
        calls: [],
        count: 0,
        hitLimit: false,
        error: error.message,
      };
    }
  }

  /**
   * Fetch call logs from Bland API for a specific date (PARALLEL - Fast)
   * Uses hourly time chunking to bypass Bland API's 1000 call limit.
   * Makes 24 API calls in parallel for speed.
   *
   * @param date - Date in YYYY-MM-DD format
   * @param pathwayId - Optional pathway ID filter (defaults to config pathway)
   * @returns Array of call objects with pathway_tags
   */
  async getCallLogsByDate(
    date: string,
    pathwayId?: string
  ): Promise<
    Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }>
  > {
    const targetPathwayId = pathwayId || config.bland.pathwayId;

    logger.info("Fetching call logs from Bland (PARALLEL)", {
      date,
      pathway_id: targetPathwayId,
    });

    const allCalls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }> = [];
    const seenCallIds = new Set<string>();

    try {
      // Execute all 24 hours in parallel
      const hourlyPromises = Array.from({ length: 24 }, (_, hour) =>
        this.fetchHourlyCallLogs(date, hour, targetPathwayId)
      );
      const hourlyResults = await Promise.all(hourlyPromises);

      // Aggregate and deduplicate
      for (const result of hourlyResults) {
        if (result.error) {
          logger.error("Failed to fetch calls for hour", {
            date,
            hour: result.hourLabel,
            error: result.error,
          });
        } else {
          logger.info("Fetched hourly chunk", {
            date,
            hour: result.hourLabel,
            count: result.count,
            hitLimit: result.hitLimit,
          });

          if (result.hitLimit) {
            logger.warn("Hit 1000 call limit for hour", { date, hour: result.hourLabel });
          }
        }

        // Calls are already processed - just deduplicate and add
        for (const call of result.calls) {
          if (!seenCallIds.has(call.call_id)) {
            seenCallIds.add(call.call_id);
            allCalls.push(call); // Already in correct format
          }
        }
      }

      logger.info("Finished fetching call logs (PARALLEL)", {
        date,
        total_calls: allCalls.length,
      });

      return allCalls;
    } catch (error: any) {
      logger.error("Failed to fetch call logs from Bland", {
        date,
        error: error.message,
      });
      throw new Error(`Failed to fetch call logs: ${error.message}`);
    }
  }

  /**
   * Fetch call logs from Bland API for a specific date (SEQUENTIAL - Detailed tracking)
   * Fetches hour by hour with detailed logging and progress tracking.
   * Use this for debugging or when you need per-hour visibility.
   *
   * @param date - Date in YYYY-MM-DD format
   * @param pathwayId - Optional pathway ID filter
   * @param onHourComplete - Optional callback for each hour's progress
   * @returns Object with calls array and hourly breakdown
   */
  async getCallLogsByDateSequential(
    date: string,
    pathwayId?: string,
    onHourComplete?: (hourData: {
      hour: number;
      hourLabel: string;
      count: number;
      totalSoFar: number;
      hitLimit: boolean;
    }) => void
  ): Promise<{
    calls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }>;
    hourlyBreakdown: Array<{
      hour: number;
      hourLabel: string;
      count: number;
      hitLimit: boolean;
      error?: string;
    }>;
  }> {
    const targetPathwayId = pathwayId || config.bland.pathwayId;

    logger.info("Fetching call logs from Bland (SEQUENTIAL)", {
      date,
      pathway_id: targetPathwayId,
    });

    const allCalls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }> = [];
    const seenCallIds = new Set<string>();
    const hourlyBreakdown: Array<{
      hour: number;
      hourLabel: string;
      count: number;
      hitLimit: boolean;
      error?: string;
    }> = [];

    for (let hour = 0; hour < 24; hour++) {
      const result = await this.fetchHourlyCallLogs(date, hour, targetPathwayId);

      hourlyBreakdown.push({
        hour: result.hour,
        hourLabel: result.hourLabel,
        count: result.count,
        hitLimit: result.hitLimit,
        error: result.error,
      });

      if (result.error) {
        logger.error("Failed to fetch calls for hour", {
          date,
          hour: result.hourLabel,
          error: result.error,
        });
      } else {
        // Calls are already processed - just deduplicate and add
        for (const call of result.calls) {
          if (!seenCallIds.has(call.call_id)) {
            seenCallIds.add(call.call_id);
            allCalls.push(call); // Already in correct format
          }
        }

        logger.info("Fetched hourly chunk (sequential)", {
          date,
          hour: result.hourLabel,
          count: result.count,
          totalSoFar: allCalls.length,
          hitLimit: result.hitLimit,
        });

        if (result.hitLimit) {
          logger.warn("Hit 1000 call limit for hour", { date, hour: result.hourLabel });
        }
      }

      // Callback for progress tracking
      if (onHourComplete) {
        onHourComplete({
          hour: result.hour,
          hourLabel: result.hourLabel,
          count: result.count,
          totalSoFar: allCalls.length,
          hitLimit: result.hitLimit,
        });
      }

      // Small delay between requests
      if (hour < 23) {
        await this.sleep(100);
      }
    }

    logger.info("Finished fetching call logs (SEQUENTIAL)", {
      date,
      total_calls: allCalls.length,
    });

    return { calls: allCalls, hourlyBreakdown };
  }

  /**
   * Fetch call logs for today up to the current hour (for live reports)
   * Only fetches completed hours to ensure accurate data.
   *
   * @param pathwayId - Optional pathway ID filter
   * @returns Object with calls, hourly breakdown, and metadata
   */
  async getCallLogsTodayUntilNow(pathwayId?: string): Promise<{
    date: string;
    currentHour: number;
    hoursProcessed: number;
    calls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }>;
    hourlyBreakdown: Array<{
      hour: number;
      hourLabel: string;
      count: number;
      hitLimit: boolean;
      error?: string;
    }>;
  }> {
    // Get current time in EST (same timezone as statistics service)
    const now = new Date();
    const estFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const hourFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    });

    const date = estFormatter.format(now);
    const currentHour = parseInt(hourFormatter.format(now), 10);
    const targetPathwayId = pathwayId || config.bland.pathwayId;

    logger.info("Fetching call logs for today until current hour", {
      date,
      currentHour,
      pathway_id: targetPathwayId,
    });

    const allCalls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }> = [];
    const seenCallIds = new Set<string>();
    const hourlyBreakdown: Array<{
      hour: number;
      hourLabel: string;
      count: number;
      hitLimit: boolean;
      error?: string;
    }> = [];

    // Fetch hours 0 to currentHour (inclusive) in parallel
    const hoursToFetch = currentHour + 1;
    const hourlyPromises = Array.from({ length: hoursToFetch }, (_, hour) =>
      this.fetchHourlyCallLogs(date, hour, targetPathwayId)
    );
    const hourlyResults = await Promise.all(hourlyPromises);

    for (const result of hourlyResults) {
      hourlyBreakdown.push({
        hour: result.hour,
        hourLabel: result.hourLabel,
        count: result.count,
        hitLimit: result.hitLimit,
        error: result.error,
      });

      if (!result.error) {
        // Calls are already processed - just deduplicate and add
        for (const call of result.calls) {
          if (!seenCallIds.has(call.call_id)) {
            seenCallIds.add(call.call_id);
            allCalls.push(call); // Already in correct format
          }
        }
      }
    }

    logger.info("Finished fetching call logs until current hour", {
      date,
      currentHour,
      hoursProcessed: hoursToFetch,
      total_calls: allCalls.length,
    });

    return {
      date,
      currentHour,
      hoursProcessed: hoursToFetch,
      calls: allCalls,
      hourlyBreakdown,
    };
  }
}

export const blandService = new BlandService();
