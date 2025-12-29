import { Router, Request, Response } from "express";
import { blocklistService } from "../services/blocklistService";
import { logger } from "../utils/logger";

const router = Router();

/**
 * GET /api/admin/blocklist
 * Get all blocklist flags and configuration
 */
router.get("/", (req: Request, res: Response) => {
  try {
    const config = blocklistService.getConfig();

    res.status(200).json({
      enabled: config.enabled,
      flags_count: config.flags.length,
      flags: config.flags,
    });
  } catch (error) {
    logger.error("Failed to get blocklist config", { error });
    res.status(500).json({ error: "Failed to get blocklist configuration" });
  }
});

/**
 * POST /api/admin/blocklist
 * Add a new blocklist flag
 *
 * Body:
 * {
 *   "field": "phone",
 *   "value": "3055551234",
 *   "reason": "Customer requested no contact" // optional
 * }
 */
router.post("/", (req: Request, res: Response) => {
  try {
    const { field, value, reason } = req.body;

    if (!field || !value) {
      return res.status(400).json({
        error: "Missing required fields: field and value are required",
      });
    }

    const flag = blocklistService.addFlag(field, value, reason);

    logger.info("Blocklist flag added via API", {
      id: flag.id,
      field,
      value,
    });

    res.status(201).json({
      success: true,
      message: "Blocklist flag added successfully",
      flag,
    });
  } catch (error) {
    logger.error("Failed to add blocklist flag", { error });
    res.status(500).json({ error: "Failed to add blocklist flag" });
  }
});

/**
 * DELETE /api/admin/blocklist/:flagId
 * Remove a blocklist flag by ID
 */
router.delete("/:flagId", (req: Request, res: Response) => {
  try {
    const { flagId } = req.params;

    if (!flagId) {
      return res.status(400).json({
        error: "Flag ID parameter is required",
      });
    }

    const removed = blocklistService.removeFlag(flagId);

    if (removed) {
      logger.info("Blocklist flag removed via API", { flag_id: flagId });

      res.status(200).json({
        success: true,
        message: "Blocklist flag removed successfully",
      });
    } else {
      res.status(404).json({
        error: "Blocklist flag not found",
      });
    }
  } catch (error) {
    logger.error("Failed to remove blocklist flag", { error });
    res.status(500).json({ error: "Failed to remove blocklist flag" });
  }
});

/**
 * PUT /api/admin/blocklist/enabled
 * Enable or disable blocklist
 *
 * Body:
 * {
 *   "enabled": true
 * }
 */
router.put("/enabled", (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        error: "enabled must be a boolean",
      });
    }

    blocklistService.setEnabled(enabled);

    res.status(200).json({
      success: true,
      message: `Blocklist ${enabled ? "enabled" : "disabled"} successfully`,
      enabled,
    });
  } catch (error) {
    logger.error("Failed to update blocklist enabled status", { error });
    res
      .status(500)
      .json({ error: "Failed to update blocklist enabled status" });
  }
});

/**
 * GET /api/admin/blocklist/attempts/today
 * Get today's blocked attempts
 */
router.get("/attempts/today", (req: Request, res: Response) => {
  try {
    const attempts = blocklistService.getTodayAttempts();

    res.status(200).json({
      date: new Date()
        .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
        .split("T")[0],
      total_attempts: attempts.length,
      blocked_count: attempts.filter((a) => a.blocked).length,
      attempts,
    });
  } catch (error) {
    logger.error("Failed to get today's blocklist attempts", { error });
    res.status(500).json({ error: "Failed to get blocklist attempts" });
  }
});

/**
 * GET /api/admin/blocklist/attempts/:date
 * Get blocked attempts for a specific date (YYYY-MM-DD format)
 */
router.get("/attempts/:date", (req: Request, res: Response) => {
  try {
    const { date } = req.params;

    if (!date) {
      return res.status(400).json({
        error: "Date parameter is required",
      });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD (e.g., 2024-12-24)",
      });
    }

    const attempts = blocklistService.getAttempts(date);

    res.status(200).json({
      date,
      total_attempts: attempts.length,
      blocked_count: attempts.filter((a) => a.blocked).length,
      attempts,
    });
  } catch (error) {
    logger.error("Failed to get blocklist attempts", { error });
    res.status(500).json({ error: "Failed to get blocklist attempts" });
  }
});

/**
 * GET /api/admin/blocklist/statistics
 * Get blocklist attempt statistics for a date range
 *
 * Query params:
 * - start: Start date (YYYY-MM-DD)
 * - end: End date (YYYY-MM-DD)
 *
 * Example: /api/admin/blocklist/statistics?start=2024-12-01&end=2024-12-24
 */
router.get("/statistics", (req: Request, res: Response) => {
  try {
    const { start, end } = req.query;

    // Default to last 7 days if not specified
    const endDateStr = end as string | undefined;
    const startDateStr = start as string | undefined;

    const endDate =
      endDateStr ||
      new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const startDate =
      startDateStr ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString(
        "en-CA",
        { timeZone: "America/New_York" }
      );

    // Validate date formats
    if (
      !startDate ||
      !endDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD (e.g., 2024-12-24)",
      });
    }

    const statistics = blocklistService.getAttemptStatistics(
      startDate,
      endDate
    );

    res.status(200).json({
      date_range: {
        start: startDate,
        end: endDate,
      },
      ...statistics,
    });
  } catch (error) {
    logger.error("Failed to get blocklist statistics", { error });
    res.status(500).json({ error: "Failed to get blocklist statistics" });
  }
});

export default router;
