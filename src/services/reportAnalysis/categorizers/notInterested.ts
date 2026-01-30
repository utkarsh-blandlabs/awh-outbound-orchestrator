import { CallData, CategorizerConfig, CategorizerResult } from "../types";

/**
 * Priority 7: Not Interested Detection
 * Detects calls where person explicitly declines.
 */

const DEFAULT_PATTERNS: RegExp[] = [
  /(?:i'?m\s+)?not\s+interested/i,
  /no\s+thanks?/i,
  /don'?t\s+(?:call|contact)\s+(?:me\s+)?(?:again|anymore|back)/i,
  /(?:remove|take)\s+me\s+(?:from|off)\s+(?:your|the)\s+(?:list|system)/i,
  /(?:stop|quit)\s+calling\s+me/i,
  /(?:put|add)\s+me\s+on\s+(?:the\s+)?(?:do\s+)?not\s+call/i,
  /i\s+don'?t\s+(?:want|need)\s+(?:this|that|it|any)/i,
  /(?:we'?re|i'?m)\s+(?:all\s+)?(?:set|good|fine)/i,
];

export function detectNotInterested(
  call: CallData,
  config: CategorizerConfig
): CategorizerResult | null {
  const transcript = call.concatenated_transcript || "";
  const niConfig = config.notInterested || {};

  const patterns = [...DEFAULT_PATTERNS];
  if (niConfig.extraPatterns) {
    for (const p of niConfig.extraPatterns) {
      try {
        patterns.push(new RegExp(p, "i"));
      } catch (_) {}
    }
  }

  // Transcript only - no fallback for this category
  if (transcript.length > 10) {
    for (const pattern of patterns) {
      if (pattern.test(transcript)) {
        return {
          category: "not_interested",
          confidence: "high",
          detection_method: "transcript",
          reason: `Matched: ${pattern.source.substring(0, 40)}`,
        };
      }
    }
  }

  return null;
}
