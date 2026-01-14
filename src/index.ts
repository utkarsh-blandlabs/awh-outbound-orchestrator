// ============================================================================
// Main Express Application
// ============================================================================

import express, { Request, Response, NextFunction } from "express";
import { config, validateConfig, printConfig } from "./config";
import { logger } from "./utils/logger";
import awhWebhookRouter from "./routes/awhWebhook";
import blandWebhookRouter from "./routes/blandWebhook";
import callbackWebhookRouter from "./routes/callbackWebhook";
import smsWebhookRouter from "./routes/smsWebhook";
import pathwayWebhookRouter from "./routes/pathwayWebhook";
import adminRouter from "./routes/adminRoutes";
import blocklistRouter from "./routes/blocklistRoutes";
import webhookLogRouter from "./routes/webhookLogRoutes";
import reconciliationRouter from "./routes/reconciliationRoutes";
import dailyReportRouter from "./routes/dailyReportRoutes";
import { versionService } from "./services/versionService";

// Import services (they auto-start in their constructors)
import "./services/queueProcessorService";
import "./services/smsSchedulerService";

// Validate environment variables
validateConfig();

// Create Express app
const app = express();

// ============================================================================
// Middleware
// ============================================================================

// Parse JSON bodies with increased size limit for Bland webhooks
// Bland sends large payloads with full transcripts, recordings, etc.
app.use(express.json({ limit: "10mb" }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info("HTTP Request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
    });
  });

  next();
});

// ============================================================================
// Routes
// ============================================================================

// Memory alert thresholds (in MB)
const MEMORY_THRESHOLDS = {
  rss: { warning: 400, critical: 500 },         // Total memory
  heapUsed: { warning: 250, critical: 300 },    // JS heap
  external: { warning: 80, critical: 100 },     // C++ objects
};

/**
 * Get memory usage with alert status
 */
function getMemoryStatus() {
  const mem = process.memoryUsage();
  const rssM = Math.round(mem.rss / 1024 / 1024);
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const externalMB = Math.round(mem.external / 1024 / 1024);

  // Determine alert status
  let status: "healthy" | "warning" | "critical" = "healthy";
  const alerts: string[] = [];

  if (rssM >= MEMORY_THRESHOLDS.rss.critical) {
    status = "critical";
    alerts.push(`RSS memory critical: ${rssM}MB >= ${MEMORY_THRESHOLDS.rss.critical}MB`);
  } else if (rssM >= MEMORY_THRESHOLDS.rss.warning) {
    status = status === "healthy" ? "warning" : status;
    alerts.push(`RSS memory warning: ${rssM}MB >= ${MEMORY_THRESHOLDS.rss.warning}MB`);
  }

  if (heapUsedMB >= MEMORY_THRESHOLDS.heapUsed.critical) {
    status = "critical";
    alerts.push(`Heap memory critical: ${heapUsedMB}MB >= ${MEMORY_THRESHOLDS.heapUsed.critical}MB`);
  } else if (heapUsedMB >= MEMORY_THRESHOLDS.heapUsed.warning) {
    status = status === "healthy" ? "warning" : status;
    alerts.push(`Heap memory warning: ${heapUsedMB}MB >= ${MEMORY_THRESHOLDS.heapUsed.warning}MB`);
  }

  if (externalMB >= MEMORY_THRESHOLDS.external.critical) {
    status = "critical";
    alerts.push(`External memory critical: ${externalMB}MB >= ${MEMORY_THRESHOLDS.external.critical}MB`);
  } else if (externalMB >= MEMORY_THRESHOLDS.external.warning) {
    status = status === "healthy" ? "warning" : status;
    alerts.push(`External memory warning: ${externalMB}MB >= ${MEMORY_THRESHOLDS.external.warning}MB`);
  }

  return {
    status,
    memory: {
      rss: `${rssM}MB`,
      heapUsed: `${heapUsedMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      external: `${externalMB}MB`,
      heapUsedPercent: Math.round((heapUsedMB / heapTotalMB) * 100) + "%",
    },
    thresholds: MEMORY_THRESHOLDS,
    alerts: alerts.length > 0 ? alerts : undefined,
  };
}

// Health check with memory monitoring
app.get("/health", (req: Request, res: Response) => {
  const versionInfo = versionService.getVersionInfo();
  const memoryStatus = getMemoryStatus();

  // Log memory warnings/criticals
  if (memoryStatus.alerts) {
    logger.warn("Memory threshold exceeded", {
      status: memoryStatus.status,
      alerts: memoryStatus.alerts,
      memory: memoryStatus.memory,
    });
  }

  res.status(200).json({
    status: "ok",
    service: "awh-outbound-orchestrator",
    version: versionInfo.version,
    deployedAt: versionInfo.deployedAt,
    environment: versionInfo.environment,
    uptime: versionInfo.uptime,
    timestamp: new Date().toISOString(),
    architecture: "async",
    memory: memoryStatus,
  });
});

// Webhook routes
app.use("/webhooks", awhWebhookRouter);
app.use("/webhooks", blandWebhookRouter);
app.use("/webhooks", callbackWebhookRouter);
app.use("/webhooks", smsWebhookRouter);
app.use("/webhooks", pathwayWebhookRouter);

// Admin API routes (for Retool dashboard)
app.use("/api/admin", adminRouter);
app.use("/api/admin/blocklist", blocklistRouter);
app.use("/api/admin/webhook-logs", webhookLogRouter);
app.use("/api/admin/reconciliation", reconciliationRouter);
app.use("/api/admin/daily-report", dailyReportRouter);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
  });
});

// ============================================================================
// Start Server
// ============================================================================

const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log("");
  console.log("===========================================");
  console.log("  AWH Outbound Orchestrator");
  console.log("===========================================");
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log("===========================================");
  console.log("");

  printConfig();

  console.log("");
  console.log("Available endpoints:");
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  POST http://localhost:${PORT}/webhooks/awhealth-outbound`);
  console.log(`  POST http://localhost:${PORT}/webhooks/bland-callback`);
  console.log(`  POST http://localhost:${PORT}/webhooks/call-back`);
  console.log(`  POST http://localhost:${PORT}/webhooks/sms-reply`);
  console.log(`  POST http://localhost:${PORT}/webhooks/pathway/update-zip`);
  console.log(`  POST http://localhost:${PORT}/webhooks/pathway/update-lead-data`);
  console.log("");
  console.log("Admin API endpoints:");
  console.log(`  GET  http://localhost:${PORT}/api/admin/calls/active`);
  console.log(`  GET  http://localhost:${PORT}/api/admin/calls/stats`);
  console.log(`  GET  http://localhost:${PORT}/api/admin/calls/:call_id`);
  console.log(`  GET  http://localhost:${PORT}/api/admin/health`);
  console.log(`  POST http://localhost:${PORT}/api/admin/cache/clear`);
  console.log("");
  console.log("Ready to receive webhooks");
  console.log("");
});

// ============================================================================
// Graceful Shutdown - Prevent Memory Leaks
// ============================================================================

/**
 * Cleanup all resources and timers on shutdown
 * Prevents memory leaks from uncleared intervals/timers
 */
function gracefulShutdown(signal: string): void {
  logger.info(`${signal} received, starting graceful shutdown...`);

  // Close server to stop accepting new connections
  server.close(() => {
    logger.info("HTTP server closed");
  });

  // Stop all background services and timers
  try {
    // Import services for cleanup
    const { redialQueueService } = require("./services/redialQueueService");
    const { answeringMachineTrackerService } = require("./services/answeringMachineTrackerService");

    // Stop redial queue processor and timers
    redialQueueService.stopProcessor();
    logger.info("Redial queue processor stopped");

    // Stop AM tracker flush scheduler
    answeringMachineTrackerService.stopFlushScheduler();
    logger.info("AM tracker flush scheduler stopped");

    logger.info("All services stopped successfully");
  } catch (error: any) {
    logger.error("Error during service cleanup", { error: error.message });
  }

  // Give process 5 seconds to cleanup, then force exit
  setTimeout(() => {
    logger.warn("Forcing shutdown after timeout");
    process.exit(0);
  }, 5000);
}

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors (but don't exit immediately)
process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught Exception", {
    error: error.message,
    stack: error.stack,
  });
  // Don't exit - let process manager handle restart
});

process.on("unhandledRejection", (reason: any) => {
  logger.error("Unhandled Promise Rejection", {
    reason: reason?.message || reason,
  });
  // Don't exit - let process manager handle restart
});

export default app;
