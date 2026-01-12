// ============================================================================
// Pathway Webhook Routes
// Handles real-time updates from Bland.ai pathways during active calls
// ============================================================================

import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { convosoService } from "../services/convosoService";
import axios from "axios";
import { config } from "../config";

const router = Router();

/**
 * POST /webhooks/pathway/update-zip
 *
 * Updates lead's zip code in Convoso in real-time during pathway execution
 * This is called from a webhook node in the Bland.ai pathway after Ashley collects the zip code
 *
 * Request Body:
 * {
 *   "phone_number": "+15551234567",  // Customer's phone (required)
 *   "lead_id": "123456",              // Convoso lead ID (required)
 *   "list_id": "789",                 // Convoso list ID (required)
 *   "zip_code": "12345"               // 5-digit zip code (required)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Zip code updated successfully in Convoso",
 *   "requestId": "pathway_1234567890_abc123",
 *   "lead_id": "123456",
 *   "zip_code": "12345"
 * }
 */
router.post("/pathway/update-zip", async (req: Request, res: Response) => {
  const requestId = `pathway_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    // Log incoming request
    logger.info("Pathway webhook: Update zip code request received", {
      requestId,
      body: req.body,
    });

    // Validate required fields
    const { phone_number, lead_id, list_id, zip_code } = req.body;

    if (!phone_number || !lead_id || !list_id || !zip_code) {
      logger.warn("Pathway webhook: Missing required fields", {
        requestId,
        has_phone: !!phone_number,
        has_lead_id: !!lead_id,
        has_list_id: !!list_id,
        has_zip_code: !!zip_code,
      });

      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["phone_number", "lead_id", "list_id", "zip_code"],
        received: Object.keys(req.body),
        requestId,
      });
    }

    // Validate zip code format (5 digits)
    const zipCodeStr = String(zip_code).trim();
    if (!/^\d{5}$/.test(zipCodeStr)) {
      logger.warn("Pathway webhook: Invalid zip code format", {
        requestId,
        zip_code: zipCodeStr,
      });

      return res.status(400).json({
        success: false,
        error: "Invalid zip code format. Must be 5 digits.",
        zip_code: zipCodeStr,
        requestId,
      });
    }

    // Normalize phone number (remove +1 prefix for Convoso)
    const normalizedPhone = String(phone_number).replace(/^\+1/, "").replace(/\D/g, "");

    logger.info("Pathway webhook: Updating Convoso with zip code", {
      requestId,
      lead_id,
      list_id,
      phone: normalizedPhone,
      zip_code: zipCodeStr,
    });

    // Update Convoso lead with zip code
    const convosoResponse = await updateConvosoZipCode(
      lead_id,
      list_id,
      normalizedPhone,
      zipCodeStr,
      requestId
    );

    logger.info("Pathway webhook: Zip code updated successfully", {
      requestId,
      lead_id,
      zip_code: zipCodeStr,
      convoso_response: convosoResponse,
    });

    return res.status(200).json({
      success: true,
      message: "Zip code updated successfully in Convoso",
      requestId,
      lead_id,
      list_id,
      zip_code: zipCodeStr,
      updated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error("Pathway webhook: Failed to update zip code", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: "Failed to update zip code in Convoso",
      message: error.message,
      requestId,
    });
  }
});

/**
 * Update Convoso lead with zip code only
 * Uses Convoso's /v1/leads/update API endpoint
 */
async function updateConvosoZipCode(
  leadId: string,
  listId: string,
  phoneNumber: string,
  zipCode: string,
  requestId: string
): Promise<any> {
  try {
    const requestData = {
      auth_token: config.convoso.authToken,
      lead_id: leadId,
      list_id: listId,
      phone_number: phoneNumber,
      postal_code: zipCode,
    };

    logger.debug("Calling Convoso API to update zip code", {
      requestId,
      lead_id: leadId,
      list_id: listId,
      phone: phoneNumber,
      zip_code: zipCode,
    });

    const response = await axios.post(
      `${config.convoso.baseUrl}/v1/leads/update`,
      null,
      {
        params: requestData,
        timeout: 10000, // 10 second timeout for real-time pathway
      }
    );

    if (response.data.success === false) {
      throw new Error(
        response.data.text || `Convoso API error: ${response.data.code}`
      );
    }

    logger.info("Convoso API: Zip code updated", {
      requestId,
      lead_id: leadId,
      response: response.data,
    });

    return response.data;
  } catch (error: any) {
    logger.error("Convoso API: Failed to update zip code", {
      requestId,
      error: error.message,
      response: error.response?.data,
      lead_id: leadId,
    });
    throw new Error(`Convoso update failed: ${error.message}`);
  }
}

/**
 * POST /webhooks/pathway/update-lead-data
 *
 * Generic endpoint to update any lead data during pathway execution
 * This can be used to update multiple fields at once
 *
 * Request Body:
 * {
 *   "phone_number": "+15551234567",
 *   "lead_id": "123456",
 *   "list_id": "789",
 *   "data": {
 *     "postal_code": "12345",
 *     "state": "CA",
 *     "plan_type": "ACA",
 *     "member_count": "2",
 *     "age": "45"
 *   }
 * }
 */
router.post("/pathway/update-lead-data", async (req: Request, res: Response) => {
  const requestId = `pathway_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    logger.info("Pathway webhook: Update lead data request received", {
      requestId,
      body: req.body,
    });

    const { phone_number, lead_id, list_id, data } = req.body;

    if (!phone_number || !lead_id || !list_id || !data) {
      logger.warn("Pathway webhook: Missing required fields", {
        requestId,
        has_phone: !!phone_number,
        has_lead_id: !!lead_id,
        has_list_id: !!list_id,
        has_data: !!data,
      });

      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["phone_number", "lead_id", "list_id", "data"],
        received: Object.keys(req.body),
        requestId,
      });
    }

    // Normalize phone number
    const normalizedPhone = String(phone_number).replace(/^\+1/, "").replace(/\D/g, "");

    logger.info("Pathway webhook: Updating Convoso with lead data", {
      requestId,
      lead_id,
      list_id,
      phone: normalizedPhone,
      fields: Object.keys(data),
    });

    // Build request data
    const requestData: any = {
      auth_token: config.convoso.authToken,
      lead_id,
      list_id,
      phone_number: normalizedPhone,
      ...data, // Spread all data fields
    };

    // Call Convoso API
    const response = await axios.post(
      `${config.convoso.baseUrl}/v1/leads/update`,
      null,
      {
        params: requestData,
        timeout: 10000,
      }
    );

    if (response.data.success === false) {
      throw new Error(
        response.data.text || `Convoso API error: ${response.data.code}`
      );
    }

    logger.info("Pathway webhook: Lead data updated successfully", {
      requestId,
      lead_id,
      fields_updated: Object.keys(data),
      convoso_response: response.data,
    });

    return res.status(200).json({
      success: true,
      message: "Lead data updated successfully in Convoso",
      requestId,
      lead_id,
      list_id,
      fields_updated: Object.keys(data),
      updated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error("Pathway webhook: Failed to update lead data", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: "Failed to update lead data in Convoso",
      message: error.message,
      requestId,
    });
  }
});

export default router;
