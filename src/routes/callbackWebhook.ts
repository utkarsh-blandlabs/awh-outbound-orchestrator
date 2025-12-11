/**
 * Callback Webhook Route
 *
 * Zapier replacement endpoint that:
 * 1. Receives trigger event with customer data from Convoso
 * 2. Initiates Bland.ai phone call
 * 3. Retrieves transcript from Bland.ai (via bland-callback webhook)
 * 4. Updates Convoso with call logs and status
 *
 * Endpoint: POST /webhooks/call-back
 */

import { Router, Request, Response } from "express";
import { blandService } from "../services/blandService";
import { CallStateManager } from "../services/callStateManager";
import { logger } from "../utils/logger";

const router = Router();

interface CallbackPayload {
  phone_number: string;
  first_name: string;
  last_name: string;
  status: string; // Convoso status code (A, CALLBK, SALE, etc.)
  lead_id: string;
  list_id: string;
  // Optional fields
  email?: string;
  address1?: string;
  age?: string;
  state?: string;
  city?: string;
  postal_code?: string;
  date_of_birth?: string;
  plan_type?: string;
}

/**
 * POST /webhooks/call-back
 *
 * Zapier replacement webhook that orchestrates:
 * 1. Receive trigger event (customer data from Convoso)
 * 2. Send phone call (Bland.ai)
 * 3. Get transcript (Bland.ai via bland-callback webhook)
 * 4. Update call logs (Convoso with transcript and status)
 */
router.post("/call-back", async (req: Request, res: Response) => {
  const requestId = `cb_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  try {
    logger.info("🎯 WEBHOOK | Callback received from Convoso", {
      requestId,
      phone: req.body.phone_number,
      lead_id: req.body.lead_id,
      status: req.body.status,
      name: `${req.body.first_name} ${req.body.last_name}`,
    });

    // Validate required fields
    const payload: CallbackPayload = req.body;

    if (!payload.phone_number) {
      logger.error("❌ VALIDATION | Missing phone_number", { requestId });
      return res.status(400).json({
        success: false,
        error: "Missing required field: phone_number",
        requestId,
      });
    }

    if (!payload.first_name || !payload.last_name) {
      logger.error("❌ VALIDATION | Missing name fields", {
        requestId,
        has_first_name: !!payload.first_name,
        has_last_name: !!payload.last_name,
      });
      return res.status(400).json({
        success: false,
        error: "Missing required fields: first_name and last_name",
        requestId,
      });
    }

    if (!payload.lead_id) {
      logger.error("❌ VALIDATION | Missing lead_id", { requestId });
      return res.status(400).json({
        success: false,
        error: "Missing required field: lead_id",
        requestId,
      });
    }

    // Respond immediately to avoid timeout
    res.status(202).json({
      success: true,
      message: "Callback processing started",
      requestId,
      phone_number: payload.phone_number,
      lead_id: payload.lead_id,
    });

    // Process asynchronously
    processCallback(payload, requestId).catch((error) => {
      logger.error("Async callback processing failed", {
        requestId,
        error: error.message,
        stack: error.stack,
      });
    });

  } catch (error: any) {
    logger.error("Callback webhook error", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    // If response not sent yet
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Internal server error",
        requestId,
      });
    }
  }
});

/**
 * Process callback asynchronously
 * Implements the correct Zapier replacement flow:
 * 1. Receive trigger (already done)
 * 2. Send phone call (Bland.ai)
 * 3. Get transcript (happens via bland-callback webhook)
 * 4. Update Convoso (happens in bland-callback webhook)
 */
async function processCallback(payload: CallbackPayload, requestId: string): Promise<void> {
  const logContext = {
    requestId,
    lead_id: payload.lead_id,
    phone: payload.phone_number,
    name: `${payload.first_name} ${payload.last_name}`,
  };

  try {
    logger.info("▶️ FLOW START | Processing callback webhook", {
      ...logContext,
      initial_status: payload.status,
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: ✅ Trigger received from Convoso
    // ═══════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: 📞 Initiate Bland.ai Call
    // ═══════════════════════════════════════════════════════════════
    logger.info("📞 STEP 2 | Initiating Bland.ai call", logContext);

    const blandCallResponse = await blandService.sendOutboundCall({
      phoneNumber: payload.phone_number,
      firstName: payload.first_name,
      lastName: payload.last_name,
    });

    const callId = blandCallResponse.call_id;
    logger.info("✅ STEP 2 COMPLETE | Bland.ai call initiated", {
      ...logContext,
      call_id: callId,
      bland_status: blandCallResponse.status,
    });

    // ═══════════════════════════════════════════════════════════════
    // CRITICAL: Store Call State for Webhook Matching
    // ═══════════════════════════════════════════════════════════════
    CallStateManager.addPendingCall(
      callId,
      requestId,
      payload.lead_id,
      payload.list_id || "",
      payload.phone_number,
      payload.first_name,
      payload.last_name
    );

    logger.info("💾 STATE | Call state stored for webhook matching", {
      ...logContext,
      call_id: callId,
      cache_stats: CallStateManager.getStats(),
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 3 & 4: ⏳ Waiting for Bland.ai Webhook
    // ═══════════════════════════════════════════════════════════════
    // When call completes, Bland.ai POSTs to /webhooks/bland-callback
    // That webhook will:
    //   1. Retrieve call state (using call_id)
    //   2. Get full transcript from Bland.ai
    //   3. Map outcome to Convoso status code
    //   4. Update Convoso with transcript + status
    logger.info("⏳ STEPS 3-4 PENDING | Waiting for call completion webhook", {
      ...logContext,
      call_id: callId,
      next_webhook: "/webhooks/bland-callback",
      max_wait_time: "90 minutes",
    });

    logger.info("✅ FLOW ACTIVE | Call in progress, monitoring for completion", {
      ...logContext,
      call_id: callId,
    });

  } catch (error: any) {
    logger.error("❌ FLOW ERROR | Callback processing failed", {
      ...logContext,
      error: error.message,
      error_stack: error.stack,
    });
    throw error;
  }
}

export default router;