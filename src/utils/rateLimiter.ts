/**
 * Rate Limiter for Bland AI API calls
 *
 * Enforces two types of limits:
 * 1. Global rate limit: Enterprise = 20,000 calls/hour (5.5 calls/sec)
 * 2. Per-number limit: Cannot call same number within 2 minutes (120 seconds)
 *
 * This prevents:
 * - Hitting Bland AI's 429 rate limit errors
 * - Back-to-back calls to same customer (poor experience)
 * - Duplicate calls during redial attempts
 *
 * Can be controlled via environment variables:
 * - RATE_LIMITER_ENABLED=true/false
 * - RATE_LIMITER_MAX_CALLS_PER_SECOND=5
 * - RATE_LIMITER_SAME_NUMBER_INTERVAL_MS=120000
 */

import { config } from "../config";

interface RateLimitConfig {
  enabled: boolean; // Enable/disable rate limiting
  maxCallsPerSecond: number; // Global limit
  sameNumberIntervalMs: number; // Per-number limit
}

interface CallRecord {
  phoneNumber: string;
  timestamp: number;
}

class BlandRateLimiter {
  private config: RateLimitConfig;
  private lastCallByNumber: Map<string, number>; // phone -> timestamp
  private recentCalls: CallRecord[]; // Sliding window for global rate
  private waitQueue: Array<{
    phoneNumber: string;
    resolve: () => void;
    timestamp: number;
  }>;
  private processingQueue: boolean;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      enabled: true, // Enabled by default
      maxCallsPerSecond: 5, // Conservative: Enterprise allows 5.5
      sameNumberIntervalMs: 120000, // 2 minutes (120 seconds)
      ...config,
    };

    this.lastCallByNumber = new Map();
    this.recentCalls = [];
    this.waitQueue = [];
    this.processingQueue = false;

    // Periodic cleanup to prevent memory leaks
    setInterval(() => {
      this.cleanup();
    }, 60000); // Cleanup every 60 seconds
  }

  /**
   * Clean up old entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();

    // Remove phone numbers not called in last 10 minutes
    const tenMinutesAgo = now - 10 * 60 * 1000;
    for (const [phoneNumber, timestamp] of this.lastCallByNumber.entries()) {
      if (timestamp < tenMinutesAgo) {
        this.lastCallByNumber.delete(phoneNumber);
      }
    }

    // Remove calls older than 5 seconds from recentCalls
    const fiveSecondsAgo = now - 5000;
    this.recentCalls = this.recentCalls.filter(
      (call) => call.timestamp > fiveSecondsAgo
    );
  }

  /**
   * Wait until it's safe to call a phone number
   * Returns a promise that resolves when the call can proceed
   */
  async waitForSlot(phoneNumber: string): Promise<void> {
    // If rate limiting is disabled, skip all checks
    if (!this.config.enabled) {
      return;
    }

    const now = Date.now();

    // Check per-number limit
    const lastCall = this.lastCallByNumber.get(phoneNumber);
    if (lastCall) {
      const timeSinceLastCall = now - lastCall;
      if (timeSinceLastCall < this.config.sameNumberIntervalMs) {
        const waitTime = this.config.sameNumberIntervalMs - timeSinceLastCall;
        console.log(
          `[RateLimiter] Same number called recently. Waiting ${waitTime}ms before calling ${phoneNumber}`
        );
        await this.sleep(waitTime);
      }
    }

    // Check global rate limit
    await this.waitForGlobalSlot();

    // Record this call
    this.recordCall(phoneNumber);
  }

  /**
   * Wait for global rate limit slot
   */
  private async waitForGlobalSlot(): Promise<void> {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Clean up old calls (older than 1 second)
    this.recentCalls = this.recentCalls.filter(
      (call) => call.timestamp > oneSecondAgo
    );

    // Check if we're at the limit
    if (this.recentCalls.length >= this.config.maxCallsPerSecond) {
      // Find the oldest call in the window
      const oldestCall = this.recentCalls[0];
      if (!oldestCall) {
        // Should never happen, but handle it
        return;
      }

      const waitTime = oldestCall.timestamp + 1000 - now;

      if (waitTime > 0) {
        console.log(
          `[RateLimiter] Global rate limit reached (${this.recentCalls.length}/${this.config.maxCallsPerSecond}). Waiting ${waitTime}ms`
        );
        await this.sleep(waitTime);
        // Recursively check again after waiting
        return this.waitForGlobalSlot();
      }
    }
  }

  /**
   * Record a call for rate limiting
   */
  private recordCall(phoneNumber: string): void {
    const now = Date.now();
    this.lastCallByNumber.set(phoneNumber, now);
    this.recentCalls.push({ phoneNumber, timestamp: now });
  }

  /**
   * Check if a number can be called right now (non-blocking)
   */
  canCallNow(phoneNumber: string): boolean {
    const now = Date.now();

    // Check per-number limit
    const lastCall = this.lastCallByNumber.get(phoneNumber);
    if (lastCall && now - lastCall < this.config.sameNumberIntervalMs) {
      return false;
    }

    // Check global limit
    const oneSecondAgo = now - 1000;
    const recentCallCount = this.recentCalls.filter(
      (call) => call.timestamp > oneSecondAgo
    ).length;

    return recentCallCount < this.config.maxCallsPerSecond;
  }

  /**
   * Get wait time for a specific number (in milliseconds)
   */
  getWaitTime(phoneNumber: string): number {
    const now = Date.now();

    // Check per-number limit
    const lastCall = this.lastCallByNumber.get(phoneNumber);
    if (lastCall) {
      const timeSinceLastCall = now - lastCall;
      if (timeSinceLastCall < this.config.sameNumberIntervalMs) {
        return this.config.sameNumberIntervalMs - timeSinceLastCall;
      }
    }

    // Check global limit
    const oneSecondAgo = now - 1000;
    const recentInWindow = this.recentCalls.filter(
      (call) => call.timestamp > oneSecondAgo
    );

    if (recentInWindow.length >= this.config.maxCallsPerSecond) {
      const oldestCall = recentInWindow[0];
      if (oldestCall) {
        return Math.max(0, oldestCall.timestamp + 1000 - now);
      }
    }

    return 0;
  }

  /**
   * Get current rate limit stats
   */
  getStats() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    const recentCallCount = this.recentCalls.filter(
      (call) => call.timestamp > oneSecondAgo
    ).length;

    return {
      currentCallsPerSecond: recentCallCount,
      maxCallsPerSecond: this.config.maxCallsPerSecond,
      utilizationPercent: (
        (recentCallCount / this.config.maxCallsPerSecond) *
        100
      ).toFixed(1),
      uniqueNumbersCalled: this.lastCallByNumber.size,
      totalCallsTracked: this.recentCalls.length,
    };
  }

  /**
   * Reset all rate limiting state (useful for testing)
   */
  reset(): void {
    this.lastCallByNumber.clear();
    this.recentCalls = [];
    this.waitQueue = [];
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }
}

// Export singleton instance with config from environment
export const blandRateLimiter = new BlandRateLimiter({
  enabled: config.rateLimiter.enabled,
  maxCallsPerSecond: config.rateLimiter.maxCallsPerSecond,
  sameNumberIntervalMs: config.rateLimiter.sameNumberIntervalMs,
});

export { BlandRateLimiter };
export type { RateLimitConfig };
