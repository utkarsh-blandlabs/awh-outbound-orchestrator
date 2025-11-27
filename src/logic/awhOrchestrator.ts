// ============================================================================
// Convoso Service
// Handles all interactions with Convoso API
// =======================================

import { logger } from "../utils/logger";
import { blandService } from "../services/blandService";
import { convosoService } from "../services/convosoService";
import {
  ConvosoWebhookPayload,
  OrchestrationResult,
  CallOutcome,
} from "../types/awh";

/**
 * Main orchestration function for AWH outbound flow
 *
 * Flow:
 * 1. Get or create lead in Convoso
 * 2. Trigger Bland outbound call
 * 3. Log call in Convoso
 * 4. Poll Bland for transcript
 * 5. Update Convoso lead with outcome
 */
export async function handleAwhOutbound(
  payload: ConvosoWebhookPayload
): Promise<OrchestrationResult> {
  const startTime = Date.now();

  logger.info("Starting AWH outbound orchestration", {
    phone: payload.phone,
    name: `${payload.first_name} ${payload.last_name}`,
    state: payload.state,
  });

  try {
    // ========================================================================
    // STEP 1: Get or create lead in Convoso
    // ========================================================================
    logger.info("Step 1: Getting or creating Convoso lead");
    const lead = await convosoService.getOrCreateLead(payload);

    logger.info("Lead ready", { lead_id: lead.lead_id });

    // ========================================================================
    // STEP 2: Trigger Bland outbound call
    // ========================================================================
    logger.info("Step 2: Triggering Bland outbound call");
    const callResponse = await blandService.sendOutboundCall({
      phoneNumber: payload.phone,
      firstName: payload.first_name,
      lastName: payload.last_name,
    });

    logger.info("Call initiated", { call_id: callResponse.call_id });

    // ========================================================================
    // STEP 3: Log call in Convoso
    // ========================================================================
    logger.info("Step 3: Logging call in Convoso");
    await convosoService.logCall(
      lead.lead_id,
      callResponse.call_id,
      payload.phone
    );

    logger.info("Call logged");

    // ========================================================================
    // STEP 4: Poll Bland for transcript
    // ========================================================================
    logger.info("Step 4: Waiting for Bland transcript");
    const transcript = await blandService.getTranscript(callResponse.call_id);

    logger.info("✓ Transcript received", {
      outcome: transcript.outcome,
      plan_type: transcript.plan_type,
      member_count: transcript.member_count,
    });

    // ========================================================================
    // STEP 5: Apply path logic and update Convoso lead
    // ========================================================================
    logger.info("Step 5: Applying path logic and updating lead");

    // TODO: Implement actual Path A/B/C logic once you have the rules
    // For now, we just update based on outcome
    await convosoService.updateLeadFromOutcome(lead.lead_id, transcript);

    logger.info("Lead updated");

    // ========================================================================
    // Success!
    // ========================================================================
    const duration = Date.now() - startTime;

    logger.info("AWH orchestration completed successfully", {
      lead_id: lead.lead_id,
      call_id: callResponse.call_id,
      outcome: transcript.outcome,
      duration_ms: duration,
    });

    return {
      success: true,
      lead_id: lead.lead_id,
      call_id: callResponse.call_id,
      outcome: transcript.outcome,
      transcript,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    logger.error("AWH orchestration failed", {
      error: error.message,
      stack: error.stack,
      duration_ms: duration,
      phone: payload.phone,
    });

    return {
      success: false,
      lead_id: "",
      call_id: "",
      outcome: CallOutcome.FAILED,
      error: error.message,
    };
  }
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
