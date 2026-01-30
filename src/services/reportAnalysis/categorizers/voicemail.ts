import { CallData, CategorizerConfig, CategorizerResult } from "../types";

/**
 * Priority 2: Voicemail Detection
 * Uses transcript pattern-matching as primary detection.
 * Falls back to answered_by field.
 */

const DEFAULT_PATTERNS: RegExp[] = [
  /leave\s+(?:a\s+)?message/i,
  /after\s+the\s+(?:beep|tone)/i,
  /not\s+available\s+(?:right\s+now|at\s+the\s+moment|to\s+take)/i,
  /please\s+(?:leave|record)\s+your/i,
  /you\s+have\s+reached\s+(?:the\s+)?voicemail/i,
  /(?:unable|not\s+able)\s+to\s+(?:take|answer)\s+your\s+call/i,
  /the\s+(?:person|party|number)\s+you\s+(?:have\s+)?(?:called|dialed|are\s+trying)/i,
  /(?:press|dial)\s+\d+\s+to\s+(?:accept|leave|send)/i,
  /caller\s+please\s+state\s+your\s+name/i,
  /this\s+call\s+is\s+being\s+screened/i,
  /mailbox\s+is\s+full/i,
  /your\s+call\s+(?:has\s+been|is\s+being)\s+(?:forwarded|transferred)\s+to\s+(?:an?\s+)?(?:automated|voice)/i,
  /at\s+the\s+tone\s*,?\s*please\s+record/i,
];

export function detectVoicemail(
  call: CallData,
  config: CategorizerConfig
): CategorizerResult | null {
  const transcript = call.concatenated_transcript || "";
  const duration = call.call_length ?? call.corrected_duration ?? 0;
  const vmConfig = config.voicemail || {};
  const monologueThreshold = vmConfig.monologueThresholdSec ?? 15;
  const minHellos = vmConfig.minMonologueHellos ?? 2;

  // Build patterns list (defaults + any client extras)
  const patterns = [...DEFAULT_PATTERNS];
  if (vmConfig.extraPatterns) {
    for (const p of vmConfig.extraPatterns) {
      try {
        patterns.push(new RegExp(p, "i"));
      } catch (_) {
        // skip invalid regex
      }
    }
  }

  // 1. Transcript pattern matching
  if (transcript.length > 5) {
    for (const pattern of patterns) {
      if (pattern.test(transcript)) {
        return {
          category: "voicemail",
          confidence: "high",
          detection_method: "transcript",
          reason: `Matched: ${pattern.source.substring(0, 40)}`,
        };
      }
    }

    // 2. Agent-only monologue detection
    if (duration > 0 && duration < monologueThreshold) {
      const helloCount = (transcript.match(/hello/gi) || []).length;
      const questionMarks = (transcript.match(/\?/g) || []).length;

      if (
        helloCount >= minHellos &&
        questionMarks >= minHellos &&
        transcript.length < 300
      ) {
        return {
          category: "voicemail",
          confidence: "medium",
          detection_method: "transcript",
          reason: `Agent monologue: ${helloCount} hellos, ${duration}s, no response`,
        };
      }
    }
  }

  // 3. Fallback: answered_by field
  const answeredBy = (call.answered_by || "").toLowerCase();
  if (
    answeredBy === "voicemail" ||
    answeredBy === "machine" ||
    answeredBy === "answering_machine"
  ) {
    return {
      category: "voicemail",
      confidence: "medium",
      detection_method: "fallback",
      reason: `answered_by: ${call.answered_by}`,
    };
  }

  return null;
}
