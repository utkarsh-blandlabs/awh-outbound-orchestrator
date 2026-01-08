import { logger } from "../utils/logger";
import { config } from "../config";

interface PendingCall {
  call_id: string;
  request_id: string;
  lead_id: string;
  list_id: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  state: string;
  created_at: number;
  status: "pending" | "completed" | "failed";
  error?: string;
}

class CallStateManagerClass {
  private pendingCalls: Map<string, PendingCall> = new Map();

  addPendingCall(
    callId: string,
    requestId: string,
    leadId: string,
    listId: string,
    phoneNumber: string,
    firstName: string,
    lastName: string,
    state: string
  ): void {
    const pendingCall: PendingCall = {
      call_id: callId,
      request_id: requestId,
      lead_id: leadId,
      list_id: listId,
      phone_number: phoneNumber,
      first_name: firstName,
      last_name: lastName,
      state: state,
      created_at: Date.now(),
      status: "pending",
    };

    this.pendingCalls.set(callId, pendingCall);

    logger.info("Added pending call", {
      call_id: callId,
      lead_id: leadId,
      list_id: listId,
      pending_count: this.pendingCalls.size,
    });
  }

  getPendingCall(callId: string): PendingCall | null {
    return this.pendingCalls.get(callId) || null;
  }

  completeCall(callId: string): void {
    const call = this.pendingCalls.get(callId);
    if (call) {
      call.status = "completed";
      logger.info("Call completed", {
        call_id: callId,
        duration_ms: Date.now() - call.created_at,
      });
      // Don't use setTimeout - cleanup interval will handle deletion
    }
  }

  failCall(callId: string, error: string): void {
    const call = this.pendingCalls.get(callId);
    if (call) {
      call.status = "failed";
      call.error = error;
      logger.error("Call failed", {
        call_id: callId,
        error,
      });
      // Don't use setTimeout - cleanup interval will handle deletion
    }
  }

  getAllPendingCalls(): PendingCall[] {
    return Array.from(this.pendingCalls.values()).filter(
      (call) => call.status === "pending"
    );
  }

  cleanupOldCalls(): void {
    const now = Date.now();
    const pendingMaxAge = config.cache.pendingMaxAgeMinutes * 60 * 1000;
    const completedRetention = config.cache.completedRetentionMinutes * 60 * 1000;

    let stalePendingCount = 0;
    let completedCount = 0;

    for (const [callId, call] of this.pendingCalls.entries()) {
      // Remove stale pending calls (no webhook received)
      if (call.status === "pending" && now - call.created_at > pendingMaxAge) {
        this.pendingCalls.delete(callId);
        stalePendingCount++;
        logger.warn("Stale pending call removed", {
          call_id: callId,
          lead_id: call.lead_id,
          age_minutes: Math.round((now - call.created_at) / 60000),
        });
      }
      // Remove old completed/failed calls after retention period
      else if ((call.status === "completed" || call.status === "failed") &&
               now - call.created_at > completedRetention) {
        this.pendingCalls.delete(callId);
        completedCount++;
      }
    }

    if (stalePendingCount > 0 || completedCount > 0) {
      logger.info("Cleanup completed", {
        stale_pending_removed: stalePendingCount,
        completed_removed: completedCount,
        remaining: this.pendingCalls.size,
      });
    }
  }

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

export const CallStateManager = new CallStateManagerClass();

// Periodic cleanup of stale calls
const cleanupIntervalMs = config.cache.cleanupIntervalMinutes * 60 * 1000;
setInterval(() => {
  CallStateManager.cleanupOldCalls();
}, cleanupIntervalMs);
