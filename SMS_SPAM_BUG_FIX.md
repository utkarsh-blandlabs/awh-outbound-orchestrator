# SMS Spam Bug Fix - 40 Duplicate Messages

## Problem
User received 40 duplicate SMS messages with the same content:
```
"Hey utkarsh, your healthcare plan request has been received! We will be calling you shortly..."
```

## Root Cause

The SMS tracker is **silently failing to save to disk**:

1. `recordSmsSent()` updates the in-memory Map
2. Calls `saveRecords()` to persist to disk
3. **If save fails, error is caught and logged but NOT thrown**
4. Code continues as if everything is fine
5. On next call, `canSendSms()` checks the Map (which is still in memory)
6. **BUT** if server restarts or date rolls over, Map is cleared and not reloaded
7. SMS tracker always returns "can send = true"
8. SMS included in EVERY call's voicemail config
9. Bland.ai sends SMS on EVERY voicemail detection
10. Result: 40 duplicate SMS

## Files Affected

**File**: `src/services/smsTrackerService.ts`

### Lines 122-142 (saveRecords method):
```typescript
private async saveRecords(): Promise<void> {
  try {
    // ... save logic ...
    logger.debug("Saved SMS tracker records");
  } catch (error: any) {
    logger.error("Failed to save SMS tracker records", {
      error: error.message,
    });
    // ❌ ERROR IS CAUGHT BUT NOT THROWN!
  }
}
```

### Lines 184-221 (recordSmsSent method):
```typescript
async recordSmsSent(phoneNumber: string): Promise<void> {
  // ... update Map ...
  await this.saveRecords();  // ❌ Fails silently!

  logger.info("Recorded SMS sent");  // ✅ Logs success even if save failed!
}
```

## The Fix

Make errors visible and fail fast if SMS tracker can't save.
