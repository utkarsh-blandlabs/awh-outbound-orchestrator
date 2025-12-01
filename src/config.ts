// ============================================================================
// Configuration Module
// ============================================================================

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
    fromNumber: process.env["BLAND_FROM_NUMBER"] || "",
    transferNumber: process.env["BLAND_TRANSFER_NUMBER"] || "",
    voicemailMessage:
      process.env["BLAND_VOICEMAIL_MESSAGE"] ||
      "This is Ashley from American Way Health...",

    // Polling config for transcript
    transcriptPollInterval: parseInt(
      process.env["BLAND_POLL_INTERVAL"] || "5000"
    ), // 5 seconds
    transcriptPollMaxAttempts: parseInt(
      process.env["BLAND_POLL_MAX_ATTEMPTS"] || "60"
    ), // 5 minutes max
  },

  // Convoso API config (Updated with actual auth method from Jeff)
  convoso: {
    authToken: process.env["CONVOSO_AUTH_TOKEN"] || "",
    baseUrl: process.env["CONVOSO_BASE_URL"] || "https://api.convoso.com",
    listId: process.env["CONVOSO_LIST_ID"] || "16529", // Default list from Jeff's example
  },

  // Retry config
  retry: {
    maxAttempts: parseInt(process.env["RETRY_MAX_ATTEMPTS"] || "3"),
    initialDelay: parseInt(process.env["RETRY_INITIAL_DELAY"] || "1000"), // 1 second
    maxDelay: parseInt(process.env["RETRY_MAX_DELAY"] || "10000"), // 10 seconds
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
  console.log(`   CONVOSO_LIST_ID: ${config.convoso.listId}`);
}
