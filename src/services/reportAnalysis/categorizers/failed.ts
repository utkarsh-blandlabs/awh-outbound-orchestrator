import { CallData, CategorizerConfig, CategorizerResult } from "../types";

/**
 * Priority 1: Failed Call Detection
 * Detects calls that failed due to errors or technical issues.
 */
export function detectFailed(
  call: CallData,
  _config: CategorizerConfig
): CategorizerResult | null {
  // Direct error
  if (call.error_message) {
    return {
      category: "failed",
      confidence: "high",
      detection_method: "fallback",
      reason: `Error: ${call.error_message}`,
    };
  }

  // Status is failed
  if (call.status === "failed" || call.status === "error") {
    return {
      category: "failed",
      confidence: "high",
      detection_method: "fallback",
      reason: `Status: ${call.status}`,
    };
  }

  return null;
}
