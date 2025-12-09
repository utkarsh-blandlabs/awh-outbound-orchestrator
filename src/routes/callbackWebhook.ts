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
    logger.info("Callback webhook triggered", {
      requestId,
      body: req.body,
    });

    // Validate required fields
    const payload: CallbackPayload = req.body;

    if (!payload.phone_number) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: phone_number",
        requestId,
      });
    }

    if (!payload.first_name || !payload.last_name) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: first_name and last_name",
        requestId,
      });
    }

    if (!payload.lead_id) {
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
  try {
    logger.info("🎯 Starting callback processing", {
      requestId,
      phone: payload.phone_number,
      lead_id: payload.lead_id,
      status: payload.status,
    });

    // STEP 1: ✅ Already received trigger data from Convoso

    // STEP 2: Send phone call to Bland.ai
    logger.info("📞 Step 2: Initiating Bland.ai call", {
      requestId,
      phone: payload.phone_number,
      lead_id: payload.lead_id,
    });

    const blandCallResponse = await blandService.sendOutboundCall({
      phoneNumber: payload.phone_number,
      firstName: payload.first_name,
      lastName: payload.last_name,
    });

    const callId = blandCallResponse.call_id;
    logger.info("✅ Bland.ai call initiated successfully", {
      requestId,
      callId,
      lead_id: payload.lead_id,
      status: blandCallResponse.status,
    });

    // STEP 3 & 4: Get transcript and update Convoso
    // Note: These happen later via the bland-callback webhook
    // When the call completes, Bland.ai will POST to /webhooks/bland-callback
    // That webhook will:
    //   - Fetch the transcript from Bland.ai
    //   - Update Convoso with transcript and status
    logger.info("⏳ Steps 3 & 4: Waiting for call completion", {
      requestId,
      callId,
      lead_id: payload.lead_id,
      note: "Bland.ai will POST to /webhooks/bland-callback when call completes",
      bland_callback_url: "http://56.228.64.116:3000/webhooks/bland-callback",
    });

    logger.info("🎉 Callback processing completed - call in progress", {
      requestId,
      callId,
      lead_id: payload.lead_id,
      phone: payload.phone_number,
    });

  } catch (error: any) {
    logger.error("❌ Callback processing failed", {
      requestId,
      error: error.message,
      stack: error.stack,
      phone: payload.phone_number,
      lead_id: payload.lead_id,
    });
    throw error;
  }
}

export default router;