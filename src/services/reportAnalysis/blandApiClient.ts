// ============================================================================
// Bland API Client - Fetches call data with rate limiting
// ============================================================================

import axios from "axios";
import { CallData } from "./types";
import { logger } from "../../utils/logger";

const BLAND_BASE_URL = "https://api.bland.ai";
const DEFAULT_RATE_LIMIT_MS = 150;

export class BlandApiClient {
  private apiKey: string;
  private rateLimitMs: number;
  private lastCallTime = 0;

  constructor(apiKey: string, rateLimitMs = DEFAULT_RATE_LIMIT_MS) {
    this.apiKey = apiKey;
    this.rateLimitMs = rateLimitMs;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.rateLimitMs) {
      await new Promise((r) => setTimeout(r, this.rateLimitMs - elapsed));
    }
    this.lastCallTime = Date.now();
  }

  /**
   * Fetch a single call by ID
   */
  async fetchCall(callId: string): Promise<CallData | null> {
    await this.rateLimit();

    try {
      const res = await axios.get(`${BLAND_BASE_URL}/v1/calls/${callId}`, {
        headers: { Authorization: this.apiKey },
        timeout: 10000,
      });

      const d = res.data;
      return {
        call_id: d.call_id || d.c_id || callId,
        to_number: d.to,
        from_number: d.from,
        concatenated_transcript: d.concatenated_transcript || "",
        status: d.status,
        answered_by: d.answered_by,
        call_length: d.call_length,
        corrected_duration: d.corrected_duration,
        error_message: d.error_message,
        pathway_tags: d.pathway_tags,
        warm_transfer_call: d.warm_transfer_call,
        variables: d.variables,
        summary: d.summary,
        inbound: d.inbound,
        created_at: d.created_at,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.warn("Call not found in Bland API", { callId });
        return null;
      }
      logger.warn("Failed to fetch call from Bland API", {
        callId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Map raw Bland API call object to CallData
   */
  private mapCallData(d: any): CallData {
    return {
      call_id: d.call_id || d.c_id,
      to_number: d.to,
      from_number: d.from,
      concatenated_transcript: d.concatenated_transcript || "",
      status: d.status,
      answered_by: d.answered_by,
      call_length: d.call_length,
      corrected_duration: d.corrected_duration,
      error_message: d.error_message,
      pathway_tags: d.pathway_tags,
      warm_transfer_call: d.warm_transfer_call,
      variables: d.variables,
      summary: d.summary,
      inbound: d.inbound,
      created_at: d.created_at,
    };
  }

  /**
   * Fetch calls for a date range using from/to pagination with start_date/end_date filtering.
   * Automatically paginates through all results.
   */
  async fetchCallsByDate(
    fromDate: string,
    toDate: string,
    limit = 1000
  ): Promise<CallData[]> {
    const PAGE_SIZE = Math.min(limit, 1000);
    const MAX_PAGES = 100;

    // end_date is exclusive in Bland API, so add one day to toDate
    const endDate = new Date(toDate + "T00:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endDateStr = endDate.toISOString().split("T")[0];

    const allCalls: CallData[] = [];
    const seenIds = new Set<string>();
    let page = 0;
    let hasMore = true;

    try {
      while (hasMore && page < MAX_PAGES) {
        await this.rateLimit();

        const res = await axios.get(`${BLAND_BASE_URL}/v1/calls`, {
          headers: { Authorization: this.apiKey },
          timeout: 30000,
          params: {
            start_date: fromDate,
            end_date: endDateStr,
            from: page * PAGE_SIZE,
            to: (page + 1) * PAGE_SIZE,
          },
        });

        const rawCalls = res.data?.calls || res.data || [];
        const calls = (Array.isArray(rawCalls) ? rawCalls : []);

        for (const d of calls) {
          const call = this.mapCallData(d);
          if (call.call_id && !seenIds.has(call.call_id)) {
            seenIds.add(call.call_id);
            allCalls.push(call);
          }
        }

        if (calls.length < PAGE_SIZE) {
          hasMore = false;
        }

        page++;
      }

      return allCalls;
    } catch (error: any) {
      logger.error("Failed to fetch calls by date", {
        fromDate,
        toDate,
        error: error.message,
      });
      return allCalls.length > 0 ? allCalls : [];
    }
  }
}
