// ============================================================================
// Categorizer Registry - Runs categorizers in priority order
// ============================================================================

import { CallData, CategorizerConfig, CategorizerResult, CallCategory } from "../types";
import { detectFailed } from "./failed";
import { detectVoicemail } from "./voicemail";
import { detectBusy } from "./busy";
import { detectCallback } from "./callback";
import { detectTransferred } from "./transferred";
import { detectNotInterested } from "./notInterested";
import { detectHumanAnswered } from "./humanAnswered";

type DetectFn = (call: CallData, config: CategorizerConfig) => CategorizerResult | null;

/**
 * Ordered list of categorizers. First match wins.
 */
const CATEGORIZER_PIPELINE: Array<{ name: CallCategory; detect: DetectFn }> = [
  { name: "failed",          detect: detectFailed },
  { name: "voicemail",       detect: detectVoicemail },
  { name: "busy",            detect: detectBusy },
  // no_answer is handled inline below (no dedicated categorizer - just checks duration/transcript)
  { name: "callback",        detect: detectCallback },
  { name: "transferred",     detect: detectTransferred },
  { name: "not_interested",  detect: detectNotInterested },
  { name: "human_answered",  detect: detectHumanAnswered },
];

/**
 * Run all categorizers in priority order against a single call.
 * Returns the first match, or a "no_answer" default.
 */
export function categorizeCall(
  call: CallData,
  config: CategorizerConfig
): CategorizerResult {
  // Check no_answer before running pipeline (priority 4, between busy and callback)
  const noAnswerResult = checkNoAnswer(call, config);

  for (const { name, detect } of CATEGORIZER_PIPELINE) {
    // Insert no_answer check at the right priority position (after busy, before callback)
    if (name === "callback" && noAnswerResult) {
      return noAnswerResult;
    }

    const result = detect(call, config);
    if (result) {
      return result;
    }
  }

  // If nothing matched and no_answer didn't trigger, default to no_answer
  return noAnswerResult || {
    category: "no_answer",
    confidence: "low",
    detection_method: "derived",
    reason: "No categorizer matched",
  };
}

/**
 * Priority 4: No Answer Detection
 * Empty/no transcript + short duration
 */
function checkNoAnswer(
  call: CallData,
  config: CategorizerConfig
): CategorizerResult | null {
  const transcript = call.concatenated_transcript || "";
  const duration = call.call_length ?? call.corrected_duration ?? 0;
  const maxDuration = config.noAnswer?.maxDurationSec ?? 5;

  // No transcript + very short call
  if (transcript.length < 10 && duration < maxDuration && duration >= 0) {
    // Check answered_by first
    const answeredBy = (call.answered_by || "").toLowerCase();
    if (
      answeredBy === "no-answer" ||
      answeredBy === "no_answer" ||
      answeredBy === "no answer"
    ) {
      return {
        category: "no_answer",
        confidence: "high",
        detection_method: "fallback",
        reason: `answered_by: ${call.answered_by}`,
      };
    }

    // Short call with no transcript
    if (duration < maxDuration && call.status !== "failed") {
      return {
        category: "no_answer",
        confidence: "medium",
        detection_method: "derived",
        reason: `No transcript, ${duration}s duration`,
      };
    }
  }

  // Fallback: answered_by field only
  const answeredBy = (call.answered_by || "").toLowerCase();
  if (
    answeredBy === "no-answer" ||
    answeredBy === "no_answer" ||
    answeredBy === "no answer"
  ) {
    return {
      category: "no_answer",
      confidence: "medium",
      detection_method: "fallback",
      reason: `answered_by: ${call.answered_by}`,
    };
  }

  return null;
}
