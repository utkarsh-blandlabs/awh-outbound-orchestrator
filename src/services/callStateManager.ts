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
    lastName: string
  ): void {
    const pendingCall: PendingCall = {
      call_id: callId,
      request_id: requestId,
      lead_id: leadId,
      list_id: listId,
      phone_number: phoneNumber,
      first_name: firstName,
      last_name: lastName,
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

      // Keep in cache for configured retention time (default 90 minutes)
      const retentionMs = config.cache.completedRetentionMinutes * 60 * 1000;
      setTimeout(() => {
        this.pendingCalls.delete(callId);
      }, retentionMs);
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

      // Keep in cache for configured retention time (default 90 minutes)
      const retentionMs = config.cache.completedRetentionMinutes * 60 * 1000;
      setTimeout(() => {
        this.pendingCalls.delete(callId);
      }, retentionMs);
    }
  }

  getAllPendingCalls(): PendingCall[] {
    return Array.from(this.pendingCalls.values()).filter(
      (call) => call.status === "pending"
    );
  }

  cleanupOldCalls(): void {
    const now = Date.now();
    const maxAge = config.cache.pendingMaxAgeMinutes * 60 * 1000;

    let cleanedCount = 0;
    for (const [callId, call] of this.pendingCalls.entries()) {
      if (now - call.created_at > maxAge) {
        this.pendingCalls.delete(callId);
        cleanedCount++;
        logger.warn("Stale call removed", {
          call_id: callId,
          lead_id: call.lead_id,
          age_minutes: Math.round((now - call.created_at) / 60000),
        });
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Removed ${cleanedCount} stale calls`, {
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
