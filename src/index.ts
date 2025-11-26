import express, { Request, Response, NextFunction } from "express";
import { config, validateConfig, printConfig } from "./config";
import { logger } from "./utils/logger";
import awhWebhookRouter from "./routes/awhWebhook";

validateConfig();

const app = express();

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

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "awh-outbound-orchestrator",
    timestamp: new Date().toISOString(),
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

const PORT = config.port;

app.listen(PORT, () => {
  console.log("");
  console.log(" ============================================");
  console.log("  AWH Outbound Orchestrator");
  console.log(" ============================================");
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(" ============================================");
  console.log("");

  printConfig();

  console.log("");
  console.log(" Available endpoints:");
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/webhooks/awhealth-outbound`);
  console.log("");
  console.log(" Ready to receive webhooks!");
  console.log("");
});

export default app;
