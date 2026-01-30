// ============================================================================
// Core Analyzer Engine
// ============================================================================

import { logger } from "../../utils/logger";
import {
  CallData,
  AnalysisResult,
  AnalysisStats,
  AnalysisReport,
  ClientConfig,
  CallCategory,
} from "./types";
import { categorizeCall } from "./categorizers";
import { BlandApiClient } from "./blandApiClient";

export class TranscriptAnalyzer {
  private config: ClientConfig;
  private blandClient: BlandApiClient | null;

  constructor(config: ClientConfig) {
    this.config = config;
    this.blandClient = config.blandApiKey
      ? new BlandApiClient(config.blandApiKey)
      : null;
  }

  /**
   * Analyze a single call (already has data)
   */
  analyzeCall(call: CallData): AnalysisResult {
    const result = categorizeCall(call, this.config.categorizers);

    return {
      call_id: call.call_id,
      category: result.category,
      confidence: result.confidence,
      detection_method: result.detection_method,
      reason: result.reason,
      transcript_snippet: (call.concatenated_transcript || "").substring(0, 120),
      duration: call.call_length ?? call.corrected_duration ?? 0,
      phone_number: call.to_number || call.from_number,
    };
  }

  /**
   * Analyze a batch of calls (already have data)
   */
  analyzeBatch(calls: CallData[]): AnalysisResult[] {
    return calls.map((c) => this.analyzeCall(c));
  }

  /**
   * Fetch call from Bland API and analyze it
   */
  async fetchAndAnalyze(callId: string): Promise<AnalysisResult | null> {
    if (!this.blandClient) {
      logger.error("No Bland API key configured");
      return null;
    }

    const call = await this.blandClient.fetchCall(callId);
    if (!call) return null;

    return this.analyzeCall(call);
  }

  /**
   * Fetch and analyze all calls for a date
   */
  async fetchAndAnalyzeDate(date: string): Promise<AnalysisResult[]> {
    if (!this.blandClient) {
      logger.error("No Bland API key configured");
      return [];
    }

    const calls = await this.blandClient.fetchCallsByDate(date, date);
    logger.info("Fetched calls for analysis", { date, count: calls.length });

    return this.analyzeBatch(calls);
  }

  /**
   * Fetch and analyze calls using call IDs from daily-calls files
   */
  async fetchAndAnalyzeCallIds(
    callIds: Array<{ callId: string; phone: string }>
  ): Promise<AnalysisResult[]> {
    if (!this.blandClient) {
      logger.error("No Bland API key configured");
      return [];
    }

    const results: AnalysisResult[] = [];
    let fetched = 0;
    let errors = 0;

    for (const { callId, phone } of callIds) {
      const call = await this.blandClient.fetchCall(callId);
      fetched++;

      if (call) {
        call.to_number = call.to_number || phone;
        results.push(this.analyzeCall(call));
      } else {
        errors++;
      }

      if (fetched % 25 === 0) {
        logger.info("Analysis progress", {
          fetched,
          total: callIds.length,
          errors,
        });
      }
    }

    logger.info("Analysis complete", { fetched, errors, results: results.length });
    return results;
  }

  /**
   * Calculate aggregated stats from analysis results
   */
  calculateStats(date: string, results: AnalysisResult[]): AnalysisStats {
    const counts: Record<CallCategory, number> = {
      failed: 0,
      voicemail: 0,
      busy: 0,
      no_answer: 0,
      callback: 0,
      transferred: 0,
      not_interested: 0,
      human_answered: 0,
    };

    for (const r of results) {
      counts[r.category]++;
    }

    const total = results.length;
    const failed = counts.failed;
    const completed = total - failed;
    const answered = counts.human_answered;
    const transferred = counts.transferred;

    return {
      date,
      total_calls: total,
      completed_calls: completed,
      failed_calls: failed,
      answered_calls: answered,
      transferred_calls: transferred,
      voicemail_calls: counts.voicemail,
      busy_calls: counts.busy,
      no_answer_calls: counts.no_answer,
      callback_requested_calls: counts.callback,
      not_interested_calls: counts.not_interested,
      connectivity_rate: answered > 0
        ? Number(((transferred / answered) * 100).toFixed(2))
        : 0,
      transfer_rate: answered > 0
        ? Number(((transferred / answered) * 100).toFixed(2))
        : 0,
      success_rate: total > 0
        ? Number(((completed / total) * 100).toFixed(2))
        : 0,
      voicemail_rate: total > 0
        ? Number(((counts.voicemail / total) * 100).toFixed(2))
        : 0,
    };
  }

  /**
   * Generate a full report
   */
  generateReport(date: string, results: AnalysisResult[]): AnalysisReport {
    const stats = this.calculateStats(date, results);

    const breakdown: Record<CallCategory, AnalysisResult[]> = {
      failed: [],
      voicemail: [],
      busy: [],
      no_answer: [],
      callback: [],
      transferred: [],
      not_interested: [],
      human_answered: [],
    };

    for (const r of results) {
      breakdown[r.category].push(r);
    }

    return {
      date,
      config_name: this.config.name,
      stats,
      calls: results,
      category_breakdown: breakdown,
      generated_at: new Date().toISOString(),
    };
  }
}
