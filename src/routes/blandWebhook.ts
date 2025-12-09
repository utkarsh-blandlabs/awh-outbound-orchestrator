// ============================================================================
// Bland Webhook Route
// Handles incoming webhook from Bland AI when call completes
// ============================================================================

import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { CallStateManager } from "../services/callStateManager";
import { convosoService } from "../services/convosoService";
import { BlandTranscript, CallOutcome } from "../types/awh";

const router = Router();

/**
 * POST /webhooks/bland-callback
 *
 * Receives webhook from Bland AI when a call completes
 * This eliminates the need for polling!
 *
 * Bland sends comprehensive call data including:
 * - Complete transcripts
 * - Extracted variables
 * - Call duration
 * - Call outcomes
 * - Metadata
 */
router.post("/bland-callback", async (req: Request, res: Response) => {
  const requestId = `bland_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  logger.info("🎯 WEBHOOK | Bland callback received", {
    requestId,
    call_id: req.body.call_id || req.body.c_id,
    status: req.body.status,
    completed: req.body.completed,
  });

  // Log the full webhook payload for debugging
  logger.debug("📋 WEBHOOK | Bland full payload", {
    requestId,
    full_payload: req.body,
  });

  try {
    // Extract call_id from webhook
    const callId = req.body.call_id || req.body.c_id;
    if (!callId) {
      logger.error("❌ VALIDATION | Missing call_id in webhook payload", {
        requestId,
      });
      throw new Error("Missing call_id in webhook payload");
    }

    // Parse the transcript from webhook data
    const transcript = parseTranscriptFromWebhook(req.body);

    logger.info("✅ STEP 3 | Bland call completed and transcript retrieved", {
      requestId,
      call_id: callId,
      outcome: transcript.outcome,
      duration: transcript.duration,
      answered_by: transcript.answered_by,
    });

    // Get the pending call state (includes lead_id, phone_number, etc.)
    const callState = CallStateManager.getPendingCall(callId);

    if (!callState) {
      logger.warn("⚠️ STATE | No pending call found for this call_id", {
        requestId,
        call_id: callId,
        cache_stats: CallStateManager.getStats(),
      });

      // Still respond with 200 to acknowledge receipt
      return res.status(200).json({
        success: true,
        message: "Webhook received (no pending call found)",
        requestId,
      });
    }

    logger.info("💾 STATE | Call state retrieved for webhook matching", {
      requestId,
      call_id: callId,
      lead_id: callState.lead_id,
      phone: callState.phone_number,
      name: `${callState.first_name} ${callState.last_name}`,
    });

    // Process in background - fire and forget
    processCallCompletion(callState, transcript, requestId)
      .then(() => {
        logger.info("✅ FLOW COMPLETE | Call completion processing finished", {
          requestId,
          call_id: callId,
          lead_id: callState.lead_id,
        });
      })
      .catch((error) => {
        logger.error("❌ FLOW ERROR | Call completion processing failed", {
          requestId,
          call_id: callId,
          lead_id: callState.lead_id,
          error: error.message,
          error_stack: error.stack,
        });
      });

    // Respond immediately to Bland
    res.status(200).json({
      success: true,
      message: "Webhook received, processing call completion",
      requestId,
    });
  } catch (error: any) {
    logger.error("❌ WEBHOOK ERROR | Error handling Bland webhook", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    // Still return 200 to prevent Bland from retrying
    res.status(200).json({
      success: false,
      error: error.message,
      requestId,
    });
  }
});

/**
 * Process call completion in background
 */
async function processCallCompletion(
  callState: any,
  transcript: BlandTranscript,
  requestId: string
): Promise<void> {
  const logContext = {
    requestId,
    lead_id: callState.lead_id,
    call_id: callState.call_id,
    phone: callState.phone_number,
    name: `${callState.first_name} ${callState.last_name}`,
  };

  try {
    logger.info("▶️ STEP 4 START | Updating Convoso call log", {
      ...logContext,
      bland_outcome: transcript.outcome,
    });

    // Update Convoso call log (Step 4)
    await convosoService.updateCallLog(
      callState.lead_id,
      callState.phone_number,
      transcript
    );

    logger.info("✅ STEP 4 COMPLETE | Convoso call log updated", {
      ...logContext,
      bland_outcome: transcript.outcome,
    });

    // Mark call as completed
    CallStateManager.completeCall(callState.call_id);

    logger.info("💾 STATE | Call marked as completed", {
      ...logContext,
      cache_stats: CallStateManager.getStats(),
    });

    logger.info("✅ FLOW SUCCESS | Full orchestration completed successfully", {
      ...logContext,
      original_request_id: callState.request_id,
      outcome: transcript.outcome,
      duration: transcript.duration,
    });
  } catch (error: any) {
    logger.error("❌ STEP 4 ERROR | Failed to update Convoso", {
      ...logContext,
      error: error.message,
      error_stack: error.stack,
    });

    // Mark call as failed
    CallStateManager.failCall(callState.call_id, error.message);

    logger.error("💾 STATE | Call marked as failed", {
      ...logContext,
      error: error.message,
    });
  }
}

/**
 * Parse transcript from Bland webhook payload
 * This is the same data structure we get from polling GET /v1/calls/{call_id}
 */
function parseTranscriptFromWebhook(raw: any): BlandTranscript {
  // Extract outcome from call status and answered_by
  const outcome = determineOutcome(raw);

  // Extract variables (custom data from call)
  const variables = raw.variables || {};

  return {
    call_id: raw.call_id || raw.c_id,
    transcript: raw.concatenated_transcript || "",
    outcome,
    // Extract custom variables if they exist
    plan_type: variables.plan_type,
    member_count: variables.member_count,
    zip: variables.zip || raw.variables?.zip || variables.postal_code,
    state: variables.state || raw.variables?.state || variables.customer_state,
    duration: raw.call_length || raw.corrected_duration,
    // Additional useful fields from Bland
    summary: raw.summary,
    answered_by: raw.answered_by,
    call_ended_by: raw.call_ended_by,
    completed: raw.completed,
    status: raw.status,
    // Customer information from variables
    customer_age: variables.customer_age,
    postal_code: variables.postal_code,
    customer_state: variables.customer_state,
    first_name: variables.first_name,
    last_name: variables.last_name,
    // Pathway information
    pathway_tags: raw.pathway_tags || [],
    // Transfer information
    transferred_to: raw.transferred_to,
    transferred_at: raw.transferred_at,
    // Recording
    recording_url: raw.recording_url,
    // Warm transfer details
    warm_transfer_call: raw.warm_transfer_call,
  };
}

/**
 * Determine call outcome from Bland webhook data
 */
function determineOutcome(raw: any): CallOutcome {
  // If there was a warm transfer, it was transferred
  if (raw.warm_transfer_call && raw.warm_transfer_call.state === "MERGED") {
    return CallOutcome.TRANSFERRED;
  }

  // Check answered_by field
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

  // Check if call completed successfully with human
  if (raw.completed && answeredBy === "human") {
    // Check if there's a callback request in variables
    if (raw.variables?.callback_requested === true) {
      return CallOutcome.CALLBACK;
    }
    // Default to transferred if completed with human
    return CallOutcome.TRANSFERRED;
  }

  // Check error status
  if (raw.error_message || raw.status === "failed") {
    return CallOutcome.FAILED;
  }

  // Default - confused caller (unable to determine outcome)
  return CallOutcome.CONFUSED;
}

export default router;
