import { logger } from "../utils/logger";
import { errorLogger } from "../utils/errorLogger";
import { blandService } from "../services/blandService";
import { CallStateManager } from "../services/callStateManager";
import { schedulerService } from "../services/schedulerService";
import { dailyCallTracker } from "../services/dailyCallTrackerService";
import { answeringMachineTracker } from "../services/answeringMachineTrackerService";
import { blocklistService } from "../services/blocklistService";
import { webhookLogger } from "../services/webhookLogger";
import {
  ConvosoWebhookPayload,
  OrchestrationResult,
  CallOutcome,
  BlandOutboundCallResponse,
} from "../types/awh";

enum OrchestrationStage {
  INIT = "INIT",
  BLAND_CALL = "BLAND_CALL",
  WEBHOOK_REGISTERED = "WEBHOOK_REGISTERED",
  COMPLETE = "COMPLETE",
}

interface StageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  stage: OrchestrationStage;
  duration_ms: number;
}

export async function handleAwhOutbound(
  payload: ConvosoWebhookPayload,
  requestId?: string
): Promise<OrchestrationResult> {
  const startTime = Date.now();
  let currentStage = OrchestrationStage.INIT;

  logger.info("Starting orchestration", {
    request_id: requestId,
    phone: payload.phone_number,
    name: `${payload.first_name} ${payload.last_name}`,
  });

  // Check if scheduler allows processing this request
  if (!schedulerService.isActive()) {
    const queueId = schedulerService.queueRequest("call", payload);

    logger.info("System inactive - request queued", {
      request_id: requestId,
      queue_id: queueId,
      phone: payload.phone_number,
      lead_id: payload.lead_id,
    });

    return {
      success: true,
      lead_id: payload.lead_id,
      call_id: queueId,
      outcome: CallOutcome.NO_ANSWER,
      error: "System inactive - request queued for later processing",
    };
  }

  // NOTE: Call attempt tracking (4 per day) is handled by Convoso
  // They filter leads on their side before sending to our polling endpoint
  // We trust their filtering and don't duplicate the check here

  // Check answering machine tracker (voicemail/no-answer retry limits by lead_id + phone)
  const amDecision = answeringMachineTracker.shouldAllowCall(
    payload.lead_id,
    payload.phone_number,
    payload.status
  );

  if (!amDecision.allow) {
    logger.info("Call blocked by answering machine tracker", {
      request_id: requestId,
      phone: payload.phone_number,
      lead_id: payload.lead_id,
      reason: amDecision.reason,
      current_attempts: amDecision.current_attempts,
      max_attempts: amDecision.max_attempts,
    });

    return {
      success: false,
      lead_id: payload.lead_id,
      call_id: "",
      outcome: CallOutcome.NO_ANSWER,
      error: amDecision.reason,
    };
  }

  // Check call protection rules (duplicate detection, terminal status, etc.)
  const protection = dailyCallTracker.shouldAllowCall(
    payload.phone_number,
    payload.lead_id
  );

  if (!protection.allow) {
    logger.info("Call blocked by protection rules", {
      request_id: requestId,
      phone: payload.phone_number,
      lead_id: payload.lead_id,
      reason: protection.reason,
      action: protection.action,
    });

    if (protection.action === "queue") {
      // Another call is active for this number - queue this request
      const queueId = schedulerService.queueRequest("call", payload);

      return {
        success: true,
        lead_id: payload.lead_id,
        call_id: queueId,
        outcome: CallOutcome.NO_ANSWER,
        error: `Request queued: ${protection.reason}`,
      };
    } else {
      // Blocked due to terminal status or other rule
      return {
        success: false,
        lead_id: payload.lead_id,
        call_id: "",
        outcome: CallOutcome.NO_ANSWER,
        error: protection.reason,
      };
    }
  }

  // CRITICAL: Check blocklist BEFORE calling Bland AI (to avoid wasting API calls)
  // This checks dynamic flags for specific phone numbers, lead_ids, or other fields
  const blocklistCheck = blocklistService.shouldBlock({
    ...payload, // Include all payload fields for flexible blocking
    phone: payload.phone_number, // Add 'phone' alias for convenience
  });

  if (blocklistCheck.blocked) {
    logger.info("Call blocked by blocklist flag", {
      request_id: requestId,
      phone: payload.phone_number,
      lead_id: payload.lead_id,
      reason: blocklistCheck.reason,
      flag_id: blocklistCheck.flag?.id,
      flag_field: blocklistCheck.flag?.field,
      flag_value: blocklistCheck.flag?.value,
    });

    // Log blocklist result to webhook logger
    if (requestId) {
      webhookLogger.logBlocklistResult(
        requestId,
        true,
        blocklistCheck.reason || "Blocked by blocklist flag"
      );
    }

    return {
      success: false,
      lead_id: payload.lead_id,
      call_id: "",
      outcome: CallOutcome.NO_ANSWER,
      error: blocklistCheck.reason || "Blocked by blocklist flag",
    };
  }

  // Log that call was allowed by blocklist
  if (requestId) {
    webhookLogger.logBlocklistResult(requestId, false);
  }

  try {
    const callResult = await executeStage(
      OrchestrationStage.BLAND_CALL,
      () => triggerOutboundCall(payload),
      requestId
    );

    if (!callResult.success || !callResult.data) {
      throw new Error(`Stage ${OrchestrationStage.BLAND_CALL} failed: ${callResult.error}`);
    }

    currentStage = OrchestrationStage.BLAND_CALL;
    const callResponse = callResult.data;

    CallStateManager.addPendingCall(
      callResponse.call_id,
      requestId || "",
      payload.lead_id,
      payload.list_id,
      payload.phone_number,
      payload.first_name,
      payload.last_name,
      payload.state
    );
    currentStage = OrchestrationStage.WEBHOOK_REGISTERED;

    // Record call start in daily tracker
    dailyCallTracker.recordCallStart(
      payload.phone_number,
      payload.lead_id,
      callResponse.call_id,
      requestId || ""
    );

    logger.info("Call initiated, waiting for webhook", {
      request_id: requestId,
      lead_id: payload.lead_id,
      call_id: callResponse.call_id,
    });

    const duration = Date.now() - startTime;
    return {
      success: true,
      lead_id: payload.lead_id,
      call_id: callResponse.call_id,
      outcome: CallOutcome.NO_ANSWER,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    logger.error("Orchestration failed", {
      request_id: requestId,
      stage: currentStage,
      error: error.message,
      phone: payload.phone_number,
    });

    errorLogger.logError(
      requestId || "unknown",
      "STAGE_FAILED",
      error.message,
      {
        stage: currentStage,
        phoneNumber: payload.phone_number,
        leadId: payload.lead_id,
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

async function executeStage<T>(
  stage: OrchestrationStage,
  fn: () => Promise<T>,
  requestId?: string
): Promise<StageResult<T>> {
  const stageStart = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - stageStart;

    return {
      success: true,
      data: result,
      stage,
      duration_ms: duration,
    };
  } catch (error: any) {
    const duration = Date.now() - stageStart;

    logger.error(`Stage ${stage} failed`, {
      request_id: requestId,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
      stage,
      duration_ms: duration,
    };
  }
}

function normalizePhoneNumber(phoneNumber: string): string {
  const digitsOnly = phoneNumber.replace(/\D/g, "");

  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  if (phoneNumber.startsWith("+")) {
    return phoneNumber;
  }

  return `+1${digitsOnly}`;
}

async function triggerOutboundCall(
  payload: ConvosoWebhookPayload
): Promise<BlandOutboundCallResponse> {
  const normalizedPhone = normalizePhoneNumber(payload.phone_number);

  return await blandService.sendOutboundCall({
    phoneNumber: normalizedPhone,
    firstName: payload.first_name,
    lastName: payload.last_name,
  });
}

export function applyPathLogic(transcript: any): {
  path: string;
  disposition: string;
  status: string;
} {
  const outcome = transcript.outcome;
  const planType = transcript.plan_type;

  if (outcome === CallOutcome.TRANSFERRED && planType === "Family") {
    return {
      path: "PATH_A",
      disposition: "TRANSFERRED_FAMILY",
      status: "hot_lead",
    };
  }

  if (outcome === CallOutcome.TRANSFERRED && planType === "Individual") {
    return {
      path: "PATH_B",
      disposition: "TRANSFERRED_INDIVIDUAL",
      status: "warm_lead",
    };
  }

  return {
    path: "PATH_C",
    disposition: outcome,
    status: "follow_up",
  };
}
