// ============================================================================
// Call State Manager
// In-memory storage to track pending calls and match Bland webhooks
// ============================================================================

import { logger } from "../utils/logger";

/**
 * Represents a pending call waiting for Bland webhook
 */
interface PendingCall {
  call_id: string;
  request_id: string;
  lead_id: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  created_at: number; // timestamp
  status: "pending" | "completed" | "failed";
  error?: string;
}

/**
 * In-memory storage for pending calls
 * In production, you might want to use Redis for persistence
 */
class CallStateManagerClass {
  private pendingCalls: Map<string, PendingCall> = new Map();

  /**
   * Add a new pending call
   */
  addPendingCall(
    callId: string,
    requestId: string,
    leadId: string,
    phoneNumber: string,
    firstName: string,
    lastName: string
  ): void {
    const pendingCall: PendingCall = {
      call_id: callId,
      request_id: requestId,
      lead_id: leadId,
      phone_number: phoneNumber,
      first_name: firstName,
      last_name: lastName,
      created_at: Date.now(),
      status: "pending",
    };

    this.pendingCalls.set(callId, pendingCall);

    logger.info("📝 Added pending call to state", {
      call_id: callId,
      request_id: requestId,
      lead_id: leadId,
      pending_calls_count: this.pendingCalls.size,
    });
  }

  /**
   * Get a pending call by call_id
   */
  getPendingCall(callId: string): PendingCall | null {
    const call = this.pendingCalls.get(callId);
    return call || null;
  }

  /**
   * Mark a call as completed
   */
  completeCall(callId: string): void {
    const call = this.pendingCalls.get(callId);
    if (call) {
      call.status = "completed";
      logger.info("✅ Marked call as completed", {
        call_id: callId,
        duration_ms: Date.now() - call.created_at,
      });

      // Clean up after some time (keep for 5 minutes for debugging)
      setTimeout(() => {
        this.pendingCalls.delete(callId);
        logger.debug("🧹 Cleaned up completed call from state", {
          call_id: callId,
        });
      }, 5 * 60 * 1000);
    }
  }

  /**
   * Mark a call as failed
   */
  failCall(callId: string, error: string): void {
    const call = this.pendingCalls.get(callId);
    if (call) {
      call.status = "failed";
      call.error = error;
      logger.error("❌ Marked call as failed", {
        call_id: callId,
        error,
        duration_ms: Date.now() - call.created_at,
      });

      // Clean up after some time (keep for 5 minutes for debugging)
      setTimeout(() => {
        this.pendingCalls.delete(callId);
        logger.debug("🧹 Cleaned up failed call from state", {
          call_id: callId,
        });
      }, 5 * 60 * 1000);
    }
  }

  /**
   * Get all pending calls (for debugging)
   */
  getAllPendingCalls(): PendingCall[] {
    return Array.from(this.pendingCalls.values()).filter(
      (call) => call.status === "pending"
    );
  }

  /**
   * Clean up old pending calls (older than 90 minutes)
   * Extended to 90 minutes because agents can take up to 1 hour 20 minutes to close calls
   * This prevents memory leaks from calls that never complete
   */
  cleanupOldCalls(): void {
    const now = Date.now();
    const maxAge = 90 * 60 * 1000; // 90 minutes (1.5 hours)

    let cleanedCount = 0;
    for (const [callId, call] of this.pendingCalls.entries()) {
      if (now - call.created_at > maxAge) {
        this.pendingCalls.delete(callId);
        cleanedCount++;
        logger.warn("🧹 CLEANUP | Stale pending call removed", {
          call_id: callId,
          lead_id: call.lead_id,
          phone: call.phone_number,
          age_minutes: Math.round((now - call.created_at) / 60000),
          status: call.status,
        });
      }
    }

    if (cleanedCount > 0) {
      logger.info(`🧹 CLEANUP | Removed ${cleanedCount} stale calls (>90min)`, {
        remaining_calls: this.pendingCalls.size,
        stats: this.getStats(),
      });
    }
  }

  /**
   * Get stats (for debugging/monitoring)
   */
  getStats(): {
    total: number;
    pending: number;
    completed: number;
    failed: number;
  } {
    const all = Array.from(this.pendingCalls.values());
    return {
      total: all.length,
      pending: all.filter((c) => c.status === "pending").length,
      completed: all.filter((c) => c.status === "completed").length,
      failed: all.filter((c) => c.status === "failed").length,
    };
  }
}

// Singleton instance
export const CallStateManager = new CallStateManagerClass();

// Clean up old calls every 10 minutes
setInterval(() => {
  CallStateManager.cleanupOldCalls();
}, 10 * 60 * 1000);
