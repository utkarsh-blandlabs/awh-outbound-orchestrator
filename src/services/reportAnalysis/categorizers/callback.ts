import { CallData, CategorizerConfig, CategorizerResult } from "../types";

/**
 * Priority 5: Callback Detection
 * Detects calls where person requests a callback.
 */

const DEFAULT_PATTERNS: RegExp[] = [
  /call\s+(?:me\s+)?back/i,
  /try\s+(?:me\s+)?(?:again|back)\s+(?:later|tomorrow|next)/i,
  /(?:not|isn'?t)\s+a\s+good\s+time/i,
  /(?:give|send)\s+me\s+a\s+call\s+(?:back|later|tomorrow)/i,
  /can\s+(?:you|someone)\s+(?:call|ring)\s+(?:me\s+)?(?:back|later|tomorrow)/i,
  /i'?ll\s+call\s+(?:you\s+)?back/i,
];

export function detectCallback(
  call: CallData,
  config: CategorizerConfig
): CategorizerResult | null {
  const transcript = call.concatenated_transcript || "";
  const cbConfig = config.callback || {};

  const patterns = [...DEFAULT_PATTERNS];
  if (cbConfig.extraPatterns) {
    for (const p of cbConfig.extraPatterns) {
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
          category: "callback",
          confidence: "high",
          detection_method: "transcript",
          reason: `Matched: ${pattern.source.substring(0, 40)}`,
        };
      }
    }
  }

  // 2. Fallback: variables.callback_requested
  if (call.variables?.["callback_requested"] === true) {
    return {
      category: "callback",
      confidence: "medium",
      detection_method: "fallback",
      reason: "variables.callback_requested = true",
    };
  }

  return null;
}
