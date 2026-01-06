import { Router, Request, Response } from "express";
import { dailyReportService } from "../services/dailyReportService";
import { logger } from "../utils/logger";

const router = Router();

/**
 * POST /api/admin/daily-report/generate/:date
 * Generate daily report for a specific date
 */
router.post("/generate/:date", async (req: Request, res: Response) => {
  try {
    const { date } = req.params;

    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-07)",
      });
    }

    const report = await dailyReportService.generateReport(date);

    res.status(200).json({
      success: true,
      report,
    });
  } catch (error: any) {
    logger.error("Failed to generate daily report", { error });
    res.status(500).json({ error: "Failed to generate daily report" });
  }
});

/**
 * POST /api/admin/daily-report/generate-today
 * Generate daily report for today
 */
router.post("/generate-today", async (req: Request, res: Response) => {
  try {
    const report = await dailyReportService.generateTodayReport();

    res.status(200).json({
      success: true,
      report,
    });
  } catch (error: any) {
    logger.error("Failed to generate today's daily report", { error });
    res.status(500).json({ error: "Failed to generate daily report" });
  }
});

/**
 * GET /api/admin/daily-report/:date
 * Get daily report for a specific date
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
        error: "Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-07)",
      });
    }

    const report = dailyReportService.getReport(date);

    if (!report) {
      return res.status(404).json({
        error: "Daily report not found for this date",
        hint: "Use POST /api/admin/daily-report/generate/:date to generate one",
      });
    }

    res.status(200).json({
      success: true,
      report,
    });
  } catch (error: any) {
    logger.error("Failed to get daily report", { error });
    res.status(500).json({ error: "Failed to get daily report" });
  }
});

export default router;
