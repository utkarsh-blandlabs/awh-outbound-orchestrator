// ============================================================================
// Main Express Application
// ============================================================================

import express, { Request, Response, NextFunction } from "express";
import { config, validateConfig, printConfig } from "./config";
import { logger } from "./utils/logger";
import awhWebhookRouter from "./routes/awhWebhook";

// Validate environment variables
validateConfig();

// Create Express app
const app = express();

// ============================================================================
// Middleware
// ============================================================================

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

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

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "awh-outbound-orchestrator",
    timestamp: new Date().toISOString(),
    architecture: "async",
  });
});

// Webhook routes
app.use("/webhooks", awhWebhookRouter);

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
  console.log("🚀 ============================================");
  console.log("🚀  AWH Outbound Orchestrator");
  console.log("🚀 ============================================");
  console.log(`🚀  Server running on port ${PORT}`);
  console.log(`🚀  Environment: ${config.nodeEnv}`);
  console.log("🚀 ============================================");
  console.log("");

  printConfig();

  console.log("");
  console.log("📡 Available endpoints:");
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/webhooks/awhealth-outbound`);
  console.log("");
  console.log("⚡ Architecture: ASYNC (background processing)");
  console.log("   - Webhooks return immediately (< 1s)");
  console.log("   - Call processing happens in background");
  console.log("   - Results updated to Convoso when ready");
  console.log("");
  console.log("✅ Ready to receive webhooks!");
  console.log("");
});

export default app;
