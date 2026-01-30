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

    // Phone number pool (for rotating caller IDs to improve pickup rates)
    fromPool: (process.env["BLAND_FROM_POOL"] || "")
      .split(",")
      .map(n => n.trim())
      .filter(n => n.length > 0),
    usePool: process.env["BLAND_USE_POOL"] === "true",
    poolStrategy: (process.env["BLAND_POOL_STRATEGY"] || "round-robin") as "round-robin" | "random",

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
    voicemailAction: process.env["BLAND_VOICEMAIL_ACTION"] || "",
    answeredByEnabled: process.env["BLAND_ANSWERED_BY_ENABLED"] === "true",
    sensitiveVoicemailDetection:
      process.env["BLAND_SENSITIVE_VOICEMAIL_DETECTION"] === "true",

    // SMS settings (sent with voicemail)
    smsEnabled: process.env["BLAND_SMS_ENABLED"] === "true",
    smsFrom: process.env["BLAND_SMS_FROM"] || "",
    smsMessage: process.env["BLAND_SMS_MESSAGE"] || "",

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
      process.env["RATE_LIMITER_SAME_NUMBER_INTERVAL_MS"] || "120000" // 2 minutes
    ),
  },

  // Answering Machine Tracker config
  answeringMachineTracker: {
    enabled: process.env["ANSWERING_MACHINE_TRACKING_ENABLED"] === "true",
    maxAttemptsPerLead: parseInt(
      process.env["ANSWERING_MACHINE_MAX_ATTEMPTS"] || "4"
    ),
    flushHourEST: parseFloat(
      process.env["ANSWERING_MACHINE_FLUSH_HOUR_EST"] || "20.5"
    ),
    trackedStatuses: (
      process.env["ANSWERING_MACHINE_TRACKED_STATUSES"] ||
      "VOICEMAIL,NO_ANSWER,new,answer machine,answering machine,"
    )
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  },

  // Queue Processor config
  queueProcessor: {
    enabled: process.env["QUEUE_PROCESSOR_ENABLED"] === "true",
    intervalMinutes: parseInt(
      process.env["QUEUE_PROCESSOR_INTERVAL_MINUTES"] || "30"
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

  // Blocklist auto-flag config
  blocklist: {
    // Automatically blocklist phone numbers that return "Call failed" errors
    // These are bad numbers that don't register as missed calls
    autoFlagFailedCalls: process.env["BLOCKLIST_AUTO_FLAG_FAILED_CALLS"] === "true",
    failedCallReason: process.env["BLOCKLIST_FAILED_CALL_REASON"] ||
      "Auto-flagged: Call failed (bad number)",
  },

  // Logging
  logLevel: process.env["LOG_LEVEL"] || "info",

  // SMS Automation config (dynamic templates)
  sms: {
    enabled: process.env["SMS_AUTOMATION_ENABLED"] === "true",
    // Primary SMS number - only calls from this number will trigger SMS
    // Other pool numbers will only make calls (no SMS)
    primaryNumber: process.env["SMS_PRIMARY_NUMBER"] || "5619565858",
    // SMS message templates (4 messages)
    message1: process.env["SMS_MESSAGE_1"] ||
      "Hey {{first_name}}, your healthcare plan request has been received! We will be calling you shortly. Or if you prefer, Call us (561) 956-5858 and let's get you covered. Text STOP to be removed anytime.",
    message2: process.env["SMS_MESSAGE_2"] ||
      "At American Way Health we make the process simple and easy, Health Plans that fit you and your family's budget. Call (561) 956-5858 to learn more. Text STOP to be removed anytime.",
    message3: process.env["SMS_MESSAGE_3"] ||
      "{{first_name}}, we have health care plans with low premiums for individuals and families. Reach (561) 956-5858 to connect with a licensed agent. Text STOP to be removed anytime.",
    message4: process.env["SMS_MESSAGE_4"] ||
      "{{first_name}}, healthcare rates will increase next month. Get your rate saved today. Call (561) 956-5858 to connect with a licensed agent. Text STOP to be removed anytime.",
    // Day gaps for sending messages (comma-separated)
    dayGaps: (process.env["SMS_DAY_GAPS"] || "0,1,3,7")
      .split(",")
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n)),
    // Maximum number of messages to send (default 4)
    maxMessages: parseInt(process.env["SMS_MAX_MESSAGES"] || "4"),
    // TCPA compliance hours
    startHour: parseInt(process.env["SMS_START_HOUR"] || "8"),
    endHour: parseInt(process.env["SMS_END_HOUR"] || "21"),
    // SMS triggers (Bland outcomes that trigger SMS)
    triggers: (process.env["SMS_AUTOMATION_TRIGGERS"] || "VOICEMAIL,NO_ANSWER")
      .split(",")
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0),
  },

  // Number Pool Intelligence config
  numberPool: {
    rollingWindowHours: parseInt(process.env["NUMBER_POOL_ROLLING_WINDOW_HOURS"] || "48"),
    cooldownThreshold: parseInt(process.env["NUMBER_POOL_COOLDOWN_THRESHOLD"] || "5"),
    cooldownMinutes: parseInt(process.env["NUMBER_POOL_COOLDOWN_MINUTES"] || "5"),
    mappingExpiryDays: parseInt(process.env["NUMBER_POOL_MAPPING_EXPIRY_DAYS"] || "30"),
    minAvailable: parseInt(process.env["NUMBER_POOL_MIN_AVAILABLE"] || "2"),
  },

  // Redial Daily Decay Schedule config
  redialDecay: {
    enabled: process.env["REDIAL_DECAY_ENABLED"] === "true",
    // Daily call limits for each day (comma-separated)
    // Example: "8,7,5,1,3,5,4,3,2,1,1,1..." for 30 days
    dailySchedule: (process.env["REDIAL_DAILY_SCHEDULE"] ||
      "8,7,5,3,5,4,3,2,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1")
      .split(",")
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n >= 0),
    // Maximum total calls per lead per month
    maxCallsPerMonth: parseInt(process.env["REDIAL_MAX_CALLS_PER_MONTH"] || "45"),
    // Randomize call times throughout the day (avoid calling at same time)
    randomizeTimes: process.env["REDIAL_RANDOMIZE_TIMES"] !== "false", // Enabled by default
    // Minimum minutes between randomized calls (default 15 minutes)
    minRandomMinutes: parseInt(process.env["REDIAL_MIN_RANDOM_MINUTES"] || "15"),
    // Maximum minutes between randomized calls (default 120 minutes = 2 hours)
    maxRandomMinutes: parseInt(process.env["REDIAL_MAX_RANDOM_MINUTES"] || "120"),
  },
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
