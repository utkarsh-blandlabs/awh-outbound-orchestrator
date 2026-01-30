// ============================================================================
// Error Logger - Separate error tracking for load testing and monitoring
// ============================================================================

import * as fs from "fs";
import * as path from "path";

export interface ErrorLogEntry {
  timestamp: string;
  timestamp_ms: number;
  request_id: string;
  error_type: string;
  error_message: string;
  stage?: string;
  phone_number?: string;
  lead_id?: string;
  stack_trace?: string;
  http_status?: number;
  duration_ms?: number;
  context?: Record<string, any>;
}

class ErrorLoggerClass {
  private logDir: string;
  private errorLogFile: string;
  private errorBuffer: ErrorLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 100; // Flush after 100 errors
  private readonly FLUSH_INTERVAL_MS = 5000; // Or flush every 5 seconds

  constructor() {
    this.logDir = path.join(process.cwd(), "logs");
    this.errorLogFile = path.join(this.logDir, "errors.log");
    this.ensureLogDirectory();
    this.startPeriodicFlush();
  }

  /**
   * Ensure logs directory exists
   */
  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Start periodic flush to disk
   */
  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Log an error
   */
  logError(
    requestId: string,
    errorType: string,
    errorMessage: string,
    options?: {
      stage?: string;
      phoneNumber?: string;
      leadId?: string;
      stackTrace?: string;
      httpStatus?: number;
      durationMs?: number;
      context?: Record<string, any>;
    }
  ): void {
    const entry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      timestamp_ms: Date.now(),
      request_id: requestId,
      error_type: errorType,
      error_message: errorMessage,
      stage: options?.stage,
      phone_number: options?.phoneNumber,
      lead_id: options?.leadId,
      stack_trace: options?.stackTrace,
      http_status: options?.httpStatus,
      duration_ms: options?.durationMs,
      context: options?.context,
    };

    this.errorBuffer.push(entry);

    // Flush if buffer is full
    if (this.errorBuffer.length >= this.BUFFER_SIZE) {
      this.flush();
    }
  }

  /**
   * Flush error buffer to disk
   */
  private flush(): void {
    if (this.errorBuffer.length === 0) {
      return;
    }

    const errors = [...this.errorBuffer];
    this.errorBuffer = [];

    try {
      const logLines = errors
        .map((entry) => JSON.stringify(entry))
        .join("\n");
      fs.appendFileSync(this.errorLogFile, logLines + "\n");
    } catch (err) {
      console.error("Failed to write error log:", err);
    }
  }

  /**
   * Force flush all buffered errors
   */
  forceFlush(): void {
    this.flush();
  }

  /**
   * Get error statistics from log file
   */
  getErrorStats(timeWindowMs: number = 60000): {
    total_errors: number;
    errors_by_type: Record<string, number>;
    errors_by_stage: Record<string, number>;
    recent_errors: ErrorLogEntry[];
  } {
    try {
      const now = Date.now();
      const cutoff = now - timeWindowMs;

      if (!fs.existsSync(this.errorLogFile)) {
        return {
          total_errors: 0,
          errors_by_type: {},
          errors_by_stage: {},
          recent_errors: [],
        };
      }

      const content = fs.readFileSync(this.errorLogFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      const recentErrors: ErrorLogEntry[] = [];
      const errorsByType: Record<string, number> = {};
      const errorsByStage: Record<string, number> = {};

      for (const line of lines) {
        try {
          const entry: ErrorLogEntry = JSON.parse(line);

          // Only count errors within time window
          if (entry.timestamp_ms >= cutoff) {
            recentErrors.push(entry);

            errorsByType[entry.error_type] =
              (errorsByType[entry.error_type] || 0) + 1;

            if (entry.stage) {
              errorsByStage[entry.stage] =
                (errorsByStage[entry.stage] || 0) + 1;
            }
          }
        } catch (parseErr) {
          // Skip malformed lines
        }
      }

      return {
        total_errors: recentErrors.length,
        errors_by_type: errorsByType,
        errors_by_stage: errorsByStage,
        recent_errors: recentErrors.slice(-50), // Last 50 errors
      };
    } catch (err) {
      console.error("Failed to read error stats:", err);
      return {
        total_errors: 0,
        errors_by_type: {},
        errors_by_stage: {},
        recent_errors: [],
      };
    }
  }

  /**
   * Clear error log file
   */
  clearErrorLog(): void {
    try {
      if (fs.existsSync(this.errorLogFile)) {
        fs.unlinkSync(this.errorLogFile);
      }
    } catch (err) {
      console.error("Failed to clear error log:", err);
    }
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

// Singleton instance
export const errorLogger = new ErrorLoggerClass();

// Flush on process exit
process.on("SIGINT", () => {
  errorLogger.shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  errorLogger.shutdown();
  process.exit(0);
});
