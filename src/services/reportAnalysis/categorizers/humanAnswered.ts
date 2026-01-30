import { CallData, CategorizerConfig, CategorizerResult } from "../types";

/**
 * Priority 8 (last): Human Answered Detection
 *
 * A call is "human answered" if:
 * - There's a real back-and-forth conversation (not voicemail/bot/busy/etc.)
 * - Duration is >20s
 * - No other categorizer matched first
 *
 * This runs LAST - if we get here, all other checks (voicemail, busy, etc.)
 * have already passed. So we just need to confirm there's a real conversation.
 */

export function detectHumanAnswered(
  call: CallData,
  config: CategorizerConfig
): CategorizerResult | null {
  const transcript = call.concatenated_transcript || "";
  const duration = call.call_length ?? call.corrected_duration ?? 0;
  const haConfig = config.humanAnswered || {};
  const minLength = haConfig.minTranscriptLength ?? 50;
  const minDuration = haConfig.minDurationSec ?? 20;

  // 1. Transcript: real conversation detected
  if (transcript.length >= minLength && duration >= minDuration) {
    return {
      category: "human_answered",
      confidence: "high",
      detection_method: "transcript",
      reason: `Conversation: ${transcript.length} chars, ${duration}s`,
    };
  }

  // 2. Transcript exists but shorter - still might be human
  if (transcript.length >= minLength && duration > 0) {
    return {
      category: "human_answered",
      confidence: "medium",
      detection_method: "transcript",
      reason: `Short conversation: ${transcript.length} chars, ${duration}s`,
    };
  }

  // 3. Fallback: answered_by = human with decent duration
  const answeredBy = (call.answered_by || "").toLowerCase();
  if (answeredBy === "human" && duration >= minDuration) {
    return {
      category: "human_answered",
      confidence: "medium",
      detection_method: "fallback",
      reason: `answered_by: human, ${duration}s`,
    };
  }

  return null;
}
