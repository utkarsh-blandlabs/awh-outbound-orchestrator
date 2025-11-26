// ============================================================================
// Retry Utility with Exponential Backoff
// ============================================================================

import { logger } from "./logger";

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: any) => boolean;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number
): number {
  const delay = initialDelay * Math.pow(2, attempt - 1);
  return Math.min(delay, maxDelay);
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    shouldRetry = () => true,
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if we should retry
      if (!shouldRetry(error)) {
        logger.warn("Error is not retryable, throwing immediately", {
          error: error.message,
        });
        throw error;
      }

      // Last attempt, throw error
      if (attempt === maxAttempts) {
        logger.error("Max retry attempts reached", {
          attempts: maxAttempts,
          error: error.message,
        });
        throw error;
      }

      // Calculate backoff delay
      const delay = getBackoffDelay(attempt, initialDelay, maxDelay);

      logger.warn("Retry attempt failed, backing off", {
        attempt,
        maxAttempts,
        delayMs: delay,
        error: error.message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Determine if an HTTP error is retryable
 */
export function isRetryableHttpError(error: any): boolean {
  // Retry on network errors
  if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
    return true;
  }

  // Retry on 5xx server errors and 429 rate limiting
  if (error.response) {
    const status = error.response.status;
    return status >= 500 || status === 429;
  }

  return false;
}
