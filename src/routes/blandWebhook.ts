import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { CallStateManager } from "../services/callStateManager";
import { convosoService } from "../services/convosoService";
import { statisticsService } from "../services/statisticsService";
import { dailyCallTracker } from "../services/dailyCallTrackerService";
import { answeringMachineTracker } from "../services/answeringMachineTrackerService";
import { redialQueueService } from "../services/redialQueueService";
import { failedConvosoLogger } from "../services/failedConvosoLogger";
import { smsSchedulerService } from "../services/smsSchedulerService";
import { config } from "../config";
import { BlandTranscript, CallOutcome } from "../types/awh";

const router = Router();

// ============================================================================
// Helper: Map outcome to Convoso status
// (Duplicated from convosoService since that method is private)
// ============================================================================
function mapOutcomeToConvosoStatus(outcome: CallOutcome | string): string {
  const normalizedOutcome = outcome.toString().toLowerCase();

  // Map each outcome to corresponding Convoso status code
  if (normalizedOutcome.includes("transfer")) return "TR";
  if (normalizedOutcome.includes("sale") || normalizedOutcome.includes("aca"))
    return "S";
  if (normalizedOutcome.includes("callback")) return "CD";
  if (normalizedOutcome.includes("voicemail")) return "A";
  if (normalizedOutcome.includes("no_answer")) return "NA";
  if (normalizedOutcome.includes("confused")) return "CD";
  if (normalizedOutcome.includes("busy")) return "B";
  if (
    normalizedOutcome.includes("hang") ||
    normalizedOutcome.includes("hangup")
  )
    return "CALLHU";
  if (normalizedOutcome.includes("disconnect")) return "DC";
  if (normalizedOutcome.includes("dead")) return "N";
  if (normalizedOutcome.includes("wrong")) return "WRONG";
  if (normalizedOutcome.includes("bad_phone")) return "BPN";

  return "N"; // Default to N for unknown outcomes
}

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
        from: req.body.from,
        answered_by: req.body.answered_by,
        status: req.body.status,
        note: "Likely an INBOUND call (customer called Ashley back) or webhook after server restart",
      });

      // INBOUND CALL HANDLING
      // This is likely a customer calling Ashley back (not initiated by orchestrator)
      // We still need to process it and update Convoso, especially for DNC requests
      processInboundCall(req.body, transcript, requestId)
        .then(() => {
          logger.info("Inbound call processing completed", {
            requestId,
            call_id: callId,
            phone: req.body.from || req.body.to,
          });
        })
        .catch((error) => {
          logger.error("Inbound call processing failed", {
            requestId,
            call_id: callId,
            error: error.message,
            stack: error.stack,
          });
        });

      // Still return 200 OK to Bland so they don't retry
      return res.status(200).json({
        success: true,
        message: "Webhook received (inbound call - processing asynchronously)",
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
      transcript.answered_by,
      transcript.transcript // Pass full transcript for voicemail detection
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

    // Add/update in redial queue (will handle success outcomes automatically)
    // Extract scheduled callback time if present in transcript variables
    const callbackRequestedAt = (transcript as any)["callback_requested_at"];
    const scheduledCallbackTime = callbackRequestedAt
      ? new Date(callbackRequestedAt).getTime()
      : undefined;

    await redialQueueService.addOrUpdateLead(
      callState.lead_id,
      callState.phone_number,
      callState.list_id,
      callState.first_name,
      callState.last_name,
      callState.state,
      transcript.outcome,
      callState.call_id,
      scheduledCallbackTime,
      false, // outbound call
      callState.from_number // Track which pool number was used
    );

    // Add lead to SMS queue for VOICEMAIL or NO_ANSWER outcomes (if enabled)
    if (config.sms.enabled && config.sms.triggers.includes(transcript.outcome)) {
      try {
        // Add to SMS queue - scheduler will check Bland conversation history before sending
        smsSchedulerService.addLead({
          lead_id: callState.lead_id,
          phone_number: callState.phone_number,
          list_id: callState.list_id,
          first_name: callState.first_name,
          last_name: callState.last_name,
          state: callState.state,
          last_outcome: transcript.outcome,
          last_call_timestamp: Date.now(),
        });

        logger.info("Lead added to SMS queue", {
          requestId,
          lead_id: callState.lead_id,
          phone: callState.phone_number,
          outcome: transcript.outcome,
        });
      } catch (error: any) {
        logger.error("Failed to add lead to SMS queue", {
          requestId,
          lead_id: callState.lead_id,
          error: error.message,
        });
        // Don't fail the webhook if SMS queue fails
      }
    }

    // Auto-block for today: Check if this is a "Call failed" error and block for today only
    // These are bad numbers from purchased data that don't even register as missed calls
    // Automatically resets at midnight EST so the number can be tried again tomorrow
    if (
      config.blocklist.autoFlagFailedCalls &&
      (transcript as any).error_message &&
      transcript.outcome === CallOutcome.FAILED
    ) {
      const errorMessage = (transcript as any).error_message;

      logger.warn("Auto-blocking failed call for today", {
        requestId,
        phone: callState.phone_number,
        lead_id: callState.lead_id,
        error_message: errorMessage,
        call_id: callState.call_id,
        note: "Will reset at midnight EST",
      });

      try {
        // Mark phone number as failed for today only (resets at midnight EST)
        dailyCallTracker.markAsFailedForToday(
          callState.phone_number,
          errorMessage
        );

        logger.info("Phone number blocked for today", {
          requestId,
          phone: callState.phone_number,
          lead_id: callState.lead_id,
          error_message: errorMessage,
          note: "Will automatically reset at midnight EST",
        });
      } catch (blockError: any) {
        logger.error("Failed to block number for today", {
          requestId,
          phone: callState.phone_number,
          error: blockError.message,
        });
      }
    }

    CallStateManager.completeCall(callState.call_id);
  } catch (error: any) {
    logger.error("Convoso update failed", {
      requestId,
      lead_id: callState.lead_id,
      error: error.message,
    });

    // Log failed update for manual backfill if lead doesn't exist in Convoso
    // These can be created in Convoso later after confirming with Jeff
    if (error.message && error.message.includes("No such Lead")) {
      const convosoStatus = mapOutcomeToConvosoStatus(transcript.outcome);

      failedConvosoLogger.logFailedUpdate(
        callState.lead_id,
        callState.list_id,
        callState.phone_number,
        transcript,
        convosoStatus,
        error.message
      );
    }

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
    // Include error_message for auto-blocklist detection
    error_message: raw.error_message,
  };
}

async function processInboundCall(
  raw: any,
  transcript: BlandTranscript,
  requestId: string
): Promise<void> {
  try {
    // Extract phone number - could be in 'from' (customer calling) or 'to' field
    const phoneNumber = raw.from || raw.to;
    const variables = raw.variables || {};
    const callId = raw.call_id || raw.c_id;

    if (!phoneNumber) {
      logger.error("No phone number found in inbound call webhook", {
        requestId,
        payload_keys: Object.keys(raw),
      });
      return;
    }

    logger.info("Processing inbound call", {
      requestId,
      call_id: callId,
      phone: phoneNumber,
      outcome: transcript.outcome,
      answered_by: raw.answered_by,
      has_variables: Object.keys(variables).length > 0,
    });

    // Step 1: Try to get lead info from pathway variables (if Delaine configures it)
    let leadInfo: {
      lead_id: string;
      list_id: string;
      first_name?: string;
      last_name?: string;
      state?: string;
    } | null = null;

    if (variables.lead_id && variables.list_id) {
      logger.info("Lead info found in pathway variables", {
        requestId,
        lead_id: variables.lead_id,
        list_id: variables.list_id,
      });

      leadInfo = {
        lead_id: variables.lead_id,
        list_id: variables.list_id,
        first_name: variables.first_name || transcript.first_name,
        last_name: variables.last_name || transcript.last_name,
        state: variables.state || variables.customer_state || transcript.state,
      };
    } else {
      // Step 2: Look up lead in Convoso by phone number
      logger.info("Lead info not in variables, looking up in Convoso", {
        requestId,
        phone: phoneNumber,
      });

      leadInfo = await convosoService.lookupLeadByPhone(phoneNumber);

      if (!leadInfo) {
        logger.warn("Lead not found in Convoso for inbound call", {
          requestId,
          phone: phoneNumber,
          note: "Will still process with available data",
        });
      }
    }

    // Step 3: Check if this is a DNC request
    const isDNC = checkIfDNC(transcript, raw);

    if (isDNC) {
      logger.warn("DNC detected in inbound call", {
        requestId,
        phone: phoneNumber,
        lead_id: leadInfo?.lead_id,
        outcome: transcript.outcome,
        summary: raw.summary,
      });

      // Add to permanent blocklist immediately
      const { blocklistService } = await import("../services/blocklistService");
      blocklistService.addFlag(
        "phone",
        phoneNumber,
        "DNC request via inbound call",
        "system_inbound_dnc"
      );

      logger.info("Phone number added to DNC blocklist", {
        requestId,
        phone: phoneNumber,
        lead_id: leadInfo?.lead_id,
      });
    }

    // Step 4: Update Convoso if we have lead info
    if (leadInfo) {
      logger.info("Updating Convoso for inbound call", {
        requestId,
        lead_id: leadInfo.lead_id,
        list_id: leadInfo.list_id,
        outcome: transcript.outcome,
      });

      try {
        await convosoService.updateCallLog(
          leadInfo.lead_id,
          leadInfo.list_id,
          phoneNumber,
          transcript
        );

        logger.info("Convoso updated successfully for inbound call", {
          requestId,
          lead_id: leadInfo.lead_id,
        });
      } catch (error: any) {
        logger.error("Failed to update Convoso for inbound call", {
          requestId,
          lead_id: leadInfo.lead_id,
          error: error.message,
        });
      }
    } else {
      logger.warn("Skipping Convoso update (no lead info available)", {
        requestId,
        phone: phoneNumber,
        note: "Lead not found in Convoso and not provided in pathway variables",
      });
    }

    // Step 5: Record statistics
    statisticsService.recordCallComplete(
      transcript.outcome,
      transcript.answered_by,
      transcript.transcript // Pass full transcript for voicemail detection
    );

    // Step 6: Record call completion in daily tracker
    dailyCallTracker.recordCallComplete(
      phoneNumber,
      callId,
      transcript.outcome,
      transcript
    );

    // Step 7: Record attempt in answering machine tracker (if we have lead info)
    if (leadInfo) {
      answeringMachineTracker.recordAttempt(
        leadInfo.lead_id,
        phoneNumber,
        transcript.outcome,
        callId
      );
    }

    // Step 8: Add to redial queue (if we have lead info and it's not a success outcome)
    if (leadInfo) {
      const callbackRequestedAt = (transcript as any)["callback_requested_at"];
      const scheduledCallbackTime = callbackRequestedAt
        ? new Date(callbackRequestedAt).getTime()
        : undefined;

      await redialQueueService.addOrUpdateLead(
        leadInfo.lead_id,
        phoneNumber,
        leadInfo.list_id,
        leadInfo.first_name || "",
        leadInfo.last_name || "",
        leadInfo.state || "",
        transcript.outcome,
        callId,
        scheduledCallbackTime,
        true, // isInbound - don't count against daily/monthly limits
        undefined // inbound calls have no from_number (customer called us)
      );

      logger.info("Inbound call added to redial queue (not counted against daily/monthly limits)", {
        requestId,
        lead_id: leadInfo.lead_id,
        outcome: transcript.outcome,
      });

      // Add lead to SMS queue for VOICEMAIL or NO_ANSWER outcomes (if enabled)
      if (config.sms.enabled && config.sms.triggers.includes(transcript.outcome)) {
        try {
          // Add to SMS queue - scheduler will check Bland conversation history before sending
          smsSchedulerService.addLead({
            lead_id: leadInfo.lead_id,
            phone_number: phoneNumber,
            list_id: leadInfo.list_id,
            first_name: leadInfo.first_name || "",
            last_name: leadInfo.last_name || "",
            state: leadInfo.state || "",
            last_outcome: transcript.outcome,
            last_call_timestamp: Date.now(),
          });

          logger.info("Lead added to SMS queue (inbound)", {
            requestId,
            lead_id: leadInfo.lead_id,
            phone: phoneNumber,
            outcome: transcript.outcome,
          });
        } catch (error: any) {
          logger.error("Failed to add lead to SMS queue (inbound)", {
            requestId,
            lead_id: leadInfo.lead_id,
            error: error.message,
          });
        }
      }
    }

    // Step 9: Handle failed call auto-block (same as outbound)
    if (
      config.blocklist.autoFlagFailedCalls &&
      (transcript as any).error_message &&
      transcript.outcome === CallOutcome.FAILED
    ) {
      const errorMessage = (transcript as any).error_message;

      logger.warn("Auto-blocking failed inbound call for today", {
        requestId,
        phone: phoneNumber,
        lead_id: leadInfo?.lead_id,
        error_message: errorMessage,
        call_id: callId,
        note: "Will reset at midnight EST",
      });

      try {
        dailyCallTracker.markAsFailedForToday(phoneNumber, errorMessage);

        logger.info("Phone number blocked for today (inbound)", {
          requestId,
          phone: phoneNumber,
          lead_id: leadInfo?.lead_id,
          error_message: errorMessage,
        });
      } catch (blockError: any) {
        logger.error("Failed to block number for today (inbound)", {
          requestId,
          phone: phoneNumber,
          error: blockError.message,
        });
      }
    }

    logger.info("Inbound call processing completed successfully", {
      requestId,
      call_id: callId,
      phone: phoneNumber,
      lead_id: leadInfo?.lead_id,
      outcome: transcript.outcome,
      convoso_updated: !!leadInfo,
      dnc_blocked: isDNC,
    });
  } catch (error: any) {
    logger.error("Inbound call processing error", {
      requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

function checkIfDNC(transcript: BlandTranscript, raw: any): boolean {
  // Check outcome
  const outcome = transcript.outcome?.toLowerCase() || "";
  if (
    outcome.includes("dnc") ||
    outcome.includes("do_not_call") ||
    outcome.includes("remove") ||
    outcome.includes("stop_calling")
  ) {
    return true;
  }

  // Check summary
  const summary = (raw.summary || "").toLowerCase();
  if (
    summary.includes("do not call") ||
    summary.includes("remove from list") ||
    summary.includes("stop calling") ||
    summary.includes("take me off") ||
    summary.includes("don't call")
  ) {
    return true;
  }

  // Check transcript
  const transcriptText = (transcript.transcript || "").toLowerCase();
  if (
    transcriptText.includes("do not call") ||
    transcriptText.includes("remove from list") ||
    transcriptText.includes("stop calling") ||
    transcriptText.includes("take me off") ||
    transcriptText.includes("don't call")
  ) {
    return true;
  }

  // Check pathway tags
  const tags = raw.pathway_tags || [];
  if (
    tags.some(
      (tag: string) =>
        tag.toLowerCase().includes("dnc") ||
        tag.toLowerCase().includes("do_not_call") ||
        tag.toLowerCase().includes("remove")
    )
  ) {
    return true;
  }

  return false;
}

function determineOutcome(raw: any): CallOutcome {
  // CRITICAL FIX: Check answered_by FIRST before checking transfer state
  // NEVER transfer voicemail, no-answer, or busy calls to agents!
  const answeredBy = raw.answered_by?.toLowerCase();

  // Priority 1: Check if call went to voicemail/no-answer/busy (never transfer these!)
  if (answeredBy === "voicemail") {
    return CallOutcome.VOICEMAIL;
  }
  if (answeredBy === "no-answer" || answeredBy === "no_answer") {
    return CallOutcome.NO_ANSWER;
  }
  if (answeredBy === "busy") {
    return CallOutcome.BUSY;
  }

  // Priority 2: ONLY mark as TRANSFERRED if warm_transfer_call.state === "MERGED"
  // This is the ONLY reliable indicator that customer (HUMAN) actually connected to agent
  // DO NOT trust qualification data, summary mentions, or tags - customer may hang up during hold music
  if (raw.warm_transfer_call && raw.warm_transfer_call.state === "MERGED") {
    return CallOutcome.TRANSFERRED;
  }

  if (raw.completed && raw.status === "completed") {
    if (raw.variables?.callback_requested === true) {
      return CallOutcome.CALLBACK;
    }

    // If completed with human but NO successful transfer, mark as CONFUSED
    // Customer may have qualified but hung up before/during transfer
    // This is NOT a successful transfer - agent never spoke to customer
    if (answeredBy === "human") {
      return CallOutcome.CONFUSED;
    }
  }

  if (raw.error_message || raw.status === "failed") {
    return CallOutcome.FAILED;
  }

  return CallOutcome.CONFUSED;
}

export default router;
