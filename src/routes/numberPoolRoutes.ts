// ============================================================================
// Number Pool Routes
// API endpoints for number pool intelligence
// ============================================================================

import express, { Request, Response } from "express";
import { logger } from "../utils/logger";
import { numberPoolService } from "../services/numberPoolService";

const router = express.Router();

/**
 * GET /api/admin/number-pool/status
 * Pool overview with all numbers and their stats
 */
router.get("/status", (req: Request, res: Response) => {
  try {
    const status = numberPoolService.getPoolStatus();
    return res.json({ success: true, ...status });
  } catch (error: any) {
    logger.error("Error getting number pool status", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/number-pool/number/:number
 * Detailed stats for a single number
 */
router.get("/number/:number", (req: Request, res: Response) => {
  try {
    const number = req.params["number"] || "";
    if (!number) {
      return res.status(400).json({ success: false, error: "Number required" });
    }

    const stats = numberPoolService.getNumberStats(number);
    if (!stats) {
      return res
        .status(404)
        .json({ success: false, error: "Number not found in pool" });
    }

    return res.json({ success: true, ...stats });
  } catch (error: any) {
    logger.error("Error getting number stats", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/number-pool/mappings
 * Lead-number mappings (paginated)
 */
router.get("/mappings", (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query["limit"] as string) || "100");
    const offset = parseInt((req.query["offset"] as string) || "0");

    const result = numberPoolService.getLeadMappings(limit, offset);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error("Error getting lead mappings", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/number-pool/cooldown/clear
 * Clear all cooldowns manually
 */
router.post("/cooldown/clear", (req: Request, res: Response) => {
  try {
    const cleared = numberPoolService.clearAllCooldowns();
    return res.json({
      success: true,
      message: `Cleared ${cleared} cooldown(s)`,
      cleared,
    });
  } catch (error: any) {
    logger.error("Error clearing cooldowns", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/number-pool/reset
 * Reset all performance data
 */
router.post("/reset", (req: Request, res: Response) => {
  try {
    numberPoolService.resetAll();
    return res.json({
      success: true,
      message: "Number pool data reset successfully",
    });
  } catch (error: any) {
    logger.error("Error resetting number pool", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
