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
   * Fetch calls for a date range (uses list endpoint)
   */
  async fetchCallsByDate(
    fromDate: string,
    toDate: string,
    limit = 1000
  ): Promise<CallData[]> {
    await this.rateLimit();

    try {
      const res = await axios.get(`${BLAND_BASE_URL}/v1/calls`, {
        headers: { Authorization: this.apiKey },
        timeout: 30000,
        params: {
          from_date: `${fromDate}T00:00:00.000Z`,
          to_date: `${toDate}T23:59:59.999Z`,
          limit,
        },
      });

      const calls = res.data?.calls || res.data || [];
      return (Array.isArray(calls) ? calls : []).map((d: any) => ({
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
      }));
    } catch (error: any) {
      logger.error("Failed to fetch calls by date", {
        fromDate,
        toDate,
        error: error.message,
      });
      return [];
    }
  }
}
