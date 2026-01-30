// ============================================================================
// Metrics Collector - Performance tracking for load testing
// ============================================================================

import * as fs from "fs";
import * as path from "path";

export interface RequestMetrics {
  timestamp: string;
  timestamp_ms: number;
  request_id: string;
  phone_number: string;
  lead_id: string;
  success: boolean;
  duration_ms: number;
  stage_durations?: Record<string, number>;
  memory_mb?: number;
  cache_size?: number;
  error?: string;
}

export interface MetricsSummary {
  time_window_ms: number;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  success_rate: number;
  avg_duration_ms: number;
  min_duration_ms: number;
  max_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
  requests_per_second: number;
  avg_memory_mb: number;
  peak_memory_mb: number;
  cache_stats: {
    avg_size: number;
    max_size: number;
    min_size: number;
  };
}

class MetricsCollectorClass {
  private logDir: string;
  private metricsLogFile: string;
  private metricsBuffer: RequestMetrics[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 500; // Flush after 500 metrics
  private readonly FLUSH_INTERVAL_MS = 10000; // Or flush every 10 seconds

  // Real-time metrics tracking
  private requestCount = 0;
  private errorCount = 0;
  private totalDuration = 0;
  private startTime = Date.now();

  constructor() {
    this.logDir = path.join(process.cwd(), "logs");
    this.metricsLogFile = path.join(this.logDir, "metrics.log");
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
   * Record a request metric
   */
  recordRequest(
    requestId: string,
    phoneNumber: string,
    leadId: string,
    success: boolean,
    durationMs: number,
    options?: {
      stageDurations?: Record<string, number>;
      cacheSize?: number;
      error?: string;
    }
  ): void {
    const memUsage = process.memoryUsage();

    const metric: RequestMetrics = {
      timestamp: new Date().toISOString(),
      timestamp_ms: Date.now(),
      request_id: requestId,
      phone_number: phoneNumber,
      lead_id: leadId,
      success,
      duration_ms: durationMs,
      stage_durations: options?.stageDurations,
      memory_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      cache_size: options?.cacheSize,
      error: options?.error,
    };

    this.metricsBuffer.push(metric);

    // Update real-time counters
    this.requestCount++;
    this.totalDuration += durationMs;
    if (!success) {
      this.errorCount++;
    }

    // Flush if buffer is full
    if (this.metricsBuffer.length >= this.BUFFER_SIZE) {
      this.flush();
    }
  }

  /**
   * Flush metrics buffer to disk
   */
  private flush(): void {
    if (this.metricsBuffer.length === 0) {
      return;
    }

    const metrics = [...this.metricsBuffer];
    this.metricsBuffer = [];

    try {
      const logLines = metrics.map((entry) => JSON.stringify(entry)).join("\n");
      fs.appendFileSync(this.metricsLogFile, logLines + "\n");
    } catch (err) {
      console.error("Failed to write metrics log:", err);
    }
  }

  /**
   * Force flush all buffered metrics
   */
  forceFlush(): void {
    this.flush();
  }

  /**
   * Get real-time metrics (fast, in-memory)
   */
  getRealTimeMetrics(): {
    uptime_ms: number;
    total_requests: number;
    error_count: number;
    success_rate: number;
    avg_duration_ms: number;
    requests_per_second: number;
  } {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeSec = uptimeMs / 1000;

    return {
      uptime_ms: uptimeMs,
      total_requests: this.requestCount,
      error_count: this.errorCount,
      success_rate:
        this.requestCount > 0
          ? ((this.requestCount - this.errorCount) / this.requestCount) * 100
          : 100,
      avg_duration_ms:
        this.requestCount > 0 ? this.totalDuration / this.requestCount : 0,
      requests_per_second: uptimeSec > 0 ? this.requestCount / uptimeSec : 0,
    };
  }

  /**
   * Get detailed metrics from log file
   */
  getMetricsSummary(timeWindowMs: number = 60000): MetricsSummary {
    try {
      const now = Date.now();
      const cutoff = now - timeWindowMs;

      if (!fs.existsSync(this.metricsLogFile)) {
        return this.getEmptySummary(timeWindowMs);
      }

      const content = fs.readFileSync(this.metricsLogFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      const recentMetrics: RequestMetrics[] = [];

      for (const line of lines) {
        try {
          const entry: RequestMetrics = JSON.parse(line);
          if (entry.timestamp_ms >= cutoff) {
            recentMetrics.push(entry);
          }
        } catch (parseErr) {
          // Skip malformed lines
        }
      }

      if (recentMetrics.length === 0) {
        return this.getEmptySummary(timeWindowMs);
      }

      // Calculate statistics
      const durations = recentMetrics.map((m) => m.duration_ms).sort((a, b) => a - b);
      const memories = recentMetrics
        .map((m) => m.memory_mb || 0)
        .filter((m) => m > 0);
      const cacheSizes = recentMetrics
        .map((m) => m.cache_size || 0)
        .filter((c) => c > 0);

      const successfulRequests = recentMetrics.filter((m) => m.success).length;
      const failedRequests = recentMetrics.length - successfulRequests;

      return {
        time_window_ms: timeWindowMs,
        total_requests: recentMetrics.length,
        successful_requests: successfulRequests,
        failed_requests: failedRequests,
        success_rate: (successfulRequests / recentMetrics.length) * 100,
        avg_duration_ms:
          durations.reduce((a, b) => a + b, 0) / durations.length,
        min_duration_ms: durations[0] || 0,
        max_duration_ms: durations[durations.length - 1] || 0,
        p50_duration_ms: this.percentile(durations, 50),
        p95_duration_ms: this.percentile(durations, 95),
        p99_duration_ms: this.percentile(durations, 99),
        requests_per_second: (recentMetrics.length / timeWindowMs) * 1000,
        avg_memory_mb: memories.length > 0
          ? memories.reduce((a, b) => a + b, 0) / memories.length
          : 0,
        peak_memory_mb: Math.max(...memories, 0),
        cache_stats: {
          avg_size: cacheSizes.length > 0
            ? cacheSizes.reduce((a, b) => a + b, 0) / cacheSizes.length
            : 0,
          max_size: Math.max(...cacheSizes, 0),
          min_size: cacheSizes.length > 0 ? Math.min(...cacheSizes) : 0,
        },
      };
    } catch (err) {
      console.error("Failed to read metrics summary:", err);
      return this.getEmptySummary(timeWindowMs);
    }
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)] || 0;
  }

  /**
   * Get empty summary
   */
  private getEmptySummary(timeWindowMs: number): MetricsSummary {
    return {
      time_window_ms: timeWindowMs,
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      success_rate: 100,
      avg_duration_ms: 0,
      min_duration_ms: 0,
      max_duration_ms: 0,
      p50_duration_ms: 0,
      p95_duration_ms: 0,
      p99_duration_ms: 0,
      requests_per_second: 0,
      avg_memory_mb: 0,
      peak_memory_mb: 0,
      cache_stats: {
        avg_size: 0,
        max_size: 0,
        min_size: 0,
      },
    };
  }

  /**
   * Clear metrics log file
   */
  clearMetricsLog(): void {
    try {
      if (fs.existsSync(this.metricsLogFile)) {
        fs.unlinkSync(this.metricsLogFile);
      }
      // Reset counters
      this.requestCount = 0;
      this.errorCount = 0;
      this.totalDuration = 0;
      this.startTime = Date.now();
    } catch (err) {
      console.error("Failed to clear metrics log:", err);
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
export const metricsCollector = new MetricsCollectorClass();

// Flush on process exit
process.on("SIGINT", () => {
  metricsCollector.shutdown();
});

process.on("SIGTERM", () => {
  metricsCollector.shutdown();
});
