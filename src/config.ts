// ============================================================================
// Configuration Module
// ============================================================================

import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

/**
 * Load and validate environment variables
 */
export const config = {
  // Server config
  port: process.env["PORT"] || 3000,
  nodeEnv: process.env["NODE_ENV"] || "development",

  // Bland API config
  bland: {
    apiKey: process.env["BLAND_API_KEY"] || "",
    baseUrl: process.env["BLAND_BASE_URL"] || "https://api.bland.ai",
    pathwayId: process.env["BLAND_PATHWAY_ID"] || "",
    startNodeId: process.env["BLAND_START_NODE_ID"] || "",

    // Phone numbers
    from: process.env["BLAND_FROM"] || "",
    transferPhoneNumber: process.env["BLAND_TRANSFER_PHONE_NUMBER"] || "",

    // Voice and behavior settings
    voiceId: process.env["BLAND_VOICE_ID"] || "",
    maxDuration: parseInt(process.env["BLAND_MAX_DURATION"] || "30"),

    // Call behavior
    answeringMachineDetection:
      process.env["BLAND_ANSWERING_MACHINE_DETECTION"] === "true",
    waitForGreeting: process.env["BLAND_WAIT_FOR_GREETING"] === "true",
    blockInterruptions: process.env["BLAND_BLOCK_INTERRUPTIONS"] === "true",
    record: process.env["BLAND_RECORD"] === "true",

    // Voicemail settings
    voicemailMessage: process.env["BLAND_VOICEMAIL_MESSAGE"] || "",
    voicemailAction: process.env["BLAND_VOICEMAIL_ACTION"] || "leave_message",
    answeredByEnabled: process.env["BLAND_ANSWERED_BY_ENABLED"] === "true",
    sensitiveVoicemailDetection:
      process.env["BLAND_SENSITIVE_VOICEMAIL_DETECTION"] === "true",

    // Dynamic templates
    taskTemplate: process.env["BLAND_TASK_TEMPLATE"] || "",
    firstSentenceTemplate: process.env["BLAND_FIRST_SENTENCE_TEMPLATE"] || "",

    // Webhook configuration
    webhookUrl: process.env["BLAND_WEBHOOK_URL"] || "",

    // Polling config for transcript (DEPRECATED - only used as fallback)
    transcriptPollInterval: parseInt(
      process.env["BLAND_POLL_INTERVAL"] || "5000"
    ), // 5 seconds
    transcriptPollMaxAttempts: parseInt(
      process.env["BLAND_POLL_MAX_ATTEMPTS"] || "60"
    ), // 5 minutes max
  },

  // Convoso API config
  convoso: {
    authToken: process.env["CONVOSO_AUTH_TOKEN"] || "",
    baseUrl: process.env["CONVOSO_BASE_URL"] || "https://api.convoso.com",
    // Polling config for autonomous dialing (Dec 22nd feature)
    polling: {
      enabled: process.env["CONVOSO_POLLING_ENABLED"] === "true",
      intervalMinutes: parseInt(
        process.env["CONVOSO_POLLING_INTERVAL_MINUTES"] || "30"
      ),
      batchSize: parseInt(process.env["CONVOSO_POLLING_BATCH_SIZE"] || "25"),
      maxCallAttemptsPerDay: parseInt(
        process.env["CONVOSO_POLLING_MAX_ATTEMPTS"] || "4"
      ),
      // API endpoint for fetching leads (provided by Jeff)
      leadsEndpoint: process.env["CONVOSO_LEADS_ENDPOINT"] || "",
    },
  },

  // Retry config
  retry: {
    maxAttempts: parseInt(process.env["RETRY_MAX_ATTEMPTS"] || "3"),
    initialDelay: parseInt(process.env["RETRY_INITIAL_DELAY"] || "1000"), // 1 second
    maxDelay: parseInt(process.env["RETRY_MAX_DELAY"] || "10000"), // 10 seconds
  },

  // Rate limiter config
  rateLimiter: {
    enabled: process.env["RATE_LIMITER_ENABLED"] !== "false", // Enabled by default
    maxCallsPerSecond: parseFloat(
      process.env["RATE_LIMITER_MAX_CALLS_PER_SECOND"] || "5"
    ),
    sameNumberIntervalMs: parseInt(
      process.env["RATE_LIMITER_SAME_NUMBER_INTERVAL_MS"] || "10000"
    ),
  },

  // Cache retention config
  cache: {
    // How long to keep completed/failed calls in cache (for admin dashboard)
    completedRetentionMinutes: parseInt(
      process.env["CACHE_COMPLETED_RETENTION_MINUTES"] || "90"
    ),
    // How long to keep pending calls before marking as stale (no webhook received)
    pendingMaxAgeMinutes: parseInt(
      process.env["CACHE_PENDING_MAX_AGE_MINUTES"] || "90"
    ),
    // How often to run cleanup of stale calls
    cleanupIntervalMinutes: parseInt(
      process.env["CACHE_CLEANUP_INTERVAL_MINUTES"] || "10"
    ),
  },

  // Logging
  logLevel: process.env["LOG_LEVEL"] || "info",
};

/**
 * Validate required environment variables
 */
export function validateConfig(): void {
  const required = ["BLAND_API_KEY", "BLAND_PATHWAY_ID", "CONVOSO_AUTH_TOKEN"];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(
      `⚠️  Warning: Missing environment variables: ${missing.join(", ")}`
    );
    console.warn("⚠️  Some features may not work correctly.");
  }
}

/**
 * Print configuration (without sensitive data)
 */
export function printConfig(): void {
  console.log("📋 Configuration:");
  console.log(`   PORT: ${config.port}`);
  console.log(`   NODE_ENV: ${config.nodeEnv}`);
  console.log(`   BLAND_BASE_URL: ${config.bland.baseUrl}`);
  console.log(`   BLAND_PATHWAY_ID: ${config.bland.pathwayId ? "✓" : "✗"}`);
  console.log(`   CONVOSO_BASE_URL: ${config.convoso.baseUrl}`);
  console.log(`   CONVOSO_AUTH_TOKEN: ${config.convoso.authToken ? "✓" : "✗"}`);
}
