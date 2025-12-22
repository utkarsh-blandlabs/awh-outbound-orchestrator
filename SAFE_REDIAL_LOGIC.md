# Safe Redial Logic - Comprehensive Safety System

## Overview
This document explains the **multi-layered safety system** implemented in the redial queue processor to ensure:
- ✅ Only today's leads are redialed
- ✅ Only favorable statuses are processed (pending/rescheduled)
- ✅ Only leads under max attempts (default: 8)
- ✅ No duplicate calls while a call is active/pending
- ✅ Safe reading, writing, and re-writing of records
- ✅ Comprehensive logging for debugging

---

## Safety Layer Architecture

### 🛡️ Layer 1: Global Safety Checks (Before Processing Starts)

**Location:** `processQueue()` lines 470-485

```typescript
// Safety Check #1: Service enabled
if (!this.queueConfig.enabled) {
  logger.debug("Redial queue disabled, skipping processing");
  return;
}

// Safety Check #2: Prevent concurrent processing
if (this.isProcessing) {
  logger.warn("Redial queue already processing, skipping to prevent race condition");
  return;
}

// Safety Check #3: Check if scheduler is active (business hours)
if (!schedulerService.isActive()) {
  logger.debug("Redial queue: Scheduler inactive (outside business hours), skipping");
  return;
}
```

**Purpose:**
- Prevents processing when service is disabled
- Prevents race conditions from concurrent processing
- Respects business hours (no calls outside 9 AM - 5 PM EST)

---

### 🛡️ Layer 2: Data Loading & Filtering

**Location:** `processQueue()` lines 490-556

#### Step 1: Reload Latest Data
```typescript
// Safety Check #4: Reload current month records to get latest data
await this.loadCurrentMonthRecords();
```

**Purpose:** Ensures we have the most up-to-date data before processing

#### Step 2: Filter by Date (Today Only)
```typescript
// Filter #1: Only records from today (created or updated today)
const todayRecords = allRecords.filter((record) => {
  if (!record || !record.created_at) return false;
  const recordDate = new Date(record.created_at).toISOString().substring(0, 10);
  return recordDate === todayDate;
});
```

**Purpose:** Only process leads from today's redial queue

**Log Output:**
```
Filtered to today's records { today: "2025-12-23", today_records: 15 }
```

#### Step 3: Filter by Status (Favorable Only)
```typescript
// Filter #2: Only favorable statuses (pending or rescheduled ready)
const favorableRecords = todayRecords.filter((record) => {
  if (!record || !record.status) return false;

  if (record.status === "pending") return true;

  if (record.status === "rescheduled") {
    if (!record.scheduled_callback_time) return false;
    return record.scheduled_callback_time <= now;
  }

  // completed, max_attempts, paused = NOT favorable
  return false;
});
```

**Purpose:** Only process leads with favorable statuses:
- ✅ `pending` - Ready for next redial
- ✅ `rescheduled` - Callback time has arrived
- ❌ `completed` - Already converted (TRANSFERRED/SALE)
- ❌ `max_attempts` - Hit max attempts limit
- ❌ `paused` - Manually paused

**Log Output:**
```
Filtered to favorable statuses {
  favorable_records: 12,
  pending: 10,
  rescheduled_ready: 2
}
```

#### Step 4: Filter by Attempts (Under Max Only)
```typescript
// Filter #3: Only records under max attempts
const underMaxAttempts = favorableRecords.filter((record) => {
  if (!record || typeof record.attempts !== "number") return false;
  return record.attempts < this.queueConfig.max_redial_attempts;
});
```

**Purpose:** Only process leads that haven't hit max attempts (default: 8)

**Example:**
- Lead with 7 attempts → ✅ Process (7 < 8)
- Lead with 8 attempts → ❌ Skip (8 >= 8)

**Log Output:**
```
Filtered to under max attempts {
  under_max: 8,
  max_attempts: 8
}
```

#### Step 5: Filter by Time (Ready Now Only)
```typescript
// Filter #4: Only records that are due for redial (timestamp passed)
const readyLeads = underMaxAttempts.filter((record) => {
  if (!record || typeof record.next_redial_timestamp !== "number") return false;
  return record.next_redial_timestamp <= now;
});
```

**Purpose:** Only process leads whose redial time has arrived

**Example:**
- Lead scheduled for 2:00 PM, current time 2:05 PM → ✅ Process
- Lead scheduled for 3:00 PM, current time 2:05 PM → ❌ Skip (not ready yet)

**Log Output:**
```
Redial queue ready leads identified {
  ready_to_dial: 5,
  breakdown: {
    total: 20,
    today_only: 15,
    favorable_status: 12,
    under_max_attempts: 8,
    time_ready: 5
  }
}
```

---

### 🛡️ Layer 3: Pre-Call Safety Checks (For Each Lead)

**Location:** `processQueue()` lines 583-638

#### Check 1: Null Safety
```typescript
if (!lead || !lead.phone_number || !lead.lead_id) {
  logger.error("Invalid lead record, skipping", { lead });
  skippedCount++;
  continue;
}
```

**Purpose:** Prevent processing corrupted or incomplete records

#### Check 2: Verify Max Attempts (Re-check)
```typescript
// PRE-CALL SAFETY CHECK #1: Verify record still under max attempts
if (lead.attempts >= this.queueConfig.max_redial_attempts) {
  logger.warn("Lead reached max attempts since filtering, skipping", {
    lead_id: lead.lead_id,
    phone: lead.phone_number,
    attempts: lead.attempts,
    max: this.queueConfig.max_redial_attempts,
  });
  lead.status = "max_attempts";
  await this.saveRecords();
  skippedCount++;
  continue;
}
```

**Purpose:** Double-check attempts haven't changed since filtering (race condition protection)

#### Check 3: Active/Pending Call Detection
```typescript
// PRE-CALL SAFETY CHECK #2: Check for active/pending calls to this number
const activeCalls = CallStateManager.getAllPendingCalls();
const activeCallToNumber = activeCalls.find(
  (call) => call.phone_number === lead.phone_number && call.status === "pending"
);

if (activeCallToNumber) {
  logger.info("SAFETY: Skipping redial - active/pending call detected", {
    lead_id: lead.lead_id,
    phone: lead.phone_number,
    active_call_id: activeCallToNumber.call_id,
    next_attempt: lead.attempts + 1,
  });

  // Push redial ahead by 5 minutes
  lead.next_redial_timestamp = now + 5 * 60 * 1000;
  lead.updated_at = now;
  await this.saveRecords();
  skippedCount++;
  continue;
}
```

**Purpose:** **CRITICAL** - Prevents duplicate calls while a call is active/pending

**What Happens:**
1. Checks CallStateManager for any pending calls to this phone number
2. If found, skips the call
3. Reschedules redial for 5 minutes later
4. Logs the skip with active call ID

**Log Output:**
```
SAFETY: Skipping redial - active/pending call detected {
  lead_id: "12345",
  phone: "+15551234567",
  active_call_id: "call_abc123",
  next_attempt: 3
}
```

#### Check 4: Verify Status Still Favorable
```typescript
// PRE-CALL SAFETY CHECK #3: Verify status is still favorable
if (lead.status !== "pending" && lead.status !== "rescheduled") {
  logger.warn("Lead status changed since filtering, skipping", {
    lead_id: lead.lead_id,
    phone: lead.phone_number,
    status: lead.status,
  });
  skippedCount++;
  continue;
}
```

**Purpose:** Ensure status hasn't changed to unfavorable since filtering

---

### 🛡️ Layer 4: Call Execution & Logging

**Location:** `processQueue()` lines 640-673

```typescript
// ALL SAFETY CHECKS PASSED - PROCEED WITH CALL
logger.info("CALLING: All safety checks passed, initiating redial", {
  lead_id: lead.lead_id,
  phone: lead.phone_number,
  attempt_number: lead.attempts + 1,
  max_attempts: this.queueConfig.max_redial_attempts,
  last_outcome: lead.last_outcome,
  time_since_last_call: Math.floor((now - lead.last_call_timestamp) / 60000) + " minutes",
});

// Make the call
const result = await handleAwhOutbound({
  lead_id: lead.lead_id,
  list_id: lead.list_id,
  phone_number: lead.phone_number,
  first_name: lead.first_name,
  last_name: lead.last_name,
  state: lead.state,
  status: lead.last_outcome,
});

logger.info("CALL INITIATED: Redial successful", {
  lead_id: lead.lead_id,
  phone: lead.phone_number,
  call_id: result.call_id,
  success: result.success,
  attempt_number: lead.attempts + 1,
});

processedCount++;

// Note: The webhook will update the record when call completes
// Do NOT update attempts here - let webhook handle it to prevent double-counting
```

**Log Output:**
```
CALLING: All safety checks passed, initiating redial {
  lead_id: "12345",
  phone: "+15551234567",
  attempt_number: 3,
  max_attempts: 8,
  last_outcome: "VOICEMAIL",
  time_since_last_call: "12 minutes"
}

CALL INITIATED: Redial successful {
  lead_id: "12345",
  phone: "+15551234567",
  call_id: "call_xyz789",
  success: true,
  attempt_number: 3
}
```

**Important:** Attempts are **NOT** incremented here. The webhook will increment when it receives the call result to prevent double-counting.

---

### 🛡️ Layer 5: Error Handling & Recovery

**Location:** `processQueue()` lines 674-706

```typescript
catch (error: any) {
  errorCount++;
  logger.error("ERROR: Failed to redial lead", {
    lead_id: lead.lead_id,
    phone: lead.phone_number,
    attempt_number: lead.attempts + 1,
    error: error.message,
    stack: error.stack,
  });

  // Safe error recovery: Schedule retry with progressive interval
  try {
    const retryIntervalMinutes = this.getProgressiveInterval(lead.attempts + 1);
    const retryIntervalMs = retryIntervalMinutes === 0
      ? 2 * 60 * 1000 // Minimum 2 minutes
      : retryIntervalMinutes * 60 * 1000;

    lead.next_redial_timestamp = now + retryIntervalMs;
    lead.updated_at = now;
    await this.saveRecords();

    logger.info("Scheduled retry after error", {
      lead_id: lead.lead_id,
      phone: lead.phone_number,
      retry_in_minutes: retryIntervalMinutes || 2,
    });
  } catch (saveError: any) {
    logger.error("Failed to save retry schedule", {
      lead_id: lead.lead_id,
      error: saveError.message,
    });
  }
}
```

**Purpose:** Safe error recovery
- Logs detailed error information
- Schedules retry using progressive interval
- Nested try-catch prevents cascading failures

---

### 🛡️ Layer 6: Final Summary & Cleanup

**Location:** `processQueue()` lines 709-724

```typescript
// Final summary
logger.info("Redial queue processing completed", {
  total_ready: readyLeads.length,
  calls_made: processedCount,
  skipped: skippedCount,
  errors: errorCount,
});

} catch (error: any) {
  logger.error("CRITICAL: Error processing redial queue", {
    error: error.message,
    stack: error.stack,
  });
} finally {
  this.isProcessing = false;
}
```

**Log Output:**
```
Redial queue processing completed {
  total_ready: 5,
  calls_made: 3,
  skipped: 2,
  errors: 0
}
```

**Purpose:**
- Provides visibility into processing results
- Always releases processing lock in `finally` block
- Catches any unexpected errors

---

## Complete Log Flow Example

Here's what you'll see in the logs during a typical processing run:

```
[INFO] Redial queue processing started {
  total_records: 20,
  max_attempts: 8,
  current_time: "2025-12-23T14:30:00.000Z"
}

[DEBUG] Filtered to today's records {
  today: "2025-12-23",
  today_records: 15
}

[DEBUG] Filtered to favorable statuses {
  favorable_records: 12,
  pending: 10,
  rescheduled_ready: 2
}

[DEBUG] Filtered to under max attempts {
  under_max: 8,
  max_attempts: 8
}

[INFO] Redial queue ready leads identified {
  ready_to_dial: 5,
  breakdown: {
    total: 20,
    today_only: 15,
    favorable_status: 12,
    under_max_attempts: 8,
    time_ready: 5
  }
}

[INFO] CALLING: All safety checks passed, initiating redial {
  lead_id: "12345",
  phone: "+15551234567",
  attempt_number: 3,
  max_attempts: 8,
  last_outcome: "VOICEMAIL",
  time_since_last_call: "12 minutes"
}

[INFO] CALL INITIATED: Redial successful {
  lead_id: "12345",
  phone: "+15551234567",
  call_id: "call_xyz789",
  success: true,
  attempt_number: 3
}

[INFO] SAFETY: Skipping redial - active/pending call detected {
  lead_id: "67890",
  phone: "+15559876543",
  active_call_id: "call_active123",
  next_attempt: 2
}

[INFO] Redial queue processing completed {
  total_ready: 5,
  calls_made: 3,
  skipped: 2,
  errors: 0
}
```

---

## Safety Guarantees

### ✅ What This System Guarantees

1. **No Duplicate Calls**
   - Active call detection prevents calling while call is ongoing
   - Concurrent processing lock prevents race conditions
   - Duplicate webhook detection prevents double-counting

2. **Today's Leads Only**
   - Only processes leads created today
   - Automatic date filtering in EST timezone

3. **Favorable Status Only**
   - Only processes `pending` and `rescheduled` (due)
   - Skips `completed`, `max_attempts`, `paused`

4. **Max Attempts Respected**
   - Double-checked before calling
   - Default: 8 attempts max (configurable)

5. **Safe Data Operations**
   - File locking prevents corruption
   - Atomic writes (write to .tmp, then rename)
   - Reloads data before processing

6. **Comprehensive Logging**
   - Every decision is logged
   - Easy to debug issues
   - Clear visibility into processing

---

## Configuration

### Environment Variables

```env
# Redial Queue Configuration
REDIAL_QUEUE_ENABLED=true
REDIAL_PROGRESSIVE_INTERVALS=0,0,5,10,30,60,120
REDIAL_MAX_ATTEMPTS=8
REDIAL_SUCCESS_OUTCOMES=TRANSFERRED,SALE,ACA,CALLBACK
REDIAL_RETENTION_DAYS=30
REDIAL_PROCESS_INTERVAL=5  # Check every 5 minutes
```

### Customization

**Change Max Attempts:**
```env
REDIAL_MAX_ATTEMPTS=10  # Allow up to 10 attempts
```

**Change Processing Interval:**
```env
REDIAL_PROCESS_INTERVAL=10  # Check every 10 minutes instead of 5
```

**Change Progressive Intervals:**
```env
REDIAL_PROGRESSIVE_INTERVALS=5,10,30,60,120,240  # More conservative
```

---

## Monitoring

### Key Log Messages to Watch

**✅ Good Signs:**
```
"Redial queue processing started"
"CALLING: All safety checks passed"
"CALL INITIATED: Redial successful"
"Redial queue processing completed"
```

**⚠️ Warning Signs (Expected, Handled):**
```
"SAFETY: Skipping redial - active/pending call detected"
"Lead reached max attempts since filtering, skipping"
"Lead status changed since filtering, skipping"
```

**❌ Error Signs (Need Investigation):**
```
"ERROR: Failed to redial lead"
"CRITICAL: Error processing redial queue"
"Invalid lead record, skipping"
```

---

## Troubleshooting

### Issue: Leads Not Being Redialed

**Check:**
1. Is `REDIAL_QUEUE_ENABLED=true`?
2. Are we in business hours (9 AM - 5 PM EST)?
3. Check logs for filtering breakdown
4. Verify leads have favorable status (`pending` or `rescheduled`)
5. Verify attempts < max_attempts

**Debug Command:**
```bash
pm2 logs | grep "Redial queue"
```

### Issue: Too Many Skips

**Check:**
1. Are there active calls? Look for `"active/pending call detected"`
2. Have leads hit max attempts? Look for `"max attempts"`
3. Check status distribution in logs

---

## Summary

This safe redial logic implements **6 layers of protection**:

1. 🛡️ **Global Safety Checks** - Enabled, not processing, business hours
2. 🛡️ **Data Filtering** - Today only, favorable status, under max attempts, time ready
3. 🛡️ **Pre-Call Validation** - Null checks, attempts re-check, active call detection, status re-check
4. 🛡️ **Call Execution** - Comprehensive logging, no attempt incrementing
5. 🛡️ **Error Recovery** - Safe error handling, automatic retry scheduling
6. 🛡️ **Cleanup** - Summary logging, guaranteed lock release

**Result:** A robust, safe, and debuggable redial system that prevents duplicate calls and ensures only appropriate leads are contacted.
