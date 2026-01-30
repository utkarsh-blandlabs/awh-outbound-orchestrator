import { CallData, CategorizerConfig, CategorizerResult } from "../types";

/**
 * Priority 3: Busy Detection
 * Detects calls where person is busy / can't talk now.
 */

const DEFAULT_PATTERNS: RegExp[] = [
  /(?:i'?m|i\s+am)\s+(?:really\s+)?busy\s+(?:right\s+)?now/i,
  /can'?t\s+talk\s+(?:right\s+)?now/i,
  /(?:i'?m|i\s+am)\s+(?:in\s+)?(?:a\s+)?meeting/i,
  /(?:i'?m|i\s+am)\s+(?:at|in)\s+(?:work|the\s+office)/i,
  /(?:i'?m|i\s+am)\s+driving/i,
  /this\s+(?:is|isn'?t)\s+(?:not\s+)?a\s+good\s+time/i,
  /bad\s+time\s+(?:right\s+)?now/i,
];

export function detectBusy(
  call: CallData,
  config: CategorizerConfig
): CategorizerResult | null {
  const transcript = call.concatenated_transcript || "";
  const busyConfig = config.busy || {};

  // Build patterns
  const patterns = [...DEFAULT_PATTERNS];
  if (busyConfig.extraPatterns) {
    for (const p of busyConfig.extraPatterns) {
      try {
        patterns.push(new RegExp(p, "i"));
      } catch (_) {}
    }
  }

  // 1. Transcript
  if (transcript.length > 10) {
    for (const pattern of patterns) {
      if (pattern.test(transcript)) {
        return {
          category: "busy",
          confidence: "high",
          detection_method: "transcript",
          reason: `Matched: ${pattern.source.substring(0, 40)}`,
        };
      }
    }
  }

  // 2. Fallback
  const answeredBy = (call.answered_by || "").toLowerCase();
  if (answeredBy === "busy" || call.status === "busy") {
    return {
      category: "busy",
      confidence: "medium",
      detection_method: "fallback",
      reason: `answered_by: ${call.answered_by || call.status}`,
    };
  }

  return null;
}
