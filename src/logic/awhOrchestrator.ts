// ============================================================================
// AWH Orchestrator
// Coordinates the entire outbound call flow with modular stage handling
// ============================================================================

import { logger } from "../utils/logger";
import { errorLogger } from "../utils/errorLogger";
import { blandService } from "../services/blandService";
import { CallStateManager } from "../services/callStateManager";
import {
  ConvosoWebhookPayload,
  OrchestrationResult,
  CallOutcome,
  BlandOutboundCallResponse,
} from "../types/awh";

/**
 * Orchestration stages for tracking progress
 * With webhook-based approach:
 * 1. Convoso Webhook → Start orchestration
 * 2. Bland Call → Initiate call with webhook URL
 * 3. (Wait for Bland webhook callback) → Handled by blandWebhook route
 * 4. Convoso Update → Update call log when webhook received
 */
enum OrchestrationStage {
  INIT = "INIT",
  BLAND_CALL = "BLAND_CALL",
  WEBHOOK_REGISTERED = "WEBHOOK_REGISTERED",
  COMPLETE = "COMPLETE",
}

/**
 * Stage result interface for better error tracking
 */
interface StageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  stage: OrchestrationStage;
  duration_ms: number;
}

/**
 * Main orchestration function for AWH outbound flow
 */
export async function handleAwhOutbound(
  payload: ConvosoWebhookPayload,
  requestId?: string
): Promise<OrchestrationResult> {
  const startTime = Date.now();
  let currentStage = OrchestrationStage.INIT;

  logger.info("🚀 Starting AWH outbound orchestration", {
    request_id: requestId,
    phone: payload.phone_number,
    name: `${payload.first_name} ${payload.last_name}`,
    state: payload.state,
  });

  try {
    // Stage 1: Trigger Bland outbound call with webhook URL
    const callResult = await executeStage(
      OrchestrationStage.BLAND_CALL,
      () => triggerOutboundCall(payload),
      requestId
    );
    if (!callResult.success || !callResult.data) {
      throw new Error(
        `Stage ${OrchestrationStage.BLAND_CALL} failed: ${callResult.error}`
      );
    }
    currentStage = OrchestrationStage.BLAND_CALL;
    const callResponse = callResult.data;

    // Stage 2: Register call state for webhook tracking
    CallStateManager.addPendingCall(
      callResponse.call_id,
      requestId || "",
      payload.lead_id,
      payload.phone_number,
      payload.first_name,
      payload.last_name
    );
    currentStage = OrchestrationStage.WEBHOOK_REGISTERED;

    logger.info("✅ Call initiated successfully, waiting for Bland webhook", {
      request_id: requestId,
      lead_id: payload.lead_id,
      call_id: callResponse.call_id,
      note: "Bland will POST to webhook when call completes",
    });

    // Success! (Call initiated, webhook will handle completion)
    const duration = Date.now() - startTime;
    logger.info("✅ AWH orchestration initiated successfully", {
      request_id: requestId,
      lead_id: payload.lead_id,
      call_id: callResponse.call_id,
      duration_ms: duration,
      stages_completed: currentStage,
      next_step: "Waiting for Bland webhook callback",
    });

    return {
      success: true,
      lead_id: payload.lead_id,
      call_id: callResponse.call_id,
      outcome: CallOutcome.NO_ANSWER, // Will be updated when webhook arrives
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    logger.error("❌ AWH orchestration failed", {
      request_id: requestId,
      failed_at_stage: currentStage,
      error: error.message,
      stack: error.stack,
      duration_ms: duration,
      phone: payload.phone_number,
    });

    // Log error to separate error log
    errorLogger.logError(
      requestId || "unknown",
      "STAGE_FAILED",
      error.message,
      {
        stage: currentStage,
        phoneNumber: payload.phone_number,
        leadId: payload.lead_id,
        stackTrace: error.stack,
        durationMs: duration,
      }
    );

    return {
      success: false,
      lead_id: "",
      call_id: "",
      outcome: CallOutcome.FAILED,
      error: `Failed at stage ${currentStage}: ${error.message}`,
    };
  }
}

/**
 * Execute a stage with error handling and timing
 */
async function executeStage<T>(
  stage: OrchestrationStage,
  fn: () => Promise<T>,
  requestId?: string
): Promise<StageResult<T>> {
  const stageStart = Date.now();
  const stageEmoji = getStageEmoji(stage);

  logger.info(`${stageEmoji} Stage: ${stage} - Starting`, {
    request_id: requestId,
    stage,
  });

  try {
    const result = await fn();
    const duration = Date.now() - stageStart;

    logger.info(`✓ Stage: ${stage} - Completed`, {
      request_id: requestId,
      stage,
      duration_ms: duration,
    });

    return {
      success: true,
      data: result,
      stage,
      duration_ms: duration,
    };
  } catch (error: any) {
    const duration = Date.now() - stageStart;

    logger.error(`✗ Stage: ${stage} - Failed`, {
      request_id: requestId,
      stage,
      error: error.message,
      duration_ms: duration,
    });

    return {
      success: false,
      error: error.message,
      stage,
      duration_ms: duration,
    };
  }
}

/**
 * Get emoji for each stage
 */
function getStageEmoji(stage: OrchestrationStage): string {
  const emojiMap: Record<OrchestrationStage, string> = {
    [OrchestrationStage.INIT]: "🚀",
    [OrchestrationStage.BLAND_CALL]: "📞",
    [OrchestrationStage.WEBHOOK_REGISTERED]: "🔔",
    [OrchestrationStage.COMPLETE]: "✅",
  };
  return emojiMap[stage] || "•";
}

/**
 * Normalize phone number to E.164 format required by Bland
 * Bland requires: +[country code][number]
 * Example: +16284444907
 */
function normalizePhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters
  const digitsOnly = phoneNumber.replace(/\D/g, "");

  // If already has country code (11 digits starting with 1), add +
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }

  // If 10 digits (US number without country code), add +1
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  // If already has +, return as-is
  if (phoneNumber.startsWith("+")) {
    return phoneNumber;
  }

  // Default: assume US and add +1
  logger.warn("Phone number format unclear, assuming US +1", {
    original: phoneNumber,
    normalized: `+1${digitsOnly}`,
  });
  return `+1${digitsOnly}`;
}

/**
 * Stage 1: Trigger Bland outbound call with webhook URL
 * Bland will automatically POST to our webhook when the call completes
 */
async function triggerOutboundCall(
  payload: ConvosoWebhookPayload
): Promise<BlandOutboundCallResponse> {
  // Normalize phone number to E.164 format (+1XXXXXXXXXX)
  const normalizedPhone = normalizePhoneNumber(payload.phone_number);

  logger.info("Phone number normalized for Bland", {
    original: payload.phone_number,
    normalized: normalizedPhone,
  });

  return await blandService.sendOutboundCall({
    phoneNumber: normalizedPhone,
    firstName: payload.first_name,
    lastName: payload.last_name,
  });
}

/**
 * Apply Path A/B/C logic based on transcript
 * TODO: Implement actual path logic once you have the rules from Delaine/Jeff
 */
export function applyPathLogic(transcript: any): {
  path: string;
  disposition: string;
  status: string;
} {
  // PLACEHOLDER: This is where Path A/B/C logic will go
  // Example logic (to be replaced):

  const outcome = transcript.outcome;
  const planType = transcript.plan_type;

  // Path A: Transferred calls with Family plan
  if (outcome === CallOutcome.TRANSFERRED && planType === "Family") {
    return {
      path: "PATH_A",
      disposition: "TRANSFERRED_FAMILY",
      status: "hot_lead",
    };
  }

  // Path B: Transferred calls with Individual plan
  if (outcome === CallOutcome.TRANSFERRED && planType === "Individual") {
    return {
      path: "PATH_B",
      disposition: "TRANSFERRED_INDIVIDUAL",
      status: "warm_lead",
    };
  }

  // Path C: All other outcomes
  return {
    path: "PATH_C",
    disposition: outcome,
    status: "follow_up",
  };
}
