// ============================================================================
// SMS Webhook Route
// Handles incoming SMS replies from Bland AI
// NOTE: SMS conversation history is fetched from Bland.ai API directly
// This webhook is for immediate actions like blocklist or callbacks
// ============================================================================

import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { blocklistService } from "../services/blocklistService";
import { redialQueueService } from "../services/redialQueueService";
import { convosoService } from "../services/convosoService";
import { smsSchedulerService } from "../services/smsSchedulerService";
import { schedulerService } from "../services/schedulerService";
import * as fs from "fs";
import * as path from "path";

const router = Router();

// TCPA-compliant DNC keywords (comprehensive list with typo variations)
const DNC_KEYWORDS = [
  "STOP",
  "STOPALL",
  "STOOP", // Common typo
  "STOPP", // Common typo
  "ST0P", // 0 instead of O
  "STP",  // Missing O
  "STOPS", // Plural
  "UNSUBSCRIBE",
  "UNSUB",
  "UNSUSBCRIBE", // Common typo
  "CANCEL",
  "CANCLE", // Common typo
  "END",
  "QUIT",
  "REMOVE",
  "REMOVEME",
  "OPT OUT",
  "OPTOUT",
  "OPT-OUT",
  "DO NOT CONTACT",
  "DO NOT CALL",
  "DO NOT TEXT",
  "DON'T CALL",
  "DON'T TEXT",
  "DONT CALL",
  "DONT TEXT",
  "TAKE ME OFF",
  "REMOVE ME",
  "DELETE MY NUMBER",
  "DELETE ME",
  "DNC",
  "NO MORE",
  "LEAVE ME ALONE",
  "NOT INTERESTED",
];

// Callback request keywords
const CALLBACK_KEYWORDS = [
  "CALL ME",
  "CALL BACK",
  "CALLBACK",
  "PLEASE CALL",
  "CALL ME BACK",
  "SCHEDULE",
  "YES",
  "YES PLEASE",
  "INTERESTED",
  "INFO",
  "MORE INFO",
  "TELL ME MORE",
  "INFORMATION",
];

interface SMSWebhookPayload {
  from: string; // Phone number that sent the SMS
  to: string; // Our number
  body: string; // SMS message content
  sms_id?: string;
  timestamp?: string;
}

interface SMSTemplateConfig {
  opt_out_keywords: string[];
  positive_keywords: string[];
  negative_keywords: string[];
  later_keywords: string[];
}

// Load SMS templates for keywords
function loadSMSKeywords(): SMSTemplateConfig {
  const templatesPath = path.join(__dirname, "../../data/sms-templates.json");

  try {
    const data = fs.readFileSync(templatesPath, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    logger.error("Failed to load SMS keywords", { error: error.message });
    return {
      opt_out_keywords: ["STOP"],
      positive_keywords: ["YES"],
      negative_keywords: ["NO"],
      later_keywords: ["LATER"],
    };
  }
}

/**
 * POST /webhooks/sms-reply
 * Handle incoming SMS replies from Bland AI
 *
 * NOTE: The SMS scheduler fetches conversation history from Bland.ai API
 * This webhook is mainly for immediate actions (blocklist, callbacks)
 */
router.post("/sms-reply", async (req: Request, res: Response) => {
  const requestId = `sms_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    // CRITICAL DEBUG: Log full payload to understand Bland.ai's format
    logger.info("SMS reply webhook received - FULL PAYLOAD", {
      requestId,
      full_body: req.body,
      from: req.body.from,
      body: req.body.body,
      message: req.body.message, // Check if Bland uses "message" instead of "body"
      text: req.body.text,       // Check if Bland uses "text" instead of "body"
      content: req.body.content, // Check if Bland uses "content" instead of "body"
    });

    const payload: SMSWebhookPayload = req.body;

    // Bland.ai sends "message" field, not "body" - support both
    const smsBody = payload.body || (req.body as any).message;

    if (!payload.from || !smsBody) {
      logger.warn("SMS webhook validation failed - missing fields", {
        requestId,
        has_from: !!payload.from,
        has_body: !!payload.body,
        has_message: !!(req.body as any).message,
        all_fields: Object.keys(req.body),
      });
      return res.status(400).json({
        error: "Missing required fields: from, body/message",
        received_fields: Object.keys(req.body),
      });
    }

    // Normalize phone number
    const phoneNumber = payload.from.replace(/\D/g, "");
    const replyText = smsBody.trim().toUpperCase();

    // Load keywords
    const keywords = loadSMSKeywords();

    // Determine reply type
    let replyType: "POSITIVE" | "NEGATIVE" | "OPT_OUT" | "UNKNOWN" = "UNKNOWN";
    let actionTaken = "";

    // Check for DNC keywords (HIGHEST PRIORITY - TCPA compliance)
    if (DNC_KEYWORDS.some(kw => replyText.includes(kw))) {
      replyType = "OPT_OUT";
      await handleDNCRequest(phoneNumber, replyText, requestId);
      actionTaken = "DNC: Blocklist, Convoso DNC, SMS removed, Redial stopped";
    }
    // Check for callback keywords
    else if (CALLBACK_KEYWORDS.some(kw => replyText.includes(kw))) {
      replyType = "POSITIVE";
      await handleCallbackRequest(phoneNumber, replyText, requestId);
      actionTaken = "Callback scheduled";
    }
    // Check for positive keywords
    else if (keywords.positive_keywords.some(kw => replyText.includes(kw))) {
      replyType = "POSITIVE";
      actionTaken = "Positive engagement - logged for review";
    }
    // Check for negative keywords
    else if (keywords.negative_keywords.some(kw => replyText.includes(kw))) {
      replyType = "NEGATIVE";
      await handleNegativeResponse(phoneNumber, replyText, requestId);
      actionTaken = "Not interested - SMS removed";
    }
    // Check for later keywords
    else if (keywords.later_keywords.some(kw => replyText.includes(kw))) {
      replyType = "POSITIVE";
      await handleCallbackRequest(phoneNumber, replyText, requestId);
      actionTaken = "Callback requested for later";
    }

    logger.info("SMS reply processed", {
      requestId,
      phone: phoneNumber,
      replyType,
      actionTaken,
    });

    res.status(200).json({
      success: true,
      requestId,
      replyType,
      actionTaken,
    });
  } catch (error: any) {
    logger.error("SMS reply webhook error", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Internal server error",
      requestId,
    });
  }
});

/**
 * Handle DNC/STOP request (TCPA compliance)
 * 1. Add to blocklist
 * 2. Remove from SMS queue
 * 3. Update Convoso with DNC status
 * 4. Mark as completed in redial queue
 */
async function handleDNCRequest(
  phoneNumber: string,
  message: string,
  requestId: string
): Promise<void> {
  try {
    logger.warn("DNC request received via SMS", {
      requestId,
      phone: phoneNumber,
      message,
    });

    // 1. Add to permanent blocklist
    const flag = blocklistService.addFlag(
      "phone",
      phoneNumber,
      `DNC requested via SMS: "${message}"`,
      `sms_dnc_${requestId}`
    );

    logger.info("Phone number added to DNC blocklist", {
      requestId,
      phone: phoneNumber,
      flag_id: flag.id,
    });

    // 2. Remove from SMS queue immediately
    smsSchedulerService.removeLead(phoneNumber);

    logger.info("Phone number removed from SMS queue", {
      requestId,
      phone: phoneNumber,
    });

    // 3. Update Convoso with DNC status
    try {
      const leadInfo = await convosoService.lookupLeadByPhone(phoneNumber);

      if (leadInfo) {
        const convosoUpdate = await convosoService.updateLeadDisposition(
          leadInfo.lead_id,
          leadInfo.list_id,
          phoneNumber,
          "DNC",
          `DNC requested via SMS: "${message}"`,
          "SMS_DNC"
        );

        if (convosoUpdate.success) {
          logger.info("Convoso updated with DNC status", {
            requestId,
            phone: phoneNumber,
            lead_id: leadInfo.lead_id,
          });
        } else {
          logger.warn("Failed to update Convoso with DNC status", {
            requestId,
            phone: phoneNumber,
            error: convosoUpdate.error,
          });
        }
      } else {
        logger.warn("Lead not found in Convoso for DNC update", {
          requestId,
          phone: phoneNumber,
        });
      }
    } catch (error: any) {
      logger.error("Error updating Convoso with DNC status", {
        requestId,
        phone: phoneNumber,
        error: error.message,
      });
    }

    // 4. Mark lead as completed in redial queue (stop all future calls)
    try {
      await redialQueueService.markLeadAsCompleted(
        phoneNumber,
        "DNC requested via SMS"
      );

      logger.info("Lead marked as completed in redial queue", {
        requestId,
        phone: phoneNumber,
      });
    } catch (error: any) {
      logger.error("Failed to mark lead as completed in redial queue", {
        requestId,
        phone: phoneNumber,
        error: error.message,
      });
    }

    logger.info("DNC request processed successfully", {
      requestId,
      phone: phoneNumber,
      actions: [
        "Added to blocklist",
        "Removed from SMS queue",
        "Updated Convoso with DNC",
        "Marked completed in redial queue",
      ],
    });
  } catch (error: any) {
    logger.error("Failed to process DNC request", {
      requestId,
      phone: phoneNumber,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Handle callback request
 * Schedule callback in redial queue and update Convoso
 */
async function handleCallbackRequest(
  phoneNumber: string,
  message: string,
  requestId: string
): Promise<void> {
  try {
    logger.info("Callback request received via SMS", {
      requestId,
      phone: phoneNumber,
      message,
    });

    // 1. Look up lead in Convoso
    const leadInfo = await convosoService.lookupLeadByPhone(phoneNumber);

    if (!leadInfo) {
      logger.warn("Lead not found in Convoso for callback request", {
        requestId,
        phone: phoneNumber,
      });
      return;
    }

    // 2. Schedule callback in redial queue (high priority)
    const now = Date.now();
    const isBusinessHours = schedulerService.isActive();

    // If business hours: 5 min from now, else: 1 hour from now
    const callbackTime = isBusinessHours
      ? now + 5 * 60 * 1000
      : now + 60 * 60 * 1000;

    await redialQueueService.addOrUpdateLead(
      leadInfo.lead_id,
      phoneNumber,
      leadInfo.list_id,
      leadInfo.first_name || "",
      leadInfo.last_name || "",
      leadInfo.state || "",
      "CALLBACK_REQUESTED",
      `sms_callback_${requestId}`,
      callbackTime
    );

    logger.info("Callback scheduled via SMS request", {
      requestId,
      phone: phoneNumber,
      lead_id: leadInfo.lead_id,
      scheduled_time: new Date(callbackTime).toISOString(),
      is_business_hours: isBusinessHours,
    });

    // 3. Update Convoso with callback status
    try {
      const convosoUpdate = await convosoService.updateLeadDisposition(
        leadInfo.lead_id,
        leadInfo.list_id,
        phoneNumber,
        "CALLBACK",
        `Callback requested via SMS: "${message}"\nScheduled for: ${new Date(callbackTime).toISOString()}`,
        "SMS_CALLBACK"
      );

      if (convosoUpdate.success) {
        logger.info("Convoso updated with callback status", {
          requestId,
          phone: phoneNumber,
          lead_id: leadInfo.lead_id,
        });
      } else {
        logger.warn("Failed to update Convoso with callback status", {
          requestId,
          phone: phoneNumber,
          error: convosoUpdate.error,
        });
      }
    } catch (error: any) {
      logger.error("Error updating Convoso with callback status", {
        requestId,
        phone: phoneNumber,
        error: error.message,
      });
    }
  } catch (error: any) {
    logger.error("Failed to process callback request", {
      requestId,
      phone: phoneNumber,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Handle negative response (not interested but not DNC)
 */
async function handleNegativeResponse(
  phoneNumber: string,
  message: string,
  requestId: string
): Promise<void> {
  try {
    logger.info("Negative response received via SMS", {
      requestId,
      phone: phoneNumber,
      message,
    });

    // 1. Remove from SMS queue (stop SMS, but allow calls)
    smsSchedulerService.removeLead(phoneNumber);

    logger.info("Phone number removed from SMS queue (negative response)", {
      requestId,
      phone: phoneNumber,
    });

    // 2. Update Convoso with NOT_INTERESTED status
    try {
      const leadInfo = await convosoService.lookupLeadByPhone(phoneNumber);

      if (leadInfo) {
        const convosoUpdate = await convosoService.updateLeadDisposition(
          leadInfo.lead_id,
          leadInfo.list_id,
          phoneNumber,
          "NOT_INTERESTED",
          `Not interested response via SMS: "${message}"`,
          "SMS_NOT_INTERESTED"
        );

        if (convosoUpdate.success) {
          logger.info("Convoso updated with not interested status", {
            requestId,
            phone: phoneNumber,
            lead_id: leadInfo.lead_id,
          });
        } else {
          logger.warn("Failed to update Convoso with not interested status", {
            requestId,
            phone: phoneNumber,
            error: convosoUpdate.error,
          });
        }
      } else {
        logger.warn("Lead not found in Convoso for not interested update", {
          requestId,
          phone: phoneNumber,
        });
      }
    } catch (error: any) {
      logger.error("Error updating Convoso with not interested status", {
        requestId,
        phone: phoneNumber,
        error: error.message,
      });
    }
  } catch (error: any) {
    logger.error("Failed to process negative response", {
      requestId,
      phone: phoneNumber,
      error: error.message,
    });
  }
}

export default router;
