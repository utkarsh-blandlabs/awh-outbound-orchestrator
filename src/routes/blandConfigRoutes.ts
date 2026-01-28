/**
 * Bland AI Configuration Routes
 *
 * Endpoints for managing Bland AI settings (previously read-only from env vars)
 */

import express, { Request, Response } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../utils/logger";
import { config } from "../config";

const router = express.Router();

// Path to .env file
const ENV_FILE_PATH = join(process.cwd(), ".env");

/**
 * Helper: Parse .env file into key-value pairs
 */
function parseEnvFile(content: string): Map<string, string> {
  const envVars = new Map<string, string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    // Parse KEY=VALUE
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex > 0) {
      const key = trimmed.substring(0, equalsIndex).trim();
      const value = trimmed.substring(equalsIndex + 1).trim();
      envVars.set(key, value);
    }
  }

  return envVars;
}

/**
 * Helper: Serialize env vars back to .env format
 */
function serializeEnvFile(envVars: Map<string, string>): string {
  const lines: string[] = [
    "# AWH Outbound Orchestrator Configuration",
    "# Updated via Admin UI",
    ""
  ];

  // Group variables by prefix for better readability
  const groups = {
    BLAND_: [] as string[],
    CONVOSO_: [] as string[],
    RATE_LIMITER_: [] as string[],
    RETRY_: [] as string[],
    CACHE_: [] as string[],
    QUEUE_PROCESSOR_: [] as string[],
    ANSWERING_MACHINE_: [] as string[],
    OTHER: [] as string[]
  };

  for (const [key, value] of envVars.entries()) {
    const line = `${key}=${value}`;

    if (key.startsWith("BLAND_")) {
      groups.BLAND_.push(line);
    } else if (key.startsWith("CONVOSO_")) {
      groups.CONVOSO_.push(line);
    } else if (key.startsWith("RATE_LIMITER_")) {
      groups.RATE_LIMITER_.push(line);
    } else if (key.startsWith("RETRY_")) {
      groups.RETRY_.push(line);
    } else if (key.startsWith("CACHE_")) {
      groups.CACHE_.push(line);
    } else if (key.startsWith("QUEUE_PROCESSOR_")) {
      groups.QUEUE_PROCESSOR_.push(line);
    } else if (key.startsWith("ANSWERING_MACHINE_")) {
      groups.ANSWERING_MACHINE_.push(line);
    } else {
      groups.OTHER.push(line);
    }
  }

  // Add grouped sections
  if (groups.OTHER.length > 0) {
    lines.push("# Server Config");
    lines.push(...groups.OTHER);
    lines.push("");
  }

  if (groups.BLAND_.length > 0) {
    lines.push("# Bland AI Config");
    lines.push(...groups.BLAND_);
    lines.push("");
  }

  if (groups.CONVOSO_.length > 0) {
    lines.push("# Convoso Config");
    lines.push(...groups.CONVOSO_);
    lines.push("");
  }

  if (groups.RATE_LIMITER_.length > 0) {
    lines.push("# Rate Limiter Config");
    lines.push(...groups.RATE_LIMITER_);
    lines.push("");
  }

  if (groups.RETRY_.length > 0) {
    lines.push("# Retry Config");
    lines.push(...groups.RETRY_);
    lines.push("");
  }

  if (groups.CACHE_.length > 0) {
    lines.push("# Cache Config");
    lines.push(...groups.CACHE_);
    lines.push("");
  }

  if (groups.QUEUE_PROCESSOR_.length > 0) {
    lines.push("# Queue Processor Config");
    lines.push(...groups.QUEUE_PROCESSOR_);
    lines.push("");
  }

  if (groups.ANSWERING_MACHINE_.length > 0) {
    lines.push("# Answering Machine Config");
    lines.push(...groups.ANSWERING_MACHINE_);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Helper: Update config object in memory
 */
function updateConfigInMemory(updates: Record<string, any>): void {
  // Update config.bland object with new values
  Object.assign(config.bland, updates);
  logger.info("Config updated in memory", { updates });
}

/**
 * GET /api/admin/bland-config
 * Get current Bland AI configuration
 */
router.get("/", (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      config: {
        baseUrl: config.bland.baseUrl,
        pathwayId: config.bland.pathwayId,
        startNodeId: config.bland.startNodeId,
        voiceId: config.bland.voiceId,
        from: config.bland.from,
        transferPhoneNumber: config.bland.transferPhoneNumber,
        maxDuration: config.bland.maxDuration,
        answeringMachineDetection: config.bland.answeringMachineDetection,
        waitForGreeting: config.bland.waitForGreeting,
        blockInterruptions: config.bland.blockInterruptions,
        record: config.bland.record,
        voicemailAction: config.bland.voicemailAction,
        voicemailMessage: config.bland.voicemailMessage,
        smsEnabled: config.bland.smsEnabled,
        smsFrom: config.bland.smsFrom,
        smsMessage: config.bland.smsMessage,
        webhookUrl: config.bland.webhookUrl,
        taskTemplate: config.bland.taskTemplate,
        firstSentenceTemplate: config.bland.firstSentenceTemplate,
        fromPool: config.bland.fromPool,
        usePool: config.bland.usePool,
        poolStrategy: config.bland.poolStrategy,
      },
    });
  } catch (error: any) {
    logger.error("Error getting Bland config", { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/bland-config
 * Update Bland AI configuration
 *
 * Body: {
 *   updates: { key: value, ... }
 * }
 */
router.put("/", async (req: Request, res: Response) => {
  try {
    const { updates } = req.body;

    if (!updates || typeof updates !== "object") {
      return res.status(400).json({
        success: false,
        error: "updates object is required",
      });
    }

    logger.info("Bland config update request", {
      updates,
      user: req.headers["x-user"] || "unknown",
    });

    // Validate .env file exists
    if (!existsSync(ENV_FILE_PATH)) {
      logger.warn(".env file not found, will create new one");
    }

    // Read current .env file
    const envContent = existsSync(ENV_FILE_PATH)
      ? readFileSync(ENV_FILE_PATH, "utf-8")
      : "";
    const envVars = parseEnvFile(envContent);

    // Map frontend keys to environment variable names
    const keyMapping: Record<string, string> = {
      baseUrl: "BLAND_BASE_URL",
      pathwayId: "BLAND_PATHWAY_ID",
      startNodeId: "BLAND_START_NODE_ID",
      voiceId: "BLAND_VOICE_ID",
      from: "BLAND_FROM",
      transferPhoneNumber: "BLAND_TRANSFER_PHONE_NUMBER",
      maxDuration: "BLAND_MAX_DURATION",
      answeringMachineDetection: "BLAND_ANSWERING_MACHINE_DETECTION",
      waitForGreeting: "BLAND_WAIT_FOR_GREETING",
      blockInterruptions: "BLAND_BLOCK_INTERRUPTIONS",
      record: "BLAND_RECORD",
      voicemailAction: "BLAND_VOICEMAIL_ACTION",
      voicemailMessage: "BLAND_VOICEMAIL_MESSAGE",
      smsEnabled: "BLAND_SMS_ENABLED",
      smsFrom: "BLAND_SMS_FROM",
      smsMessage: "BLAND_SMS_MESSAGE",
      webhookUrl: "BLAND_WEBHOOK_URL",
      taskTemplate: "BLAND_TASK_TEMPLATE",
      firstSentenceTemplate: "BLAND_FIRST_SENTENCE_TEMPLATE",
      usePool: "BLAND_USE_POOL",
      poolStrategy: "BLAND_POOL_STRATEGY",
    };

    // Update env vars
    const updatedKeys: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      const envKey = keyMapping[key];
      if (!envKey) {
        logger.warn(`Unknown config key: ${key}`);
        continue;
      }

      // Convert value to string for .env file
      let envValue = String(value);
      if (typeof value === "boolean") {
        envValue = value ? "true" : "false";
      }

      envVars.set(envKey, envValue);
      updatedKeys.push(envKey);
    }

    // Write back to .env file
    const newEnvContent = serializeEnvFile(envVars);
    writeFileSync(ENV_FILE_PATH, newEnvContent, "utf-8");

    logger.info("Updated .env file", { updatedKeys });

    // Update config in memory
    updateConfigInMemory(updates);

    return res.json({
      success: true,
      message: "Bland AI configuration updated successfully",
      updated_keys: updatedKeys,
      note: "Changes applied in memory. A restart may be required for some changes to take full effect.",
    });
  } catch (error: any) {
    logger.error("Error updating Bland config", { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/bland-config/reload
 * Reload configuration from .env file
 */
router.post("/reload", (req: Request, res: Response) => {
  try {
    logger.info("Config reload requested", {
      user: req.headers["x-user"] || "unknown",
    });

    // Read .env file
    if (!existsSync(ENV_FILE_PATH)) {
      return res.status(404).json({
        success: false,
        error: ".env file not found",
      });
    }

    const envContent = readFileSync(ENV_FILE_PATH, "utf-8");
    const envVars = parseEnvFile(envContent);

    // Update process.env
    for (const [key, value] of envVars.entries()) {
      process.env[key] = value;
    }

    // Reload config module by re-reading env vars
    const reloadedConfig = {
      baseUrl: process.env["BLAND_BASE_URL"] || config.bland.baseUrl,
      pathwayId: process.env["BLAND_PATHWAY_ID"] || config.bland.pathwayId,
      startNodeId: process.env["BLAND_START_NODE_ID"] || config.bland.startNodeId,
      voiceId: process.env["BLAND_VOICE_ID"] || config.bland.voiceId,
      from: process.env["BLAND_FROM"] || config.bland.from,
      transferPhoneNumber: process.env["BLAND_TRANSFER_PHONE_NUMBER"] || config.bland.transferPhoneNumber,
      maxDuration: parseInt(process.env["BLAND_MAX_DURATION"] || String(config.bland.maxDuration)),
      answeringMachineDetection: process.env["BLAND_ANSWERING_MACHINE_DETECTION"] === "true",
      waitForGreeting: process.env["BLAND_WAIT_FOR_GREETING"] === "true",
      blockInterruptions: process.env["BLAND_BLOCK_INTERRUPTIONS"] === "true",
      record: process.env["BLAND_RECORD"] === "true",
      voicemailAction: process.env["BLAND_VOICEMAIL_ACTION"] || config.bland.voicemailAction,
      voicemailMessage: process.env["BLAND_VOICEMAIL_MESSAGE"] || config.bland.voicemailMessage,
      smsEnabled: process.env["BLAND_SMS_ENABLED"] === "true",
      smsFrom: process.env["BLAND_SMS_FROM"] || config.bland.smsFrom,
      smsMessage: process.env["BLAND_SMS_MESSAGE"] || config.bland.smsMessage,
      webhookUrl: process.env["BLAND_WEBHOOK_URL"] || config.bland.webhookUrl,
      taskTemplate: process.env["BLAND_TASK_TEMPLATE"] || config.bland.taskTemplate,
      firstSentenceTemplate: process.env["BLAND_FIRST_SENTENCE_TEMPLATE"] || config.bland.firstSentenceTemplate,
      usePool: process.env["BLAND_USE_POOL"] === "true",
      poolStrategy: (process.env["BLAND_POOL_STRATEGY"] || config.bland.poolStrategy) as "round-robin" | "random",
    };

    Object.assign(config.bland, reloadedConfig);

    logger.info("Config reloaded successfully");

    return res.json({
      success: true,
      message: "Configuration reloaded from .env file",
    });
  } catch (error: any) {
    logger.error("Error reloading config", { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
