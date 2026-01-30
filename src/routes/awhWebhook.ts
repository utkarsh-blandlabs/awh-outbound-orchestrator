import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { errorLogger } from "../utils/errorLogger";
import { metricsCollector } from "../utils/metricsCollector";
import { CallStateManager } from "../services/callStateManager";
import { handleAwhOutbound } from "../logic/awhOrchestrator";
import { ConvosoWebhookPayload } from "../types/awh";
import { webhookLogger } from "../services/webhookLogger";

const router = Router();

router.post("/awhealth-outbound", async (req: Request, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();

  logger.info("AWH webhook received", {
    request_id: requestId,
    phone: req.body.phone_number,
    lead_id: req.body.lead_id,
  });

  try {
    const payload = validatePayload(req.body);

    // Log the webhook request
    webhookLogger.logRequest(
      requestId,
      payload.phone_number,
      payload.lead_id,
      payload.list_id,
      payload.first_name,
      payload.last_name,
      payload.state
    );

    handleAwhOutbound(payload, requestId)
      .then((result) => {
        const durationMs = Date.now() - startTime;

        if (result.success) {
          logger.info("Orchestration completed", {
            request_id: requestId,
            lead_id: result.lead_id,
            call_id: result.call_id,
          });

          webhookLogger.logProcessingResult(requestId, true);

          metricsCollector.recordRequest(
            requestId,
            payload.phone_number,
            payload.lead_id,
            true,
            durationMs,
            { cacheSize: CallStateManager.getStats().total }
          );
        } else {
          logger.error("Orchestration failed", {
            request_id: requestId,
            error: result.error,
          });

          webhookLogger.logProcessingResult(requestId, false, result.error);

          errorLogger.logError(
            requestId,
            "ORCHESTRATION_FAILED",
            result.error || "Unknown error",
            {
              phoneNumber: payload.phone_number,
              leadId: payload.lead_id,
            }
          );

          metricsCollector.recordRequest(
            requestId,
            payload.phone_number,
            payload.lead_id,
            false,
            durationMs,
            { error: result.error }
          );
        }
      })
      .catch((error) => {
        const durationMs = Date.now() - startTime;

        logger.error("Unhandled error", {
          request_id: requestId,
          error: error.message,
        });

        webhookLogger.logProcessingResult(requestId, false, error.message);

        errorLogger.logError(
          requestId,
          "UNHANDLED_ERROR",
          error.message,
          {
            phoneNumber: payload.phone_number,
            leadId: payload.lead_id,
          }
        );

        metricsCollector.recordRequest(
          requestId,
          payload.phone_number,
          payload.lead_id,
          false,
          durationMs,
          { error: error.message }
        );
      });

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
    });

    webhookLogger.logValidationFailure(requestId, error.message);

    errorLogger.logError(
      requestId,
      "VALIDATION_ERROR",
      error.message,
      {
        httpStatus: 400,
        durationMs,
      }
    );

    res.status(400).json({
      success: false,
      error: error.message,
      request_id: requestId,
    });
  }
});

function validatePayload(body: any): ConvosoWebhookPayload {
  const errors: string[] = [];

  if (!body.phone_number) errors.push("phone_number is required");
  if (!body.lead_id) errors.push("lead_id is required");
  if (!body.list_id) errors.push("list_id is required");

  if (errors.length > 0) {
    throw new Error(`Invalid payload: ${errors.join(", ")}`);
  }

  return {
    first_name: body.first_name || "Unknown",
    last_name: body.last_name || "Lead",
    phone_number: body.phone_number,
    state: body.state || "",
    lead_id: body.lead_id,
    list_id: body.list_id,
    status: body.status || "NEW",
    email: body.email,
    address1: body.address1,
    city: body.city,
    postal_code: body.postal_code,
    date_of_birth: body.date_of_birth,
    age: body.age,
    ...body,
  };
}

export default router;
