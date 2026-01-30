import { CallData, CategorizerConfig, CategorizerResult } from "../types";

/**
 * Priority 6: Transfer Detection
 * Can't reliably detect from transcript.
 * Uses warm_transfer_call.state === "MERGED" as the only reliable source.
 */

export function detectTransferred(
  call: CallData,
  config: CategorizerConfig
): CategorizerResult | null {
  const tConfig = config.transferred || {};
  const requireMerged = tConfig.requireMergedState !== false; // default true

  // Primary: warm_transfer_call.state === "MERGED"
  if (
    requireMerged &&
    call.warm_transfer_call?.state === "MERGED"
  ) {
    return {
      category: "transferred",
      confidence: "high",
      detection_method: "fallback",
      reason: "warm_transfer_call.state = MERGED",
    };
  }

  // If not requiring MERGED, also check transferred_to field
  if (!requireMerged && call.warm_transfer_call?.state) {
    return {
      category: "transferred",
      confidence: "medium",
      detection_method: "fallback",
      reason: `warm_transfer_call.state = ${call.warm_transfer_call.state}`,
    };
  }

  return null;
}
