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
 * ASYNC: Returns immediately, processes in background
 */
router.post("/awhealth-outbound", async (req: Request, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  logger.info("📥 Received AWH webhook", {
    request_id: requestId,
    body: req.body,
  });

  try {
    // Validate payload
    const payload = validatePayload(req.body);

    // Start orchestration in background (don't await!)
    // Connection will close immediately
    logger.info("🚀 Starting async orchestration (background processing)", {
      request_id: requestId,
    });

    // Process in background - fire and forget
    handleAwhOutbound(payload, requestId)
      .then((result) => {
        if (result.success) {
          logger.info("✅ Background orchestration completed successfully", {
            request_id: requestId,
            lead_id: result.lead_id,
            call_id: result.call_id,
            outcome: result.outcome,
          });
        } else {
          logger.error("❌ Background orchestration failed", {
            request_id: requestId,
            error: result.error,
          });
        }
      })
      .catch((error) => {
        logger.error("💥 Unhandled error in background orchestration", {
          request_id: requestId,
          error: error.message,
          stack: error.stack,
        });
      });

    // Respond immediately - don't wait for orchestration
    res.status(202).json({
      success: true,
      message: "Webhook received, processing in background",
      request_id: requestId,
    });
  } catch (error: any) {
    logger.error("Webhook validation error", {
      request_id: requestId,
      error: error.message,
      stack: error.stack,
    });

    res.status(400).json({
      success: false,
      error: error.message,
      request_id: requestId,
    });
  }
});

/**
 * Validate incoming webhook payload
 * Based on actual Convoso payload structure from Jeff
 */
function validatePayload(body: any): ConvosoWebhookPayload {
  const errors: string[] = [];

  // Required fields (based on Jeff's example)
  if (!body.first_name) errors.push("first_name is required");
  if (!body.last_name) errors.push("last_name is required");
  if (!body.phone_number) errors.push("phone_number is required");
  if (!body.state) errors.push("state is required");
  if (!body.lead_id) errors.push("lead_id is required");
  if (!body.list_id) errors.push("list_id is required");

  if (errors.length > 0) {
    throw new Error(`Invalid payload: ${errors.join(", ")}`);
  }

  // Return validated payload
  return {
    first_name: body.first_name,
    last_name: body.last_name,
    phone_number: body.phone_number,
    state: body.state,
    lead_id: body.lead_id,
    list_id: body.list_id,
    status: body.status || "NEW",
    email: body.email,
    address1: body.address1,
    city: body.city,
    postal_code: body.postal_code,
    date_of_birth: body.date_of_birth,
    age: body.age,
    ...body, // Include any additional fields
  };
}

export default router;
