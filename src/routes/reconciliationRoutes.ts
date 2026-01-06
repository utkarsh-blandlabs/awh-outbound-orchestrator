import { Router, Request, Response } from "express";
import { reconciliationService } from "../services/reconciliationService";
import { logger } from "../utils/logger";

const router = Router();

/**
 * POST /api/admin/reconciliation/generate/:date
 * Generate reconciliation report for a specific date
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
        error: "Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-05)",
      });
    }

    const report = await reconciliationService.generateReport(date);

    res.status(200).json({
      success: true,
      report,
    });
  } catch (error: any) {
    logger.error("Failed to generate reconciliation report", { error });
    res.status(500).json({ error: "Failed to generate reconciliation report" });
  }
});

/**
 * POST /api/admin/reconciliation/generate-today
 * Generate reconciliation report for today
 */
router.post("/generate-today", async (req: Request, res: Response) => {
  try {
    const report = await reconciliationService.generateTodayReport();

    res.status(200).json({
      success: true,
      report,
    });
  } catch (error: any) {
    logger.error("Failed to generate today's reconciliation report", { error });
    res.status(500).json({ error: "Failed to generate reconciliation report" });
  }
});

/**
 * GET /api/admin/reconciliation/:date
 * Get reconciliation report for a specific date
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

    const report = reconciliationService.getReport(date);

    if (!report) {
      return res.status(404).json({
        error: "Reconciliation report not found for this date",
        hint: "Use POST /api/admin/reconciliation/generate/:date to generate one",
      });
    }

    res.status(200).json({
      success: true,
      report,
    });
  } catch (error: any) {
    logger.error("Failed to get reconciliation report", { error });
    res.status(500).json({ error: "Failed to get reconciliation report" });
  }
});

/**
 * GET /api/admin/reconciliation/list/all
 * Get list of all available reconciliation reports
 */
router.get("/list/all", (req: Request, res: Response) => {
  try {
    const dates = reconciliationService.getAvailableReports();

    res.status(200).json({
      success: true,
      total: dates.length,
      dates,
    });
  } catch (error: any) {
    logger.error("Failed to get reconciliation report list", { error });
    res.status(500).json({ error: "Failed to get report list" });
  }
});

export default router;
