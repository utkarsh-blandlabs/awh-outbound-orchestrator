/**
 * Callback Webhook Route
 *
 * Zapier replacement endpoint that:
 * 1. Receives callback trigger with customer data
 * 2. Initiates Bland.ai phone call
 * 3. Queries Convoso for call logs
 * 4. Retrieves transcript from Bland.ai
 *
 * Endpoint: POST /webhooks/call-back
 */

import { Router, Request, Response } from "express";
import { blandService } from "../services/blandService";
import { getConvosoCallLogs } from "../services/convosoService";
import { logger } from "../utils/logger";

const router = Router();

interface CallbackPayload {
  phone_number: string;
  first_name: string;
  last_name: string;
  queue_id?: string;
  // Optional fields
  age?: string;
  state?: string;
  city?: string;
  postal_code?: string;
  date_of_birth?: string;
  lead_id?: string;
}

/**
 * POST /webhooks/call-back
 *
 * Zapier-style callback webhook that orchestrates:
 * - Bland.ai call initiation
 * - Convoso call log retrieval
 * - Bland.ai transcript retrieval
 */
router.post("/call-back", async (req: Request, res: Response) => {
  const requestId = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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

    // Respond immediately to avoid timeout
    res.status(202).json({
      success: true,
      message: "Callback processing started",
      requestId,
      phone_number: payload.phone_number,
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
 * Mimics Zapier's 4-step flow
 */
async function processCallback(payload: CallbackPayload, requestId: string): Promise<void> {
  try {
    logger.info("Starting callback processing", {
      requestId,
      phone: payload.phone_number,
    });

    // STEP 1: Already received trigger data

    // STEP 2: Send phone call to Bland.ai
    logger.info("Step 2: Initiating Bland.ai call", {
      requestId,
      phone: payload.phone_number,
    });

    const blandCallResponse = await blandService.sendOutboundCall({
      phoneNumber: payload.phone_number,
      firstName: payload.first_name,
      lastName: payload.last_name,
    });

    const callId = blandCallResponse.call_id;
    logger.info("Bland.ai call initiated successfully", {
      requestId,
      callId,
      status: blandCallResponse.status,
    });

    // STEP 3: Get call logs from Convoso
    if (payload.queue_id) {
      logger.info("Step 3: Querying Convoso call logs", {
        requestId,
        queueId: payload.queue_id,
        phone: payload.phone_number,
      });

      try {
        const convosoLogs = await getConvosoCallLogs({
          queueId: payload.queue_id,
          phoneNumber: payload.phone_number,
          firstName: payload.first_name,
          lastName: payload.last_name,
          includeRecordings: false,
        });

        logger.info("Convoso call logs retrieved", {
          requestId,
          logsFound: convosoLogs.length,
          logs: convosoLogs,
        });
      } catch (convosoError: any) {
        logger.warn("Convoso call logs query failed (non-critical)", {
          requestId,
          error: convosoError.message,
        });
        // Don't fail the entire process if Convoso query fails
      }
    } else {
      logger.info("Step 3: Skipped (no queue_id provided)", { requestId });
    }

    // STEP 4: Get transcript from Bland.ai
    // Note: This happens later via the bland-callback webhook
    // We just log that we're waiting for it
    logger.info("Step 4: Transcript will be retrieved via bland-callback webhook", {
      requestId,
      callId,
      note: "Bland.ai will send transcript to /webhooks/bland-callback when call completes",
    });

    logger.info("Callback processing completed successfully", {
      requestId,
      callId,
      phone: payload.phone_number,
    });

  } catch (error: any) {
    logger.error("Callback processing failed", {
      requestId,
      error: error.message,
      stack: error.stack,
      phone: payload.phone_number,
    });
    throw error;
  }
}

export default router;