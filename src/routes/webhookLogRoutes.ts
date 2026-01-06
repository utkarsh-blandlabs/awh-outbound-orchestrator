import { Router, Request, Response } from "express";
import { webhookLogger } from "../services/webhookLogger";
import { logger } from "../utils/logger";

const router = Router();

/**
 * GET /api/admin/webhook-logs/today
 * Get today's webhook logs
 */
router.get("/today", (req: Request, res: Response) => {
  try {
    const logs = webhookLogger.getTodayLogs();
    const stats = webhookLogger.getTodayStats();

    res.status(200).json({
      success: true,
      date: new Date()
        .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
        .split("T")[0],
      stats,
      total: logs.length,
      logs,
    });
  } catch (error: any) {
    logger.error("Failed to get today's webhook logs", { error });
    res.status(500).json({ error: "Failed to get webhook logs" });
  }
});

/**
 * GET /api/admin/webhook-logs/:date
 * Get webhook logs for a specific date (YYYY-MM-DD format)
 */
router.get("/:date", (req: Request, res: Response) => {
  try {
    const { date } = req.params;

    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-05)",
      });
    }

    const logs = webhookLogger.getLogsByDate(date);
    const stats = webhookLogger.getStatsByDate(date);

    res.status(200).json({
      success: true,
      date,
      stats,
      total: logs.length,
      logs,
    });
  } catch (error: any) {
    logger.error("Failed to get webhook logs by date", { error });
    res.status(500).json({ error: "Failed to get webhook logs" });
  }
});

/**
 * GET /api/admin/webhook-logs/search/phone/:phoneNumber
 * Search webhook logs by phone number
 */
router.get("/search/phone/:phoneNumber", (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.params;

    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number parameter is required" });
    }

    const logs = webhookLogger.searchByPhone(phoneNumber);

    res.status(200).json({
      success: true,
      phone_number: phoneNumber,
      total: logs.length,
      logs: logs.sort((a, b) => b.timestamp - a.timestamp), // Most recent first
    });
  } catch (error: any) {
    logger.error("Failed to search webhook logs by phone", { error });
    res.status(500).json({ error: "Failed to search webhook logs" });
  }
});

/**
 * GET /api/admin/webhook-logs/search/lead/:leadId
 * Search webhook logs by lead_id
 */
router.get("/search/lead/:leadId", (req: Request, res: Response) => {
  try {
    const { leadId } = req.params;

    if (!leadId) {
      return res.status(400).json({ error: "Lead ID parameter is required" });
    }

    const logs = webhookLogger.searchByLeadId(leadId);

    res.status(200).json({
      success: true,
      lead_id: leadId,
      total: logs.length,
      logs: logs.sort((a, b) => b.timestamp - a.timestamp), // Most recent first
    });
  } catch (error: any) {
    logger.error("Failed to search webhook logs by lead_id", { error });
    res.status(500).json({ error: "Failed to search webhook logs" });
  }
});

export default router;
