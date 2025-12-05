// ============================================================================
// AWH Webhook Route
// Handles incoming webhook from Convoso
// ============================================================================

import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { errorLogger } from "../utils/errorLogger";
import { metricsCollector } from "../utils/metricsCollector";
import { CallStateManager } from "../services/callStateManager";
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
  const startTime = Date.now();

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
        const durationMs = Date.now() - startTime;

        if (result.success) {
          logger.info("✅ Background orchestration completed successfully", {
            request_id: requestId,
            lead_id: result.lead_id,
            call_id: result.call_id,
            outcome: result.outcome,
          });

          // Record successful metrics
          metricsCollector.recordRequest(
            requestId,
            payload.phone_number,
            payload.lead_id,
            true,
            durationMs,
            {
              cacheSize: CallStateManager.getStats().total,
            }
          );
        } else {
          logger.error("❌ Background orchestration failed", {
            request_id: requestId,
            error: result.error,
          });

          // Log error
          errorLogger.logError(
            requestId,
            "ORCHESTRATION_FAILED",
            result.error || "Unknown error",
            {
              phoneNumber: payload.phone_number,
              leadId: payload.lead_id,
              durationMs,
            }
          );

          // Record failed metrics
          metricsCollector.recordRequest(
            requestId,
            payload.phone_number,
            payload.lead_id,
            false,
            durationMs,
            {
              cacheSize: CallStateManager.getStats().total,
              error: result.error,
            }
          );
        }
      })
      .catch((error) => {
        const durationMs = Date.now() - startTime;

        logger.error("💥 Unhandled error in background orchestration", {
          request_id: requestId,
          error: error.message,
          stack: error.stack,
        });

        // Log error
        errorLogger.logError(
          requestId,
          "UNHANDLED_ERROR",
          error.message,
          {
            phoneNumber: payload.phone_number,
            leadId: payload.lead_id,
            stackTrace: error.stack,
            durationMs,
          }
        );

        // Record failed metrics
        metricsCollector.recordRequest(
          requestId,
          payload.phone_number,
          payload.lead_id,
          false,
          durationMs,
          {
            cacheSize: CallStateManager.getStats().total,
            error: error.message,
          }
        );
      });

    // Respond immediately - don't wait for orchestration
    res.status(202).json({
      success: true,
      message: "Webhook received, processing in background",
      request_id: requestId,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    logger.error("Webhook validation error", {
      request_id: requestId,
      error: error.message,
      stack: error.stack,
    });

    // Log validation error
    errorLogger.logError(
      requestId,
      "VALIDATION_ERROR",
      error.message,
      {
        stackTrace: error.stack,
        httpStatus: 400,
        durationMs,
        context: { body: req.body },
      }
    );

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
