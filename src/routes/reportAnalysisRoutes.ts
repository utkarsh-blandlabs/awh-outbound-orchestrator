// ============================================================================
// Report Analysis Routes
// ============================================================================

import express, { Request, Response } from "express";
import path from "path";
import { logger } from "../utils/logger";
import {
  TranscriptAnalyzer,
  awhConfig,
  formatSlackReport,
  formatTextReport,
  fixStatsForDate,
} from "../services/reportAnalysis";

const router = express.Router();
const DATA_DIR = path.join(process.cwd(), "data");

function getAnalyzer(): TranscriptAnalyzer {
  const apiKey = process.env["BLAND_API_KEY"] || "";
  const config = {
    ...awhConfig,
    blandApiKey: apiKey,
  };
  return new TranscriptAnalyzer(config);
}

/**
 * GET /api/admin/report-analysis/analyze/:date
 */
router.get("/analyze/:date", async (req: Request, res: Response) => {
  try {
    const date = req.params["date"] || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "Invalid date format (YYYY-MM-DD)" });
    }

    if (!process.env["BLAND_API_KEY"]) {
      return res.status(400).json({ success: false, error: "BLAND_API_KEY not configured" });
    }

    const analyzer = getAnalyzer();
    const results = await analyzer.fetchAndAnalyzeDate(date);
    const report = analyzer.generateReport(date, results);

    return res.json({ success: true, report });
  } catch (error: any) {
    logger.error("Error analyzing calls", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/report-analysis/report/:date
 */
router.get("/report/:date", async (req: Request, res: Response) => {
  try {
    const date = req.params["date"] || "";
    const format = (req.query["format"] as string) || "text";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "Invalid date format" });
    }

    if (!process.env["BLAND_API_KEY"]) {
      return res.status(400).json({ success: false, error: "BLAND_API_KEY not configured" });
    }

    const analyzer = getAnalyzer();
    const results = await analyzer.fetchAndAnalyzeDate(date);
    const report = analyzer.generateReport(date, results);

    const formatted = format === "slack"
      ? formatSlackReport(report)
      : formatTextReport(report);

    return res.json({ success: true, formatted, report });
  } catch (error: any) {
    logger.error("Error generating report", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/report-analysis/fix-stats/:date
 */
router.post("/fix-stats/:date", async (req: Request, res: Response) => {
  try {
    const date = req.params["date"] || "";
    const dryRun = req.query["dry_run"] === "true";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "Invalid date format" });
    }

    if (!process.env["BLAND_API_KEY"]) {
      return res.status(400).json({ success: false, error: "BLAND_API_KEY not configured" });
    }

    const analyzer = getAnalyzer();
    const result = await fixStatsForDate(date, analyzer, DATA_DIR, dryRun);

    if (!result) {
      return res.json({ success: true, message: "No data found for date", date });
    }

    return res.json({
      success: true,
      date,
      dry_run: dryRun,
      changed: result.changed,
      old_stats: {
        answered_calls: result.oldStats["answered_calls"],
        transferred_calls: result.oldStats["transferred_calls"],
        voicemail_calls: result.oldStats["voicemail_calls"],
        busy_calls: result.oldStats["busy_calls"],
        callback_requested_calls: result.oldStats["callback_requested_calls"],
        failed_calls: result.oldStats["failed_calls"],
      },
      new_stats: {
        answered_calls: result.newStats.answered_calls,
        transferred_calls: result.newStats.transferred_calls,
        voicemail_calls: result.newStats.voicemail_calls,
        busy_calls: result.newStats.busy_calls,
        callback_requested_calls: result.newStats.callback_requested_calls,
        failed_calls: result.newStats.failed_calls,
        no_answer_calls: result.newStats.no_answer_calls,
        not_interested_calls: result.newStats.not_interested_calls,
      },
    });
  } catch (error: any) {
    logger.error("Error fixing stats", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
