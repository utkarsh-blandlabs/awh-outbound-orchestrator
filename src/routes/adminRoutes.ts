// ============================================================================
// Admin API Routes
// Provides endpoints for Retool dashboard and admin UI
// ============================================================================

import { Router, Request, Response } from "express";
import { CallStateManager } from "../services/callStateManager";
import { blandRateLimiter } from "../utils/rateLimiter";
import { statisticsService } from "../services/statisticsService";
import { schedulerService } from "../services/schedulerService";
import { dailyCallTracker } from "../services/dailyCallTrackerService";
import { answeringMachineTracker } from "../services/answeringMachineTrackerService";
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
 * GET /api/admin/config
 * Returns current system configuration (without sensitive data)
 */
router.get("/config", (req: Request, res: Response) => {
  try {
    const { config } = require("../config");

    // Build config response (excluding sensitive data like API keys)
    const configResponse = {
      server: {
        port: config.port,
        nodeEnv: config.nodeEnv,
        logLevel: config.logLevel,
      },
      bland: {
        baseUrl: config.bland.baseUrl,
        pathwayId: config.bland.pathwayId,
        startNodeId: config.bland.startNodeId,
        from: config.bland.from,
        transferPhoneNumber: config.bland.transferPhoneNumber,
        voiceId: config.bland.voiceId,
        maxDuration: config.bland.maxDuration,
        // Call behavior
        answeringMachineDetection: config.bland.answeringMachineDetection,
        waitForGreeting: config.bland.waitForGreeting,
        blockInterruptions: config.bland.blockInterruptions,
        record: config.bland.record,
        // Voicemail settings
        voicemailMessage: config.bland.voicemailMessage,
        voicemailAction: config.bland.voicemailAction,
        answeredByEnabled: config.bland.answeredByEnabled,
        sensitiveVoicemailDetection: config.bland.sensitiveVoicemailDetection,
        // SMS settings (NEW - Critical for D-day!)
        smsEnabled: config.bland.smsEnabled,
        smsFrom: config.bland.smsFrom,
        smsMessage: config.bland.smsMessage,
        // Templates
        taskTemplate: config.bland.taskTemplate,
        firstSentenceTemplate: config.bland.firstSentenceTemplate,
        webhookUrl: config.bland.webhookUrl,
      },
      convoso: {
        baseUrl: config.convoso.baseUrl,
        polling: config.convoso.polling,
      },
      retry: config.retry,
      rateLimiter: config.rateLimiter,
      answeringMachineTracker: config.answeringMachineTracker,
      queueProcessor: config.queueProcessor,
      cache: config.cache,
    };

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      config: configResponse,
    });
  } catch (error: any) {
    logger.error("Error fetching config", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

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

/**
 * GET /api/admin/statistics/today
 * Returns statistics for today
 */
router.get("/statistics/today", (req: Request, res: Response) => {
  try {
    const stats = statisticsService.getTodayStats();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      statistics: stats,
    });
  } catch (error: any) {
    logger.error("Error fetching today's statistics", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/statistics/date/:date
 * Returns statistics for a specific date (YYYY-MM-DD)
 */
router.get("/statistics/date/:date", (req: Request, res: Response) => {
  try {
    const date = req.params["date"];

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "Missing date parameter",
      });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const stats = statisticsService.getStatsByDate(date);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      date,
      statistics: stats,
    });
  } catch (error: any) {
    logger.error("Error fetching statistics for date", {
      date: req.params["date"],
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/statistics/range?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 * Returns statistics for a date range
 */
router.get("/statistics/range", (req: Request, res: Response) => {
  try {
    const startDate = req.query["start_date"] as string;
    const endDate = req.query["end_date"] as string;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: start_date and end_date",
      });
    }

    // Validate date formats
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const stats = statisticsService.getStatsByDateRange(startDate, endDate);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      start_date: startDate,
      end_date: endDate,
      days: stats.length,
      statistics: stats,
    });
  } catch (error: any) {
    logger.error("Error fetching statistics for range", {
      start_date: req.query["start_date"],
      end_date: req.query["end_date"],
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/statistics/all-time
 * Returns aggregated statistics across all dates
 */
router.get("/statistics/all-time", (req: Request, res: Response) => {
  try {
    const stats = statisticsService.getAllTimeStats();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      statistics: stats,
    });
  } catch (error: any) {
    logger.error("Error fetching all-time statistics", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/scheduler/config
 * Get current scheduler configuration
 */
router.get("/scheduler/config", (req: Request, res: Response) => {
  try {
    const config = schedulerService.getConfig();
    const isActive = schedulerService.isActive();
    const queueStats = schedulerService.getQueueStats();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      config,
      status: {
        is_active: isActive,
        callbacks_enabled: schedulerService.areCallbacksEnabled(),
      },
      queue: queueStats,
    });
  } catch (error: any) {
    logger.error("Error fetching scheduler config", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/scheduler/config
 * Update scheduler configuration
 * Body: {
 *   enabled?: boolean,
 *   callbacksEnabled?: boolean,
 *   timezone?: string,
 *   schedule?: { days?: number[], startTime?: string, endTime?: string }
 * }
 */
router.put("/scheduler/config", (req: Request, res: Response) => {
  try {
    const updates = req.body;

    // Validate timezone if provided
    if (updates.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: updates.timezone });
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: "Invalid timezone",
        });
      }
    }

    // Validate time format if provided
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (updates.schedule?.startTime && !timeRegex.test(updates.schedule.startTime)) {
      return res.status(400).json({
        success: false,
        error: "Invalid startTime format. Use HH:MM (24-hour)",
      });
    }
    if (updates.schedule?.endTime && !timeRegex.test(updates.schedule.endTime)) {
      return res.status(400).json({
        success: false,
        error: "Invalid endTime format. Use HH:MM (24-hour)",
      });
    }

    // Validate days array if provided
    if (updates.schedule?.days) {
      if (!Array.isArray(updates.schedule.days)) {
        return res.status(400).json({
          success: false,
          error: "days must be an array",
        });
      }
      const validDays = updates.schedule.days.every(
        (d: any) => typeof d === "number" && d >= 0 && d <= 6
      );
      if (!validDays) {
        return res.status(400).json({
          success: false,
          error: "days must be array of numbers 0-6 (0=Sunday, 6=Saturday)",
        });
      }
    }

    const newConfig = schedulerService.updateConfig(updates);

    logger.info("Scheduler config updated via API", {
      updates,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Scheduler configuration updated",
      config: newConfig,
      is_active: schedulerService.isActive(),
    });
  } catch (error: any) {
    logger.error("Error updating scheduler config", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/scheduler/queue
 * Get queued requests
 */
router.get("/scheduler/queue", (req: Request, res: Response) => {
  try {
    const queue = schedulerService.getQueue();
    const stats = schedulerService.getQueueStats();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats,
      queue,
    });
  } catch (error: any) {
    logger.error("Error fetching queue", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/scheduler/queue/process
 * Manually process queued requests
 */
router.post("/scheduler/queue/process", async (req: Request, res: Response) => {
  try {
    const batchSize = req.query["batch_size"]
      ? parseInt(req.query["batch_size"] as string, 10)
      : undefined;

    const result = await schedulerService.processQueue(batchSize);

    logger.info("Queue processed via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
      batch_size: batchSize || "all",
      total: result.total,
      processed: result.processed,
      failed: result.failed,
      remaining: result.remaining,
    });

    res.json({
      success: true,
      message: "Queue batch processed successfully",
      total: result.total,
      processed: result.processed,
      failed: result.failed,
      remaining: result.remaining,
      continue: result.remaining > 0,
    });
  } catch (error: any) {
    logger.error("Error processing queue", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/admin/scheduler/queue
 * Clear all queued requests
 */
router.delete("/scheduler/queue", (req: Request, res: Response) => {
  try {
    const cleared = schedulerService.clearQueue();

    logger.info("Queue cleared via API", {
      cleared,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Queue cleared successfully",
      cleared,
    });
  } catch (error: any) {
    logger.error("Error clearing queue", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// Call Protection & History Endpoints
// ============================================================================

/**
 * GET /api/admin/calls/history/:phoneNumber
 * Get call history for a specific phone number
 */
router.get("/calls/history/:phoneNumber", (req: Request, res: Response) => {
  try {
    const phoneNumber = req.params["phoneNumber"];

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      });
    }

    const history = dailyCallTracker.getCallHistory(phoneNumber);

    if (!history) {
      return res.status(404).json({
        success: false,
        error: "No call history found for this number",
      });
    }

    res.json({
      success: true,
      history,
    });
  } catch (error: any) {
    logger.error("Error fetching call history", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/calls/today
 * Get all calls made today
 */
router.get("/calls/today", (req: Request, res: Response) => {
  try {
    const records = dailyCallTracker.getAllRecords();

    res.json({
      success: true,
      total_numbers: records.length,
      records,
    });
  } catch (error: any) {
    logger.error("Error fetching today's calls", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/calls/stats/daily
 * Get today's call statistics
 */
router.get("/calls/stats/daily", (req: Request, res: Response) => {
  try {
    const stats = dailyCallTracker.getTodayStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error("Error fetching daily stats", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/calls/block
 * Manually block a phone number
 */
router.post("/calls/block", (req: Request, res: Response) => {
  try {
    const { phone_number, reason } = req.body;

    if (!phone_number) {
      return res.status(400).json({
        success: false,
        error: "phone_number is required",
      });
    }

    dailyCallTracker.blockNumber(
      phone_number,
      reason || "Manually blocked via API"
    );

    logger.info("Number blocked via API", {
      phone_number,
      reason,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Number blocked successfully",
      phone_number,
    });
  } catch (error: any) {
    logger.error("Error blocking number", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/calls/unblock
 * Unblock a phone number
 */
router.post("/calls/unblock", (req: Request, res: Response) => {
  try {
    const { phone_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({
        success: false,
        error: "phone_number is required",
      });
    }

    dailyCallTracker.unblockNumber(phone_number);

    logger.info("Number unblocked via API", {
      phone_number,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Number unblocked successfully",
      phone_number,
    });
  } catch (error: any) {
    logger.error("Error unblocking number", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/calls/protection/config
 * Get call protection configuration
 */
router.get("/calls/protection/config", (req: Request, res: Response) => {
  try {
    const config = dailyCallTracker.getConfig();

    res.json({
      success: true,
      config,
    });
  } catch (error: any) {
    logger.error("Error fetching protection config", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/calls/protection/config
 * Update call protection configuration
 */
router.put("/calls/protection/config", (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const config = dailyCallTracker.updateConfig(updates);

    logger.info("Call protection config updated via API", {
      updates,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Configuration updated successfully",
      config,
    });
  } catch (error: any) {
    logger.error("Error updating protection config", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/polling/status
 * Get Convoso polling service status
 */
router.get("/polling/status", (req: Request, res: Response) => {
  try {
    const { convosoPollingService } = require("../services/convosoPollingService");
    const status = convosoPollingService.getStatus();

    res.json({
      success: true,
      status,
    });
  } catch (error: any) {
    logger.error("Error fetching polling status", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/polling/config
 * Get Convoso polling configuration
 */
router.get("/polling/config", (req: Request, res: Response) => {
  try {
    const { convosoPollingService } = require("../services/convosoPollingService");
    const config = convosoPollingService.getConfig();

    res.json({
      success: true,
      config,
    });
  } catch (error: any) {
    logger.error("Error fetching polling config", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/polling/config
 * Update Convoso polling configuration
 */
router.put("/polling/config", (req: Request, res: Response) => {
  try {
    const { convosoPollingService } = require("../services/convosoPollingService");
    const updates = req.body;
    const config = convosoPollingService.updateConfig(updates);

    logger.info("Polling config updated via API", {
      updates,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Polling configuration updated",
      config,
      status: convosoPollingService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error updating polling config", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/polling/start
 * Start Convoso polling service
 */
router.post("/polling/start", (req: Request, res: Response) => {
  try {
    const { convosoPollingService } = require("../services/convosoPollingService");
    convosoPollingService.start();

    logger.info("Polling service started via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Polling service started",
      status: convosoPollingService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error starting polling service", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/polling/stop
 * Stop Convoso polling service
 */
router.post("/polling/stop", (req: Request, res: Response) => {
  try {
    const { convosoPollingService } = require("../services/convosoPollingService");
    convosoPollingService.stop();

    logger.info("Polling service stopped via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Polling service stopped",
      status: convosoPollingService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error stopping polling service", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// Answering Machine Tracker Endpoints
// ============================================================================

/**
 * GET /api/admin/am-tracker/config
 * Get answering machine tracker configuration
 */
router.get("/am-tracker/config", (req: Request, res: Response) => {
  try {
    const config = answeringMachineTracker.getConfig();

    res.json({
      success: true,
      config,
    });
  } catch (error: any) {
    logger.error("Error fetching AM tracker config", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/am-tracker/config
 * Update answering machine tracker configuration
 */
router.put("/am-tracker/config", (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const config = answeringMachineTracker.updateConfig(updates);

    logger.info("AM tracker config updated via API", {
      updates,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Configuration updated successfully",
      config,
    });
  } catch (error: any) {
    logger.error("Error updating AM tracker config", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/am-tracker/stats
 * Get answering machine tracker statistics
 */
router.get("/am-tracker/stats", (req: Request, res: Response) => {
  try {
    const stats = answeringMachineTracker.getStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error("Error fetching AM tracker stats", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/am-tracker/records
 * Get all answering machine tracker records with filtering
 * Query params:
 *   - filter: "all" | "new" | "max" | "recent"
 *   - minutes: number (for "new" and "recent" filters, default 60)
 *   - sort: "newest" | "oldest" | "most_attempts"
 */
router.get("/am-tracker/records", (req: Request, res: Response) => {
  try {
    const records = answeringMachineTracker.getAllRecords();
    const config = answeringMachineTracker.getConfig();

    // Query parameters
    const filter = (req.query["filter"] as string) || "all";
    const minutes = parseInt((req.query["minutes"] as string) || "60");
    const sort = (req.query["sort"] as string) || "newest";

    let filteredRecords = [...records];
    const now = Date.now();

    // Apply filters
    if (filter === "new") {
      // Leads added in last X minutes
      const cutoff = now - (minutes * 60 * 1000);
      filteredRecords = filteredRecords.filter(
        r => r.first_attempt_timestamp >= cutoff
      );
    } else if (filter === "recent") {
      // Leads called in last X minutes
      const cutoff = now - (minutes * 60 * 1000);
      filteredRecords = filteredRecords.filter(
        r => r.last_attempt_timestamp >= cutoff
      );
    } else if (filter === "max") {
      // Leads at max attempts
      filteredRecords = filteredRecords.filter(
        r => r.attempts >= config.max_attempts_per_lead
      );
    }

    // Apply sorting
    if (sort === "newest") {
      filteredRecords.sort((a, b) => b.first_attempt_timestamp - a.first_attempt_timestamp);
    } else if (sort === "oldest") {
      filteredRecords.sort((a, b) => a.first_attempt_timestamp - b.first_attempt_timestamp);
    } else if (sort === "most_attempts") {
      filteredRecords.sort((a, b) => b.attempts - a.attempts);
    }

    // Enrich records with human-readable timestamps
    const enrichedRecords = filteredRecords.map(r => ({
      ...r,
      first_attempt_iso: new Date(r.first_attempt_timestamp).toISOString(),
      last_attempt_iso: new Date(r.last_attempt_timestamp).toISOString(),
      minutes_since_first: Math.floor((now - r.first_attempt_timestamp) / 60000),
      minutes_since_last: Math.floor((now - r.last_attempt_timestamp) / 60000),
      at_max_attempts: r.attempts >= config.max_attempts_per_lead,
    }));

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      filter: filter,
      sort: sort,
      total: records.length,
      filtered: enrichedRecords.length,
      max_attempts: config.max_attempts_per_lead,
      records: enrichedRecords,
    });
  } catch (error: any) {
    logger.error("Error fetching AM tracker records", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/am-tracker/enable
 * Enable answering machine tracking
 */
router.post("/am-tracker/enable", (req: Request, res: Response) => {
  try {
    answeringMachineTracker.setEnabled(true);

    logger.info("AM tracker enabled via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Answering machine tracker enabled",
      config: answeringMachineTracker.getConfig(),
    });
  } catch (error: any) {
    logger.error("Error enabling AM tracker", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/am-tracker/disable
 * Disable answering machine tracking
 */
router.post("/am-tracker/disable", (req: Request, res: Response) => {
  try {
    answeringMachineTracker.setEnabled(false);

    logger.info("AM tracker disabled via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Answering machine tracker disabled",
      config: answeringMachineTracker.getConfig(),
    });
  } catch (error: any) {
    logger.error("Error disabling AM tracker", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/am-tracker/clear
 * Clear all answering machine tracker records
 */
router.post("/am-tracker/clear", (req: Request, res: Response) => {
  try {
    answeringMachineTracker.clearAll();

    logger.info("AM tracker records cleared via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "All records cleared",
    });
  } catch (error: any) {
    logger.error("Error clearing AM tracker records", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/am-tracker/statuses
 * Update tracked statuses dynamically
 */
router.put("/am-tracker/statuses", (req: Request, res: Response) => {
  try {
    const { tracked_statuses } = req.body;

    if (!tracked_statuses || !Array.isArray(tracked_statuses)) {
      return res.status(400).json({
        success: false,
        error: "tracked_statuses must be an array",
      });
    }

    const config = answeringMachineTracker.updateConfig({
      tracked_statuses,
    });

    logger.info("AM tracker statuses updated via API", {
      tracked_statuses,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Tracked statuses updated successfully",
      config,
    });
  } catch (error: any) {
    logger.error("Error updating AM tracker statuses", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/queue-processor/status
 * Get queue processor status
 */
router.get("/queue-processor/status", (req: Request, res: Response) => {
  try {
    const { queueProcessorService } = require("../services/queueProcessorService");
    const status = queueProcessorService.getStatus();

    res.json({
      success: true,
      status,
    });
  } catch (error: any) {
    logger.error("Error fetching queue processor status", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/queue-processor/process
 * Manually trigger queue processing
 */
router.post("/queue-processor/process", async (req: Request, res: Response) => {
  try {
    const { queueProcessorService } = require("../services/queueProcessorService");
    const result = await queueProcessorService.processNow();

    logger.info("Queue processed manually via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
      result,
    });

    res.json({
      success: true,
      message: "Queue processing completed",
      result,
    });
  } catch (error: any) {
    logger.error("Error processing queue manually", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/queue-processor/config
 * Get queue processor configuration
 */
router.get("/queue-processor/config", (req: Request, res: Response) => {
  try {
    const { queueProcessorService } = require("../services/queueProcessorService");
    const config = queueProcessorService.getConfig();

    res.json({
      success: true,
      config,
    });
  } catch (error: any) {
    logger.error("Error fetching queue processor config", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/queue-processor/config
 * Update queue processor configuration
 */
router.put("/queue-processor/config", (req: Request, res: Response) => {
  try {
    const { queueProcessorService } = require("../services/queueProcessorService");
    const updates = req.body;
    const config = queueProcessorService.updateConfig(updates);

    logger.info("Queue processor config updated via API", {
      updates,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Configuration updated successfully",
      config,
      status: queueProcessorService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error updating queue processor config", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/queue-processor/start
 * Start queue processor
 */
router.post("/queue-processor/start", (req: Request, res: Response) => {
  try {
    const { queueProcessorService } = require("../services/queueProcessorService");
    queueProcessorService.start();

    logger.info("Queue processor started via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Queue processor started",
      status: queueProcessorService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error starting queue processor", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/queue-processor/stop
 * Stop queue processor
 */
router.post("/queue-processor/stop", (req: Request, res: Response) => {
  try {
    const { queueProcessorService } = require("../services/queueProcessorService");
    queueProcessorService.stop();

    logger.info("Queue processor stopped via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Queue processor stopped",
      status: queueProcessorService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error stopping queue processor", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/queue-processor/enable
 * Enable queue processor (auto-start)
 */
router.post("/queue-processor/enable", (req: Request, res: Response) => {
  try {
    const { queueProcessorService } = require("../services/queueProcessorService");
    queueProcessorService.setEnabled(true);

    logger.info("Queue processor enabled via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Queue processor enabled",
      config: queueProcessorService.getConfig(),
      status: queueProcessorService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error enabling queue processor", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/queue-processor/disable
 * Disable queue processor (stop auto-processing)
 */
router.post("/queue-processor/disable", (req: Request, res: Response) => {
  try {
    const { queueProcessorService } = require("../services/queueProcessorService");
    queueProcessorService.setEnabled(false);

    logger.info("Queue processor disabled via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Queue processor disabled",
      config: queueProcessorService.getConfig(),
      status: queueProcessorService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error disabling queue processor", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
