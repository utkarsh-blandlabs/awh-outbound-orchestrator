import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { CallStateManager } from "../services/callStateManager";
import { convosoService } from "../services/convosoService";
import { statisticsService } from "../services/statisticsService";
import { dailyCallTracker } from "../services/dailyCallTrackerService";
import { answeringMachineTracker } from "../services/answeringMachineTrackerService";
import { BlandTranscript, CallOutcome } from "../types/awh";

const router = Router();

// ============================================================================
// IMPORTANT: Webhook Processing Behavior
// ============================================================================
// This webhook processes ALL callbacks from Bland AI regardless of scheduler state.
// This is BY DESIGN because:
// 1. Calls initiated during business hours may complete after hours
// 2. We must process webhooks to avoid orphaned calls in cache
// 3. Convoso updates must happen for all completed calls
// 4. The scheduler only controls INITIATING new calls, not processing results
//
// Edge Case Handled: #1 - Callback arrives when scheduler is OFF
// Resolution: Always process webhooks; scheduler state is irrelevant for completions
// ============================================================================

router.post("/bland-callback", async (req: Request, res: Response) => {
  const requestId = `bland_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const callId = req.body.call_id || req.body.c_id;

  logger.info("Bland webhook received", {
    requestId,
    call_id: callId,
    status: req.body.status,
    answered_by: req.body.answered_by,
    to: req.body.to,
  });

  try {
    if (!callId) {
      logger.error("Missing call_id in webhook payload", {
        requestId,
        payload_keys: Object.keys(req.body),
      });
      throw new Error("Missing call_id in webhook payload");
    }

    const transcript = parseTranscriptFromWebhook(req.body);

    logger.info("Call completed", {
      requestId,
      call_id: callId,
      outcome: transcript.outcome,
      duration: transcript.duration,
      answered_by: transcript.answered_by,
    });

    const callState = CallStateManager.getPendingCall(callId);

    if (!callState) {
      logger.warn("No pending call found in cache", {
        requestId,
        call_id: callId,
        to: req.body.to,
        answered_by: req.body.answered_by,
        status: req.body.status,
        note: "Call may have completed before server restart, or webhook arrived late",
      });

      // Still return 200 OK to Bland so they don't retry
      return res.status(200).json({
        success: true,
        message: "Webhook received (no pending call found - may be after server restart)",
        requestId,
        call_id: callId,
      });
    }

    // Process asynchronously - don't block webhook response
    processCallCompletion(callState, transcript, requestId)
      .then(() => {
        logger.info("Call processing completed", {
          requestId,
          call_id: callId,
          lead_id: callState.lead_id,
          phone: callState.phone_number,
        });
      })
      .catch((error) => {
        logger.error("Call processing failed", {
          requestId,
          call_id: callId,
          lead_id: callState.lead_id,
          phone: callState.phone_number,
          error: error.message,
          stack: error.stack,
        });
      });

    // Always return 200 OK immediately to Bland
    res.status(200).json({
      success: true,
      message: "Webhook received and processing",
      requestId,
      call_id: callId,
    });
  } catch (error: any) {
    logger.error("Webhook error", {
      requestId,
      error: error.message,
      stack: error.stack,
      payload: req.body,
    });

    // Still return 200 to prevent Bland from retrying
    res.status(200).json({
      success: false,
      error: error.message,
      requestId,
      note: "Error logged, but returning 200 to prevent retry",
    });
  }
});

async function processCallCompletion(
  callState: any,
  transcript: BlandTranscript,
  requestId: string
): Promise<void> {
  try {
    logger.info("Updating Convoso", {
      requestId,
      lead_id: callState.lead_id,
      outcome: transcript.outcome,
    });

    await convosoService.updateCallLog(
      callState.lead_id,
      callState.list_id,
      callState.phone_number,
      transcript
    );

    logger.info("Convoso updated successfully", {
      requestId,
      lead_id: callState.lead_id,
    });

    // Record statistics
    statisticsService.recordCallComplete(
      transcript.outcome,
      transcript.answered_by
    );

    // Record call completion in daily tracker
    dailyCallTracker.recordCallComplete(
      callState.phone_number,
      callState.call_id,
      transcript.outcome,
      transcript
    );

    // Record attempt in answering machine tracker (if status is tracked)
    answeringMachineTracker.recordAttempt(
      callState.lead_id,
      callState.phone_number,
      transcript.outcome,
      callState.call_id
    );

    CallStateManager.completeCall(callState.call_id);
  } catch (error: any) {
    logger.error("Convoso update failed", {
      requestId,
      lead_id: callState.lead_id,
      error: error.message,
    });

    // Record failure statistics
    statisticsService.recordCallFailure(error.message);

    // Record call failure in daily tracker
    dailyCallTracker.recordCallFailure(
      callState.phone_number,
      callState.call_id,
      error.message
    );

    CallStateManager.failCall(callState.call_id, error.message);
    throw error;
  }
}

function parseTranscriptFromWebhook(raw: any): BlandTranscript {
  const outcome = determineOutcome(raw);
  const variables = raw.variables || {};

  return {
    call_id: raw.call_id || raw.c_id,
    transcript: raw.concatenated_transcript || "",
    outcome,
    plan_type: variables.plan_type,
    member_count: variables.member_count,
    zip: variables.zip || variables.postal_code,
    state: variables.state || variables.customer_state,
    duration: raw.call_length || raw.corrected_duration,
    summary: raw.summary,
    answered_by: raw.answered_by,
    call_ended_by: raw.call_ended_by,
    completed: raw.completed,
    status: raw.status,
    customer_age: variables.customer_age,
    postal_code: variables.postal_code,
    customer_state: variables.customer_state,
    first_name: variables.first_name,
    last_name: variables.last_name,
    pathway_tags: raw.pathway_tags || [],
    transferred_to: raw.transferred_to,
    transferred_at: raw.transferred_at,
    recording_url: raw.recording_url,
    warm_transfer_call: raw.warm_transfer_call,
  };
}

function determineOutcome(raw: any): CallOutcome {
  if (raw.warm_transfer_call && raw.warm_transfer_call.state === "MERGED") {
    return CallOutcome.TRANSFERRED;
  }

  const answeredBy = raw.answered_by?.toLowerCase();
  if (answeredBy === "voicemail") {
    return CallOutcome.VOICEMAIL;
  }
  if (answeredBy === "no-answer" || answeredBy === "no_answer") {
    return CallOutcome.NO_ANSWER;
  }
  if (answeredBy === "busy") {
    return CallOutcome.BUSY;
  }

  if (raw.completed && raw.status === "completed") {
    if (raw.variables?.callback_requested === true) {
      return CallOutcome.CALLBACK;
    }

    const hasQualification = raw.variables?.customer_age && raw.variables?.plan_type;
    const summaryLower = raw.summary?.toLowerCase() || "";
    const hasTransferInSummary = summaryLower.includes("transfer") ||
                                  summaryLower.includes("licensed agent") ||
                                  summaryLower.includes("connect");

    const qualificationTags = ["Age Confirmation", "Plan Type", "Identity Confirmation"];
    const hasQualificationTags = qualificationTags.some(tag =>
      raw.pathway_tags?.some((pt: any) => pt === tag || pt?.name === tag)
    );

    if (hasQualification || hasTransferInSummary || hasQualificationTags || answeredBy === "human") {
      return CallOutcome.TRANSFERRED;
    }
  }

  if (raw.error_message || raw.status === "failed") {
    return CallOutcome.FAILED;
  }

  return CallOutcome.CONFUSED;
}

export default router;
