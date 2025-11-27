// ============================================================================
// AWH Webhook Route
// Handles incoming webhook from Convoso
// ============================================================================

import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { handleAwhOutbound } from "../logic/awhOrchestrator";
import { ConvosoWebhookPayload } from "../types/awh";

const router = Router();

/**
 * POST /webhooks/awhealth-outbound
 *
 * Receives webhook from Convoso when a lead fills out the form
 * Triggers the entire outbound call orchestration
 *
 * SYNCHRONOUS: Connection stays open until entire flow completes (30s - 5min)
 */
router.post("/awhealth-outbound", async (req: Request, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  logger.info("📥 Received AWH webhook", {
    request_id: requestId,
    body: req.body,
  });

  try {
    // Validate payload
    const payload = validatePayload(req.body);

    // AWAIT the entire orchestration - connection stays open
    // This can take 30 seconds to 5 minutes (waiting for call to complete)
    logger.info(
      "⏳ Starting synchronous orchestration (connection will stay open)",
      {
        request_id: requestId,
      }
    );

    const result = await handleAwhOutbound(payload);

    // Connection has been open this whole time
    // Now we respond with the final result
    if (result.success) {
      logger.info("✅ Orchestration completed successfully", {
        request_id: requestId,
        lead_id: result.lead_id,
        call_id: result.call_id,
        outcome: result.outcome,
      });

      res.status(200).json({
        success: true,
        request_id: requestId,
        lead_id: result.lead_id,
        call_id: result.call_id,
        outcome: result.outcome,
        transcript: result.transcript,
      });
    } else {
      logger.error("❌ Orchestration failed", {
        request_id: requestId,
        error: result.error,
      });

      res.status(500).json({
        success: false,
        request_id: requestId,
        error: result.error,
      });
    }
  } catch (error: any) {
    logger.error("Webhook processing error", {
      request_id: requestId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: error.message,
      request_id: requestId,
    });
  }
});

/**
 * Validate incoming webhook payload
 */
function validatePayload(body: any): ConvosoWebhookPayload {
  const errors: string[] = [];

  // Required fields
  if (!body.first_name) errors.push("first_name is required");
  if (!body.last_name) errors.push("last_name is required");
  if (!body.phone) errors.push("phone is required");
  if (!body.state) errors.push("state is required");

  if (errors.length > 0) {
    throw new Error(`Invalid payload: ${errors.join(", ")}`);
  }

  // Return validated payload
  return {
    first_name: body.first_name,
    last_name: body.last_name,
    phone: body.phone,
    state: body.state,
    lead_id: body.lead_id,
    ...body, // Include any additional fields
  };
}

export default router;
