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
import { numberPoolService } from "./numberPoolService";

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
   * Select a phone number from the pool (if enabled)
   * Uses intelligent weighted selection based on per-number performance
   * and lead-number mapping for preferred number matching.
   */
  private selectFromNumber(leadId?: string, phoneNumber?: string): string {
    // If pool is not enabled or empty, use single number
    if (!config.bland.usePool || config.bland.fromPool.length === 0) {
      return config.bland.from;
    }

    return numberPoolService.selectNumber(leadId, phoneNumber);
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
    // Select phone number from pool using intelligent weighted selection
    const selectedFromNumber = this.selectFromNumber(payload.leadId, payload.phoneNumber);

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
   * Fetch a single page of call logs from Bland API
   * Uses from/to offset pagination with start_date/end_date filtering.
   * @private
   */
  private async fetchCallPage(
    offset: number,
    pageSize: number,
    dateParams?: { start_date: string; end_date?: string },
    pathwayId?: string
  ): Promise<{
    calls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }>;
    totalCount: number;
    returned: number;
    error?: string;
  }> {
    const params: Record<string, any> = {
      from: offset,
      to: offset + pageSize,
      ...(dateParams?.start_date && { start_date: dateParams.start_date }),
      ...(dateParams?.end_date && { end_date: dateParams.end_date }),
      ...(pathwayId && { pathway_id: pathwayId }),
    };

    try {
      const response = await this.client.get("/v1/calls", { params });
      const rawCalls = response.data.calls || [];
      const totalCount = response.data.total_count || 0;

      // Process immediately to free raw response memory
      const calls = rawCalls.map((call: any) => this.processCallObject(call));

      return {
        calls,
        totalCount,
        returned: calls.length,
      };
    } catch (error: any) {
      return {
        calls: [],
        totalCount: 0,
        returned: 0,
        error: error.message,
      };
    }
  }

  /**
   * Fetch ALL call logs using from/to pagination.
   * Makes an initial request to get total_count, then fetches remaining pages in parallel.
   * @private
   */
  private async fetchAllCallsPaginated(
    dateParams?: { start_date: string; end_date?: string },
    pathwayId?: string,
    onPageComplete?: (pageData: {
      page: number;
      totalPages: number;
      count: number;
      totalSoFar: number;
    }) => void
  ): Promise<{
    calls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }>;
    totalCount: number;
    pagesUsed: number;
  }> {
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 100; // Safety cap: 100k calls max

    // First request to get total_count and first page
    const firstPage = await this.fetchCallPage(0, PAGE_SIZE, dateParams, pathwayId);

    if (firstPage.error) {
      logger.error("Failed to fetch first page of calls", { error: firstPage.error });
      throw new Error(`Failed to fetch calls: ${firstPage.error}`);
    }

    const totalCount = firstPage.totalCount;
    const totalPages = Math.min(Math.ceil(totalCount / PAGE_SIZE), MAX_PAGES);

    logger.info("Paginated fetch started", {
      totalCount,
      totalPages,
      firstPageReturned: firstPage.returned,
      dateParams,
    });

    if (onPageComplete) {
      onPageComplete({ page: 1, totalPages, count: firstPage.returned, totalSoFar: firstPage.returned });
    }

    // If first page has everything, return immediately
    if (firstPage.returned < PAGE_SIZE || totalPages <= 1) {
      return { calls: firstPage.calls, totalCount, pagesUsed: 1 };
    }

    // Fetch remaining pages in parallel (batches of 10 to avoid overwhelming the API)
    const allCalls = [...firstPage.calls];
    const seenCallIds = new Set(firstPage.calls.map((c) => c.call_id));
    const PARALLEL_BATCH = 10;

    for (let batchStart = 1; batchStart < totalPages; batchStart += PARALLEL_BATCH) {
      const batchEnd = Math.min(batchStart + PARALLEL_BATCH, totalPages);
      const pagePromises = [];

      for (let page = batchStart; page < batchEnd; page++) {
        pagePromises.push(this.fetchCallPage(page * PAGE_SIZE, PAGE_SIZE, dateParams, pathwayId));
      }

      const pageResults = await Promise.all(pagePromises);

      for (let i = 0; i < pageResults.length; i++) {
        const result = pageResults[i]!;
        const pageNum = batchStart + i + 1;

        if (result.error) {
          logger.error("Failed to fetch page", { page: pageNum, error: result.error });
          continue;
        }

        // Deduplicate
        for (const call of result.calls) {
          if (!seenCallIds.has(call.call_id)) {
            seenCallIds.add(call.call_id);
            allCalls.push(call);
          }
        }

        if (onPageComplete) {
          onPageComplete({ page: pageNum, totalPages, count: result.returned, totalSoFar: allCalls.length });
        }
      }

      // Small delay between parallel batches to respect rate limits
      if (batchEnd < totalPages) {
        await this.sleep(200);
      }
    }

    return { calls: allCalls, totalCount, pagesUsed: totalPages };
  }

  /**
   * Fetch call logs from Bland API for a specific date (PARALLEL - Fast)
   * Uses from/to pagination with start_date/end_date filtering.
   * Fetches first page to get total_count, then remaining pages in parallel.
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

    // end_date is exclusive in Bland API, so add one day
    const endDate = new Date(date + "T00:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endDateStr = endDate.toISOString().split("T")[0];

    logger.info("Fetching call logs from Bland (paginated)", {
      date,
      end_date: endDateStr,
      pathway_id: targetPathwayId,
    });

    try {
      const result = await this.fetchAllCallsPaginated(
        { start_date: date, end_date: endDateStr },
        targetPathwayId
      );

      logger.info("Finished fetching call logs", {
        date,
        total_calls: result.calls.length,
        total_count_api: result.totalCount,
        pages_used: result.pagesUsed,
      });

      return result.calls;
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
   * Fetches page by page with detailed logging and progress tracking.
   * Use this for debugging or when you need per-page visibility.
   *
   * @param date - Date in YYYY-MM-DD format
   * @param pathwayId - Optional pathway ID filter
   * @param onPageComplete - Optional callback for each page's progress
   * @returns Object with calls array and page breakdown
   */
  async getCallLogsByDateSequential(
    date: string,
    pathwayId?: string,
    onPageComplete?: (pageData: {
      page: number;
      totalPages: number;
      count: number;
      totalSoFar: number;
    }) => void
  ): Promise<{
    calls: Array<{
      call_id: string;
      pathway_tags: string[];
      status: string;
      answered_by: string;
      created_at: string;
    }>;
    pageBreakdown: Array<{
      page: number;
      count: number;
      error?: string;
    }>;
  }> {
    const targetPathwayId = pathwayId || config.bland.pathwayId;
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 100;

    // end_date is exclusive in Bland API, so add one day
    const endDate = new Date(date + "T00:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endDateStr = endDate.toISOString().split("T")[0];
    const dateParams = { start_date: date, end_date: endDateStr };

    logger.info("Fetching call logs from Bland (sequential/paginated)", {
      date,
      end_date: endDateStr,
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
    const pageBreakdown: Array<{
      page: number;
      count: number;
      error?: string;
    }> = [];

    let page = 0;
    let hasMore = true;

    while (hasMore && page < MAX_PAGES) {
      const result = await this.fetchCallPage(page * PAGE_SIZE, PAGE_SIZE, dateParams, targetPathwayId);

      pageBreakdown.push({
        page,
        count: result.returned,
        error: result.error,
      });

      if (result.error) {
        logger.error("Failed to fetch page", {
          date,
          page,
          error: result.error,
        });
        hasMore = false;
      } else {
        for (const call of result.calls) {
          if (!seenCallIds.has(call.call_id)) {
            seenCallIds.add(call.call_id);
            allCalls.push(call);
          }
        }

        logger.info("Fetched page (sequential)", {
          date,
          page,
          count: result.returned,
          totalSoFar: allCalls.length,
          totalCount: result.totalCount,
        });

        if (onPageComplete) {
          const totalPages = Math.ceil(result.totalCount / PAGE_SIZE);
          onPageComplete({
            page: page + 1,
            totalPages,
            count: result.returned,
            totalSoFar: allCalls.length,
          });
        }

        if (result.returned < PAGE_SIZE) {
          hasMore = false;
        }
      }

      page++;

      // Small delay between requests
      if (hasMore) {
        await this.sleep(100);
      }
    }

    logger.info("Finished fetching call logs (sequential)", {
      date,
      total_calls: allCalls.length,
      pages_used: page,
    });

    return { calls: allCalls, pageBreakdown };
  }

  /**
   * Fetch call logs for today up to now (for live reports)
   * Uses start_date=today with from/to pagination.
   *
   * @param pathwayId - Optional pathway ID filter
   * @returns Object with calls and metadata
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

    // end_date = tomorrow (exclusive)
    const endDate = new Date(date + "T00:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endDateStr = endDate.toISOString().split("T")[0];

    logger.info("Fetching call logs for today until now (paginated)", {
      date,
      currentHour,
      pathway_id: targetPathwayId,
    });

    try {
      const result = await this.fetchAllCallsPaginated(
        { start_date: date, end_date: endDateStr },
        targetPathwayId
      );

      // Build hourly breakdown from the fetched calls for backward compatibility
      const hourlyBreakdown: Array<{
        hour: number;
        hourLabel: string;
        count: number;
        hitLimit: boolean;
        error?: string;
      }> = [];

      const hourCounts = new Map<number, number>();
      for (const call of result.calls) {
        const callDate = new Date(call.created_at);
        const callHour = callDate.getUTCHours();
        hourCounts.set(callHour, (hourCounts.get(callHour) || 0) + 1);
      }

      for (let h = 0; h <= currentHour; h++) {
        const count = hourCounts.get(h) || 0;
        hourlyBreakdown.push({
          hour: h,
          hourLabel: `${h.toString().padStart(2, "0")}:00`,
          count,
          hitLimit: false, // No longer relevant with proper pagination
        });
      }

      logger.info("Finished fetching call logs for today", {
        date,
        currentHour,
        total_calls: result.calls.length,
        pages_used: result.pagesUsed,
      });

      return {
        date,
        currentHour,
        hoursProcessed: currentHour + 1,
        calls: result.calls,
        hourlyBreakdown,
      };
    } catch (error: any) {
      logger.error("Failed to fetch today's call logs", {
        date,
        error: error.message,
      });
      throw new Error(`Failed to fetch today's call logs: ${error.message}`);
    }
  }
}

export const blandService = new BlandService();
