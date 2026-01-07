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
import * as fs from "fs";
import * as path from "path";

const router = Router();

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
    logger.info("SMS reply webhook received", {
      requestId,
      from: req.body.from,
      body: req.body.body,
    });

    const payload: SMSWebhookPayload = req.body;

    if (!payload.from || !payload.body) {
      return res.status(400).json({
        error: "Missing required fields: from, body",
      });
    }

    // Normalize phone number
    const phoneNumber = payload.from.replace(/\D/g, "");
    const replyText = payload.body.trim().toUpperCase();

    // Load keywords
    const keywords = loadSMSKeywords();

    // Determine reply type
    let replyType: "POSITIVE" | "NEGATIVE" | "OPT_OUT" | "UNKNOWN" = "UNKNOWN";
    let actionTaken = "";

    // Check for opt-out keywords (HIGHEST PRIORITY)
    if (keywords.opt_out_keywords.some(kw => replyText.includes(kw))) {
      replyType = "OPT_OUT";
      await handleOptOut(phoneNumber, replyText);
      actionTaken = "Added to DNC blocklist";
    }
    // Check for positive keywords
    else if (keywords.positive_keywords.some(kw => replyText.includes(kw))) {
      replyType = "POSITIVE";
      actionTaken = "Logged for callback consideration";
    }
    // Check for negative keywords
    else if (keywords.negative_keywords.some(kw => replyText.includes(kw))) {
      replyType = "NEGATIVE";
      actionTaken = "Marked as not interested";
    }
    // Check for later keywords
    else if (keywords.later_keywords.some(kw => replyText.includes(kw))) {
      replyType = "POSITIVE";
      actionTaken = "Logged for callback consideration";
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
 * Handle opt-out (STOP) reply
 * Adds to permanent blocklist
 */
async function handleOptOut(phoneNumber: string, message: string): Promise<void> {
  try {
    // Add to permanent blocklist
    const flag = blocklistService.addFlag(
      "phone",
      phoneNumber,
      "SMS opt-out: STOP received"
    );

    logger.info("SMS opt-out processed - added to blocklist", {
      phone: phoneNumber,
      flag_id: flag.id,
    });
  } catch (error: any) {
    logger.error("Failed to process opt-out", {
      phone: phoneNumber,
      error: error.message,
    });
    throw error;
  }
}

export default router;
