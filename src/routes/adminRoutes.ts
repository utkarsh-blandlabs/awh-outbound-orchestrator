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
import { redialQueueService } from "../services/redialQueueService";
import { badNumbersService } from "../services/badNumbersService";
import { blocklistService } from "../services/blocklistService";
import { logger } from "../utils/logger";

const router = Router();

/**
 * Simple API key authentication middleware
 * In production, use proper JWT or OAuth
 */
function authenticateAdmin(req: Request, res: Response, next: Function) {
  // Accept API key from header or query params (both "key" and "api_key" for convenience)
  const apiKey = req.headers["x-api-key"] || req.query["api_key"] || req.query["key"];

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
    const phoneNumber = req.params["phoneNumber"] as string;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      });
    }

    const history = dailyCallTracker.getCallHistory(phoneNumber);

    // Check blocklist status (permanent DNC list)
    const blocklistCheck = blocklistService.shouldBlock({ phone: phoneNumber });
    const blocklistFlag = blocklistCheck.blocked ? blocklistCheck.flag : null;

    // Check bad numbers list (permanently failed numbers)
    const badNumberRecord = badNumbersService.getBadNumberRecord(phoneNumber);

    if (!history) {
      // Return blocklist/bad number info even if no call history
      res.json({
        success: true,
        history: null,
        blocklist: {
          is_blocked: blocklistCheck.blocked,
          reason: blocklistCheck.reason,
          flag: blocklistFlag,
        },
        bad_number: badNumberRecord ? {
          is_bad: true,
          error_message: badNumberRecord.error_message,
          failure_count: badNumberRecord.failure_count,
          first_failed_at: new Date(badNumberRecord.first_failed_at).toISOString(),
        } : null,
      });
      return;
    }

    // Enhance history with blocklist and bad number info
    res.json({
      success: true,
      history: {
        ...history,
        // Override blocked status to include blocklist check
        blocked: history.blocked || blocklistCheck.blocked,
        blocked_reason: history.blocked_reason || blocklistCheck.reason,
      },
      blocklist: {
        is_blocked: blocklistCheck.blocked,
        reason: blocklistCheck.reason,
        flag: blocklistFlag,
      },
      bad_number: badNumberRecord ? {
        is_bad: true,
        error_message: badNumberRecord.error_message,
        failure_count: badNumberRecord.failure_count,
        first_failed_at: new Date(badNumberRecord.first_failed_at).toISOString(),
      } : null,
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

// ============================================================================
// Redial Queue Endpoints
// ============================================================================

/**
 * GET /api/admin/redial-queue/status
 * Get redial queue processor status
 */
router.get("/redial-queue/status", (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    const status = redialQueueService.getStatus();
    const stats = redialQueueService.getStats();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      status,
      stats,
    });
  } catch (error: any) {
    logger.error("Error fetching redial queue status", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/redial-queue/config
 * Get redial queue configuration
 */
router.get("/redial-queue/config", (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    const config = redialQueueService.getConfig();

    res.json({
      success: true,
      config,
    });
  } catch (error: any) {
    logger.error("Error fetching redial queue config", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/redial-queue/config
 * Update redial queue configuration
 */
router.put("/redial-queue/config", (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    const updates = req.body;
    const config = redialQueueService.updateConfig(updates);

    logger.info("Redial queue config updated via API", {
      updates,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Configuration updated successfully",
      config,
      status: redialQueueService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error updating redial queue config", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/redial-queue/records
 * Get redial queue records with filtering
 * Query params:
 *   - status: "pending" | "rescheduled" | "completed" | "max_attempts" | "paused"
 *   - ready: boolean (only ready to dial)
 *   - limit: number
 *   - offset: number
 */
router.get("/redial-queue/records", (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");

    const filter: any = {};
    if (req.query["status"]) filter.status = req.query["status"] as string;
    if (req.query["ready"]) filter.ready = req.query["ready"] === "true";
    if (req.query["limit"])
      filter.limit = parseInt(req.query["limit"] as string);
    if (req.query["offset"])
      filter.offset = parseInt(req.query["offset"] as string);

    const records = redialQueueService.getAllRecords(filter);
    const stats = redialQueueService.getStats();

    // Enrich records with human-readable data
    const now = Date.now();
    const enrichedRecords = records.map((r: any) => ({
      ...r,
      last_call_iso: new Date(r.last_call_timestamp).toISOString(),
      next_redial_iso: new Date(r.next_redial_timestamp).toISOString(),
      created_at_iso: new Date(r.created_at).toISOString(),
      minutes_until_next_redial: Math.max(
        0,
        Math.floor((r.next_redial_timestamp - now) / 60000)
      ),
      is_ready: r.next_redial_timestamp <= now && r.attempts < stats.max_attempts,
    }));

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      filter,
      total: stats.total_records,
      filtered: enrichedRecords.length,
      records: enrichedRecords,
    });
  } catch (error: any) {
    logger.error("Error fetching redial queue records", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/redial-queue/start
 * Start redial queue processor
 */
router.post("/redial-queue/start", (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    redialQueueService.startProcessor();

    logger.info("Redial queue processor started via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Redial queue processor started",
      status: redialQueueService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error starting redial queue processor", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/redial-queue/stop
 * Stop redial queue processor
 */
router.post("/redial-queue/stop", (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    redialQueueService.stopProcessor();

    logger.info("Redial queue processor stopped via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Redial queue processor stopped",
      status: redialQueueService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error stopping redial queue processor", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/redial-queue/process
 * Manually trigger queue processing
 */
router.post("/redial-queue/process", async (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    const result = await redialQueueService.triggerProcessing();

    logger.info("Redial queue processing triggered via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: result.success,
      message: result.message,
      status: redialQueueService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error triggering redial queue processing", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/redial-queue/enable
 * Enable redial queue (auto-start processor)
 */
router.post("/redial-queue/enable", (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    redialQueueService.updateConfig({ enabled: true });

    logger.info("Redial queue enabled via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Redial queue enabled",
      config: redialQueueService.getConfig(),
      status: redialQueueService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error enabling redial queue", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/redial-queue/disable
 * Disable redial queue (stop auto-processing)
 */
router.post("/redial-queue/disable", (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    redialQueueService.updateConfig({ enabled: false });

    logger.info("Redial queue disabled via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Redial queue disabled",
      config: redialQueueService.getConfig(),
      status: redialQueueService.getStatus(),
    });
  } catch (error: any) {
    logger.error("Error disabling redial queue", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/admin/redial-queue/lead/:lead_id
 * Remove a lead from redial queue
 * Query param: phone (required)
 */
router.delete("/redial-queue/lead/:lead_id", async (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    const leadId = req.params["lead_id"];
    const phone = req.query["phone"] as string;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Missing required query parameter: phone",
      });
    }

    const deleted = await redialQueueService.removeLead(leadId, phone);

    logger.info("Lead removed from redial queue via API", {
      lead_id: leadId,
      phone,
      deleted,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: deleted,
      message: deleted ? "Lead removed from queue" : "Lead not found in queue",
    });
  } catch (error: any) {
    logger.error("Error removing lead from redial queue", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/redial-queue/lead/:lead_id/pause
 * Pause redialing for a lead
 * Query param: phone (required)
 */
router.post("/redial-queue/lead/:lead_id/pause", async (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    const leadId = req.params["lead_id"];
    const phone = req.query["phone"] as string;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Missing required query parameter: phone",
      });
    }

    const paused = await redialQueueService.pauseLead(leadId, phone);

    logger.info("Lead paused in redial queue via API", {
      lead_id: leadId,
      phone,
      paused,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: paused,
      message: paused ? "Lead paused" : "Lead not found in queue",
    });
  } catch (error: any) {
    logger.error("Error pausing lead in redial queue", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/redial-queue/lead/:lead_id/resume
 * Resume redialing for a paused lead
 * Query param: phone (required)
 */
router.post("/redial-queue/lead/:lead_id/resume", async (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    const leadId = req.params["lead_id"];
    const phone = req.query["phone"] as string;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Missing required query parameter: phone",
      });
    }

    const resumed = await redialQueueService.resumeLead(leadId, phone);

    logger.info("Lead resumed in redial queue via API", {
      lead_id: leadId,
      phone,
      resumed,
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: resumed,
      message: resumed ? "Lead resumed" : "Lead not found or not paused",
    });
  } catch (error: any) {
    logger.error("Error resuming lead in redial queue", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/redial-queue/cleanup
 * Clean up old files (beyond retention period)
 */
router.post("/redial-queue/cleanup", async (req: Request, res: Response) => {
  try {
    const { redialQueueService } = require("../services/redialQueueService");
    await redialQueueService.cleanupOldFiles();

    logger.info("Redial queue cleanup triggered via API", {
      triggered_by: (req.headers["x-user"] as string) || "unknown",
    });

    res.json({
      success: true,
      message: "Cleanup completed",
    });
  } catch (error: any) {
    logger.error("Error during redial queue cleanup", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// TEST MODE ENDPOINTS - For Development/Testing Only
// ============================================================================

/**
 * GET /api/admin/test/status
 * Check test mode status and current system state
 */
router.get("/test/status", (req: Request, res: Response) => {
  try {
    const testModeEnabled = process.env["TEST_MODE_ENABLED"] === "true";
    const bypassBusinessHours = process.env["TEST_MODE_BYPASS_BUSINESS_HOURS"] === "true";
    const allowSmsReset = process.env["TEST_MODE_ALLOW_SMS_RESET"] === "true";

    const businessHoursActive = schedulerService.isActive();

    // Get SMS tracker info
    const { smsTrackerService } = require("../services/smsTrackerService");
    const smsConfig = smsTrackerService.getConfig();

    res.json({
      success: true,
      test_mode: {
        enabled: testModeEnabled,
        bypass_business_hours: bypassBusinessHours,
        allow_sms_reset: allowSmsReset,
        note: bypassBusinessHours
          ? "Manual test calls bypass business hours. Queue processors still respect business hours."
          : "Test mode allows manual test calls and resetting limits",
      },
      current_time: new Date().toISOString(),
      business_hours: {
        active: businessHoursActive,
        config: schedulerService.getConfig().schedule,
        note: "Queue processors (Convoso, Redial) ALWAYS respect these hours - no test mode bypass",
      },
      sms_tracker: {
        enabled: smsConfig.enabled,
        max_per_day: smsConfig.max_sms_per_day,
      },
      safety: {
        queue_processor_respects_hours: true,
        redial_queue_respects_hours: true,
        sms_scheduler_respects_tcpa: true,
        manual_test_calls_only: bypassBusinessHours,
      },
      warning: testModeEnabled
        ? "TEST_MODE is enabled - disable in production!"
        : null,
    });
  } catch (error: any) {
    logger.error("Error getting test status", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/test/reset-sms-tracker
 * Reset SMS tracker to allow testing SMS again
 */
router.post("/test/reset-sms-tracker", async (req: Request, res: Response) => {
  try {
    // Check if test mode allows SMS reset
    if (process.env["TEST_MODE_ALLOW_SMS_RESET"] !== "true") {
      return res.status(403).json({
        success: false,
        error: "TEST_MODE_ALLOW_SMS_RESET is not enabled",
        note: "Set TEST_MODE_ALLOW_SMS_RESET=true in .env to use this endpoint",
      });
    }

    const { smsTrackerService } = require("../services/smsTrackerService");
    const recordsCleared = await smsTrackerService.resetForTesting();

    logger.warn("TEST MODE: SMS tracker reset via admin API", {
      records_cleared: recordsCleared,
      requested_by: req.ip,
    });

    res.json({
      success: true,
      message: "SMS tracker reset successfully",
      records_cleared: recordsCleared,
      note: "You can now test SMS sending again",
    });
  } catch (error: any) {
    logger.error("Error resetting SMS tracker", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/test/reset-daily-counters
 * Reset daily call attempt counters for redial queue
 */
router.post("/test/reset-daily-counters", async (req: Request, res: Response) => {
  try {
    if (process.env["TEST_MODE_ENABLED"] !== "true") {
      return res.status(403).json({
        success: false,
        error: "Test mode is not enabled",
        note: "Set TEST_MODE_ENABLED=true in .env to use test endpoints",
      });
    }

    const { redialQueueService } = require("../services/redialQueueService");
    const result = await redialQueueService.resetDailyCountersManual();

    logger.warn("TEST MODE: Daily counters reset via admin API", {
      leads_reset: result.leads_reset,
      requested_by: req.ip,
    });

    res.json({
      success: true,
      message: "Daily counters reset successfully",
      ...result,
      note: "Leads that hit daily max can now be called again",
    });
  } catch (error: any) {
    logger.error("Error resetting daily counters", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/test/trigger-call
 * Manually trigger a test call (bypasses business hours in test mode)
 * CRITICAL FIX: Now uses orchestrator flow to enforce rate limiting and active call checks
 */
router.post("/test/trigger-call", async (req: Request, res: Response) => {
  try {
    if (process.env["TEST_MODE_ENABLED"] !== "true") {
      return res.status(403).json({
        success: false,
        error: "Test mode is not enabled",
      });
    }

    const { phone_number, first_name, last_name } = req.body;

    if (!phone_number || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: phone_number, first_name, last_name",
      });
    }

    logger.warn("TEST MODE: Manual test call triggered via admin API", {
      phone: phone_number,
      name: `${first_name} ${last_name}`,
      requested_by: req.ip,
      bypassed_business_hours: process.env["TEST_MODE_BYPASS_BUSINESS_HOURS"] === "true",
    });

    // CRITICAL FIX: Use orchestrator instead of calling blandService directly
    // This enforces rate limiting and active call checks
    const { handleAwhOutbound } = await import("../logic/awhOrchestrator");

    const result = await handleAwhOutbound({
      lead_id: `test_${Date.now()}`,
      phone_number: phone_number,
      first_name: first_name,
      last_name: last_name,
      list_id: "test_mode",
      state: "XX",
      status: "TEST",
    });

    res.json({
      success: true,
      message: "Test call initiated successfully",
      call_id: result.call_id,
      phone: phone_number,
      test_mode: true,
      bypassed_business_hours: process.env["TEST_MODE_BYPASS_BUSINESS_HOURS"] === "true",
      note: "Monitor logs for call progress. Rate limiter enforced: min 2 minutes between calls to same number.",
    });
  } catch (error: any) {
    logger.error("Error triggering test call", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// ANALYTICS ENDPOINTS - Lead Tracking & Reporting
// ============================================================================

/**
 * GET /api/admin/analytics/leads-by-date?date=YYYY-MM-DD
 * Get all leads added on a specific date (when they entered the system)
 * Shows: unique leads, total leads, source (new vs redial), scheduled callbacks
 */
router.get("/analytics/leads-by-date", (req: Request, res: Response) => {
  try {
    const date = req.query["date"] as string;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    // Parse date in EST timezone
    const targetDate = new Date(date + "T00:00:00-05:00");
    const startOfDay = targetDate.getTime();
    const endOfDay = startOfDay + (24 * 60 * 60 * 1000);

    const allRecords = redialQueueService.getAllRecords({});

    // Filter leads created on this date
    const leadsOnDate = allRecords.filter((r: any) => {
      return r.created_at >= startOfDay && r.created_at < endOfDay;
    });

    // Categorize leads
    const newLeads = leadsOnDate.filter((r: any) => r.attempts === 0 || r.attempts === 1);
    const redialLeads = leadsOnDate.filter((r: any) => r.attempts > 1);
    const scheduledCallbacks = leadsOnDate.filter((r: any) => r.scheduled_callback_time);

    // Get unique phone numbers
    const uniquePhones = new Set(leadsOnDate.map((r: any) => r.phone_number));

    res.json({
      success: true,
      date,
      timestamp: new Date().toISOString(),
      summary: {
        total_leads: leadsOnDate.length,
        unique_phones: uniquePhones.size,
        new_leads: newLeads.length,
        redial_leads: redialLeads.length,
        scheduled_callbacks: scheduledCallbacks.length,
      },
      leads: leadsOnDate.map((r: any) => ({
        lead_id: r.lead_id,
        phone_number: r.phone_number,
        name: `${r.first_name} ${r.last_name}`,
        created_at_iso: new Date(r.created_at).toISOString(),
        source: r.attempts <= 1 ? "new_lead" : "redial",
        total_attempts: r.attempts,
        attempts_today: r.attempts_today,
        status: r.status,
        last_outcome: r.last_outcome,
        scheduled_callback: r.scheduled_callback_time
          ? new Date(r.scheduled_callback_time).toISOString()
          : null,
      })),
    });
  } catch (error: any) {
    logger.error("Error fetching leads by date", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/analytics/leads-by-batch?window_minutes=5&limit=10
 * Get leads grouped by batch (time window when they were pushed from Convoso)
 * Shows: batch time, lead count per batch, identifies bulk imports
 */
router.get("/analytics/leads-by-batch", (req: Request, res: Response) => {
  try {
    const windowMinutes = parseInt(req.query["window_minutes"] as string || "5");
    const limit = parseInt(req.query["limit"] as string || "10");

    const batches = redialQueueService.getLeadsByBatch(windowMinutes);
    const recentBatches = limit > 0 ? batches.slice(0, limit) : batches;

    const enrichedBatches = recentBatches.map((batch: any) => ({
      batch_time_iso: batch.batch_time.toISOString(),
      lead_count: batch.count,
      unique_phones: new Set(batch.leads.map((l: any) => l.phone_number)).size,
      leads: batch.leads.map((l: any) => ({
        lead_id: l.lead_id,
        phone_number: l.phone_number,
        name: `${l.first_name} ${l.last_name}`,
        created_at_iso: new Date(l.created_at).toISOString(),
        status: l.status,
      })),
    }));

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      window_minutes: windowMinutes,
      total_batches: batches.length,
      showing: enrichedBatches.length,
      batches: enrichedBatches,
    });
  } catch (error: any) {
    logger.error("Error fetching leads by batch", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/analytics/scheduled-callbacks
 * Get all leads with scheduled callback requests
 * Shows: callback time, lead details, status
 */
router.get("/analytics/scheduled-callbacks", (req: Request, res: Response) => {
  try {
    const allRecords = redialQueueService.getAllRecords({});

    // Filter leads with scheduled callbacks
    const scheduledLeads = allRecords.filter((r: any) => r.scheduled_callback_time);

    // Sort by scheduled time
    scheduledLeads.sort((a: any, b: any) =>
      a.scheduled_callback_time - b.scheduled_callback_time
    );

    const now = Date.now();

    const enrichedLeads = scheduledLeads.map((r: any) => {
      const callbackTime = r.scheduled_callback_time;
      const isPast = callbackTime < now;
      const minutesUntil = Math.floor((callbackTime - now) / 60000);

      return {
        lead_id: r.lead_id,
        phone_number: r.phone_number,
        name: `${r.first_name} ${r.last_name}`,
        scheduled_callback_iso: new Date(callbackTime).toISOString(),
        status: r.status,
        is_past_due: isPast,
        minutes_until_callback: isPast ? 0 : minutesUntil,
        last_outcome: r.last_outcome,
        attempts: r.attempts,
        created_at_iso: new Date(r.created_at).toISOString(),
      };
    });

    // Categorize
    const upcoming = enrichedLeads.filter(l => !l.is_past_due);
    const pastDue = enrichedLeads.filter(l => l.is_past_due);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total_scheduled: scheduledLeads.length,
        upcoming: upcoming.length,
        past_due: pastDue.length,
      },
      scheduled_callbacks: enrichedLeads,
    });
  } catch (error: any) {
    logger.error("Error fetching scheduled callbacks", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/analytics/lead-source?phone=5551234567
 * Track if a specific lead was new or came from redial queue
 * Shows: creation date, all call history, source determination
 */
router.get("/analytics/lead-source", (req: Request, res: Response) => {
  try {
    const phone = req.query["phone"] as string;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter: phone",
      });
    }

    // Find lead in redial queue
    const allRecords = redialQueueService.getAllRecords({});
    const leadRecord = allRecords.find((r: any) =>
      r.phone_number.replace(/\D/g, "").includes(phone.replace(/\D/g, ""))
    );

    if (!leadRecord) {
      return res.status(404).json({
        success: false,
        error: "Lead not found in redial queue",
        phone,
      });
    }

    // Determine source
    const isNewLead = leadRecord.attempts <= 1;
    const daysSinceCreation = Math.floor((Date.now() - leadRecord.created_at) / (24 * 60 * 60 * 1000));

    res.json({
      success: true,
      lead_id: leadRecord.lead_id,
      phone_number: leadRecord.phone_number,
      name: `${leadRecord.first_name} ${leadRecord.last_name}`,
      source: isNewLead ? "new_lead" : "redial_queue",
      created_at_iso: new Date(leadRecord.created_at).toISOString(),
      days_since_creation: daysSinceCreation,
      call_statistics: {
        total_attempts: leadRecord.attempts,
        attempts_today: leadRecord.attempts_today,
        last_outcome: leadRecord.last_outcome,
        outcomes_history: leadRecord.outcomes,
      },
      call_history: leadRecord.call_history?.map((call: any) => ({
        call_id: call.call_id,
        from_number: call.from_number,
        outcome: call.outcome,
        timestamp_iso: new Date(call.timestamp).toISOString(),
      })) || [],
      status: leadRecord.status,
      next_redial_iso: leadRecord.next_redial_timestamp
        ? new Date(leadRecord.next_redial_timestamp).toISOString()
        : null,
      scheduled_callback_iso: leadRecord.scheduled_callback_time
        ? new Date(leadRecord.scheduled_callback_time).toISOString()
        : null,
    });
  } catch (error: any) {
    logger.error("Error fetching lead source", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/analytics/daily-summary?date=YYYY-MM-DD
 * Comprehensive daily summary: new leads, redials, outcomes, scheduled callbacks
 * Perfect for daily reporting and tracking trends
 */
router.get("/analytics/daily-summary", (req: Request, res: Response) => {
  try {
    const dateParam = req.query["date"] as string;
    const date = dateParam || new Date().toISOString().split("T")[0]!;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    // Parse date in EST timezone
    const targetDate = new Date(date + "T00:00:00-05:00");
    const startOfDay = targetDate.getTime();
    const endOfDay = startOfDay + (24 * 60 * 60 * 1000);

    const allRecords = redialQueueService.getAllRecords({});

    // Leads added on this date
    const leadsOnDate = allRecords.filter((r: any) =>
      r.created_at >= startOfDay && r.created_at < endOfDay
    );

    // Categorize
    const newLeads = leadsOnDate.filter((r: any) => r.attempts <= 1);
    const redialLeads = leadsOnDate.filter((r: any) => r.attempts > 1);

    // Get outcome breakdown
    const outcomeBreakdown: Record<string, number> = {};
    leadsOnDate.forEach((r: any) => {
      if (r.last_outcome) {
        outcomeBreakdown[r.last_outcome] = (outcomeBreakdown[r.last_outcome] || 0) + 1;
      }
    });

    // Status breakdown
    const statusBreakdown: Record<string, number> = {};
    leadsOnDate.forEach((r: any) => {
      statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;
    });

    // Scheduled callbacks
    const scheduledCallbacks = leadsOnDate.filter((r: any) => r.scheduled_callback_time);

    // Pool number usage
    const poolUsage: Record<string, number> = {};
    leadsOnDate.forEach((r: any) => {
      r.call_history?.forEach((call: any) => {
        if (call.from_number) {
          poolUsage[call.from_number] = (poolUsage[call.from_number] || 0) + 1;
        }
      });
    });

    res.json({
      success: true,
      date,
      timestamp: new Date().toISOString(),
      summary: {
        total_leads_added: leadsOnDate.length,
        unique_phones: new Set(leadsOnDate.map((r: any) => r.phone_number)).size,
        new_leads: newLeads.length,
        redial_leads: redialLeads.length,
        scheduled_callbacks: scheduledCallbacks.length,
      },
      outcomes: outcomeBreakdown,
      statuses: statusBreakdown,
      pool_number_usage: poolUsage,
      top_batches: redialQueueService.getRecentBatches(5, 5).map((batch: any) => ({
        batch_time_iso: batch.batch_time.toISOString(),
        lead_count: batch.count,
      })),
    });
  } catch (error: any) {
    logger.error("Error generating daily summary", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// Bad Numbers API Endpoints
// Manage and query permanently failed phone numbers
// ============================================================================

/**
 * GET /api/admin/bad-numbers/stats
 * Get statistics about bad numbers
 */
router.get("/bad-numbers/stats", (req: Request, res: Response) => {
  try {
    const stats = badNumbersService.getStats();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats,
    });
  } catch (error: any) {
    logger.error("Error fetching bad numbers stats", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/bad-numbers
 * Get all bad numbers with optional filtering and pagination
 * Query params:
 *   - limit: number (default 100)
 *   - offset: number (default 0)
 *   - sortBy: "first_failed_at" | "last_failed_at" | "failure_count"
 *   - sortOrder: "asc" | "desc"
 *   - errorContains: string (filter by error message)
 *   - addedAfter: timestamp (filter by date)
 *   - addedBefore: timestamp (filter by date)
 */
router.get("/bad-numbers", (req: Request, res: Response) => {
  try {
    const options = {
      limit: parseInt(req.query["limit"] as string) || 100,
      offset: parseInt(req.query["offset"] as string) || 0,
      sortBy: (req.query["sortBy"] as any) || "last_failed_at",
      sortOrder: (req.query["sortOrder"] as any) || "desc",
      errorContains: req.query["errorContains"] as string,
      addedAfter: req.query["addedAfter"]
        ? parseInt(req.query["addedAfter"] as string)
        : undefined,
      addedBefore: req.query["addedBefore"]
        ? parseInt(req.query["addedBefore"] as string)
        : undefined,
    };

    const result = badNumbersService.getAllBadNumbers(options);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error: any) {
    logger.error("Error fetching bad numbers", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/bad-numbers/check/:phoneNumber
 * Check if a specific phone number is in the bad numbers list
 */
router.get("/bad-numbers/check/:phoneNumber", (req: Request, res: Response) => {
  try {
    const phoneNumber = req.params["phoneNumber"] as string;
    const record = badNumbersService.getBadNumberRecord(phoneNumber);

    res.json({
      success: true,
      phone_number: phoneNumber,
      is_bad: record !== null,
      record: record,
    });
  } catch (error: any) {
    logger.error("Error checking bad number", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/bad-numbers/check-bulk
 * Check multiple phone numbers at once
 * Body: { phone_numbers: string[] }
 */
router.post("/bad-numbers/check-bulk", (req: Request, res: Response) => {
  try {
    const { phone_numbers } = req.body;

    if (!Array.isArray(phone_numbers)) {
      return res.status(400).json({
        success: false,
        error: "phone_numbers must be an array",
      });
    }

    const result = badNumbersService.checkBulk(phone_numbers);

    res.json({
      success: true,
      total_checked: phone_numbers.length,
      bad_count: result.bad.length,
      good_count: result.good.length,
      bad: result.bad,
      good: result.good,
    });
  } catch (error: any) {
    logger.error("Error checking bulk bad numbers", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/bad-numbers
 * Manually add a phone number to the bad numbers list
 * Body: { phone_number, lead_id, error_message, notes? }
 */
router.post("/bad-numbers", (req: Request, res: Response) => {
  try {
    const { phone_number, lead_id, error_message, notes } = req.body;

    if (!phone_number || !lead_id || !error_message) {
      return res.status(400).json({
        success: false,
        error: "phone_number, lead_id, and error_message are required",
      });
    }

    badNumbersService.addBadNumber(
      phone_number,
      lead_id,
      error_message,
      `manual_${Date.now()}`,
      undefined,
      undefined,
      "manual"
    );

    if (notes) {
      badNumbersService.addNote(phone_number, notes);
    }

    res.json({
      success: true,
      message: "Phone number added to bad numbers list",
      phone_number,
    });
  } catch (error: any) {
    logger.error("Error adding bad number", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/bad-numbers/:phoneNumber
 * Remove a phone number from the bad numbers list (if verified as good)
 */
router.delete("/bad-numbers/:phoneNumber", (req: Request, res: Response) => {
  try {
    const phoneNumber = req.params["phoneNumber"] as string;
    const reason = req.query["reason"] as string;

    const removed = badNumbersService.removeBadNumber(phoneNumber, reason);

    if (removed) {
      res.json({
        success: true,
        message: "Phone number removed from bad numbers list",
        phone_number: phoneNumber,
      });
    } else {
      res.status(404).json({
        success: false,
        error: "Phone number not found in bad numbers list",
      });
    }
  } catch (error: any) {
    logger.error("Error removing bad number", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/admin/bad-numbers/:phoneNumber/notes
 * Add or update notes for a bad number record
 * Body: { notes: string }
 */
router.patch("/bad-numbers/:phoneNumber/notes", (req: Request, res: Response) => {
  try {
    const phoneNumber = req.params["phoneNumber"] as string;
    const { notes } = req.body;

    if (!notes) {
      return res.status(400).json({
        success: false,
        error: "notes field is required",
      });
    }

    const updated = badNumbersService.addNote(phoneNumber, notes);

    if (updated) {
      res.json({
        success: true,
        message: "Notes updated",
        phone_number: phoneNumber,
      });
    } else {
      res.status(404).json({
        success: false,
        error: "Phone number not found in bad numbers list",
      });
    }
  } catch (error: any) {
    logger.error("Error updating bad number notes", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/bad-numbers/export
 * Export all bad numbers as CSV
 */
router.get("/bad-numbers/export", (req: Request, res: Response) => {
  try {
    const csv = badNumbersService.exportAsCSV();

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="bad-numbers-${new Date().toISOString().split("T")[0]}.csv"`
    );
    res.send(csv);
  } catch (error: any) {
    logger.error("Error exporting bad numbers", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
