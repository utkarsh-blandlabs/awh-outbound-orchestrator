// ============================================================================
// Admin API Routes
// Provides endpoints for Retool dashboard and admin UI
// ============================================================================

import { Router, Request, Response } from "express";
import { CallStateManager } from "../services/callStateManager";
import { blandRateLimiter } from "../utils/rateLimiter";
import { logger } from "../utils/logger";

const router = Router();

/**
 * Simple API key authentication middleware
 * In production, use proper JWT or OAuth
 */
function authenticateAdmin(req: Request, res: Response, next: Function) {
  const apiKey = req.headers["x-api-key"] || req.query["api_key"];

  // Check API key (set in environment variables)
  if (!process.env["ADMIN_API_KEY"]) {
    logger.error("ADMIN_API_KEY not set, blocking admin access");
    return res.status(500).json({
      success: false,
      error: "Admin API not configured properly",
    });
  }

  if (apiKey !== process.env["ADMIN_API_KEY"]) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized - Invalid API key",
    });
  }

  next();
}

// Apply authentication to all admin routes
router.use(authenticateAdmin);

/**
 * GET /api/admin/calls/active
 * Returns all active/pending calls from CallStateManager
 */
router.get("/calls/active", (req: Request, res: Response) => {
  try {
    const pendingCalls = CallStateManager.getAllPendingCalls();
    const now = Date.now();

    const enrichedCalls = pendingCalls.map((call) => ({
      call_id: call.call_id,
      request_id: call.request_id,
      lead_id: call.lead_id,
      phone_number: call.phone_number,
      first_name: call.first_name,
      last_name: call.last_name,
      created_at: call.created_at,
      status: call.status,
      error: call.error || null,
      // Calculated fields
      duration_ms: now - call.created_at,
      age_minutes: parseFloat(((now - call.created_at) / 60000).toFixed(2)),
      created_at_iso: new Date(call.created_at).toISOString(),
      // Helper fields for UI
      customer_name: `${call.first_name} ${call.last_name}`,
      is_stale: now - call.created_at > 30 * 60 * 1000, // Older than 30 minutes
    }));

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: enrichedCalls.length,
      calls: enrichedCalls,
    });
  } catch (error: any) {
    logger.error("Error fetching active calls", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/calls/stats
 * Returns statistics about calls in cache
 */
router.get("/calls/stats", (req: Request, res: Response) => {
  try {
    const stats = CallStateManager.getStats();
    const memoryUsage = process.memoryUsage();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        total: stats.total,
        pending: stats.pending,
        completed: stats.completed,
        failed: stats.failed,
        cache_size_mb: parseFloat(
          (memoryUsage.heapUsed / 1024 / 1024).toFixed(2)
        ),
        memory_usage: {
          rss_mb: parseFloat((memoryUsage.rss / 1024 / 1024).toFixed(2)),
          heap_used_mb: parseFloat(
            (memoryUsage.heapUsed / 1024 / 1024).toFixed(2)
          ),
          heap_total_mb: parseFloat(
            (memoryUsage.heapTotal / 1024 / 1024).toFixed(2)
          ),
        },
      },
    });
  } catch (error: any) {
    logger.error("Error fetching call stats", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/calls/:call_id
 * Returns details for a specific call
 */
router.get("/calls/:call_id", (req: Request, res: Response) => {
  try {
    const call_id = req.params["call_id"];
    if (!call_id) {
      return res.status(400).json({
        success: false,
        error: "Missing call_id parameter",
      });
    }
    const call = CallStateManager.getPendingCall(call_id);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: "Call not found",
        call_id,
      });
    }

    const now = Date.now();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      call: {
        ...call,
        duration_ms: now - call.created_at,
        age_minutes: parseFloat(((now - call.created_at) / 60000).toFixed(2)),
        created_at_iso: new Date(call.created_at).toISOString(),
        customer_name: `${call.first_name} ${call.last_name}`,
        is_stale: now - call.created_at > 30 * 60 * 1000,
      },
    });
  } catch (error: any) {
    logger.error("Error fetching call details", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/cache/clear
 * Clears completed calls from cache
 */
router.post("/cache/clear", (req: Request, res: Response) => {
  try {
    const beforeStats = CallStateManager.getStats();

    // Manually trigger cleanup
    CallStateManager.cleanupOldCalls();

    const afterStats = CallStateManager.getStats();

    logger.info("Cache cleared via admin API", {
      before: beforeStats,
      after: afterStats,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Cache cleared successfully",
      before: beforeStats,
      after: afterStats,
      cleared: beforeStats.total - afterStats.total,
    });
  } catch (error: any) {
    logger.error("Error clearing cache", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/admin/calls/:call_id
 * Manually remove a specific call from cache
 */
router.delete("/calls/:call_id", (req: Request, res: Response) => {
  try {
    const call_id = req.params["call_id"];
    if (!call_id) {
      return res.status(400).json({
        success: false,
        error: "Missing call_id parameter",
      });
    }

    const call = CallStateManager.getPendingCall(call_id);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: "Call not found",
        call_id,
      });
    }

    // Mark as failed to trigger cleanup
    CallStateManager.failCall(call_id, "Manually removed by admin");

    logger.info("Call manually removed from cache", {
      call_id,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Call removed from cache",
      call_id,
    });
  } catch (error: any) {
    logger.error("Error removing call from cache", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/health
 * Returns system health status
 */
router.get("/health", (req: Request, res: Response) => {
  try {
    const stats = CallStateManager.getStats();
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    const rateLimitStats = blandRateLimiter.getStats();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      status: "healthy",
      uptime_seconds: Math.floor(uptime),
      uptime_formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        rss_mb: parseFloat((memoryUsage.rss / 1024 / 1024).toFixed(2)),
        heap_used_mb: parseFloat(
          (memoryUsage.heapUsed / 1024 / 1024).toFixed(2)
        ),
        heap_total_mb: parseFloat(
          (memoryUsage.heapTotal / 1024 / 1024).toFixed(2)
        ),
      },
      calls: stats,
      rate_limit: {
        current_rate: `${rateLimitStats.currentCallsPerSecond}/${rateLimitStats.maxCallsPerSecond} calls/sec`,
        utilization: `${rateLimitStats.utilizationPercent}%`,
        unique_numbers: rateLimitStats.uniqueNumbersCalled,
        config: blandRateLimiter.getConfig(),
      },
      node_version: process.version,
      platform: process.platform,
    });
  } catch (error: any) {
    logger.error("Error checking health", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
