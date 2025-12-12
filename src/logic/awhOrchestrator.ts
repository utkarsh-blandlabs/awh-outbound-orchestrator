import { logger } from "../utils/logger";
import { errorLogger } from "../utils/errorLogger";
import { blandService } from "../services/blandService";
import { CallStateManager } from "../services/callStateManager";
import { schedulerService } from "../services/schedulerService";
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
      payload.last_name
    );
    currentStage = OrchestrationStage.WEBHOOK_REGISTERED;

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
