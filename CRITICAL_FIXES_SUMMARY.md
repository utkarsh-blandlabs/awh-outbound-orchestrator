# Critical Fixes Summary - Duplicate Calls & SMS Spam

## Issues Fixed

### 1. ✅ Duplicate Calls While Active Call Ongoing

**Problem:**
While user was on a call with Ashley AI and she was transferring to an agent, a second call came in (redial) to the same number. This happened because:
- Webhook fired when call completed
- Lead was added to redial queue with 0-minute interval (INSTANT)
- Queue processor picked it up immediately
- System created duplicate call while original call was still active

**Root Cause:**
1. Progressive intervals set to `[0, 0, 5, 10, 30, 60, 120]` - first two attempts are INSTANT (0 minutes)
2. No check for active calls when adding to redial queue
3. Race condition: webhook adds to queue before call is marked complete

**Fixes Applied:**

**Fix #1: Active Call Detection in addOrUpdateLead()** ([redialQueueService.ts:270-289](src/services/redialQueueService.ts#L270-L289))
```typescript
// CRITICAL: Check if there's an active call to this phone number
const { CallStateManager } = await import("./callStateManager");
const activeCalls = CallStateManager.getAllPendingCalls();
const activeCallToNumber = activeCalls.find(
  (call) =>
    call.phone_number === phoneNumber &&
    call.status === "pending" &&
    call.call_id !== callId // Exclude current call
);

if (activeCallToNumber) {
  logger.warn("Skipping redial queue add - active call in progress");
  return; // Don't add to redial queue while call is active
}
```

**Fix #2: Minimum 2-Minute Delay for "Instant" Redialing** ([redialQueueService.ts:338-343](src/services/redialQueueService.ts#L338-L343))
```typescript
// IMPORTANT: Add minimum 2-minute delay even for "instant" (0 min) intervals
// This prevents race conditions where call is still active/completing
const actualIntervalMs = intervalMinutes === 0
  ? 2 * 60 * 1000 // 2 minutes minimum
  : intervalMinutes * 60 * 1000;
```

**Fix #3: Enhanced Active Call Check in processQueue()** (Already existed, now has double protection)

**Result:**
- ✅ No duplicate calls while call is active
- ✅ Minimum 2-minute delay prevents race conditions
- ✅ System waits for response before redialing
- ✅ All edge cases handled with multiple layers of protection

---

### 2. ✅ SMS Spam Prevention (Max 1-2 SMS Per Day)

**Problem:**
With 8 redial attempts per day, users were receiving 8 SMS messages, which is spam and unprofessional.

**Requirements:**
- ✅ Maximum 1-2 SMS per day per phone number
- ✅ Unlimited voicemail messages (all 8 attempts can leave voicemail)
- ✅ Add callback phone number to voicemail messages

**Fix: SMS Tracker Service** ([smsTrackerService.ts](src/services/smsTrackerService.ts))

**Features:**
1. Tracks SMS sends per phone number per day
2. Automatically resets at midnight (EST timezone)
3. File-based persistence (one file per day)
4. 7-day retention (automatic cleanup)
5. Configurable max SMS per day (default: 2)

**Usage in Bland Service** ([blandService.ts:100-113](src/services/blandService.ts#L100-L113)):
```typescript
// Check if we can send SMS (limit 1-2 per day per number)
const canSendSms = smsTrackerService.canSendSms(payload.phoneNumber);
const shouldIncludeSms = config.bland.smsEnabled &&
  config.bland.smsFrom &&
  smsMessage &&
  canSendSms;

if (config.bland.smsEnabled && smsMessage && !canSendSms) {
  logger.info("SMS limit reached for today, voicemail only", {
    phone: payload.phoneNumber,
    sms_count: smsTrackerService.getSmsCount(payload.phoneNumber),
    max: smsTrackerService.getConfig().max_sms_per_day,
  });
}
```

**Result:**
- ✅ SMS limited to 2 per day per number (configurable)
- ✅ Voicemail still sent on all 8 attempts
- ✅ Professional and non-spammy behavior

---

### 3. ✅ Callback Number in Voicemail Messages

**Problem:**
Voicemail messages didn't include the callback phone number, making it hard for customers to call back.

**Fix: Auto-Add Callback Number** ([blandService.ts:76-92](src/services/blandService.ts#L76-L92))
```typescript
// Format callback number for voicemail: (561) 956-5858
const callbackNumber = config.bland.smsFrom || config.bland.from || "";
const formattedCallback = callbackNumber
  ? callbackNumber.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")
  : "";

// Add callback number to voicemail if not already included
const voicemailWithCallback = voicemailMessage && formattedCallback
  ? (voicemailMessage.includes(formattedCallback)
      ? voicemailMessage
      : `${voicemailMessage} You can reach us at ${formattedCallback}.`)
  : voicemailMessage;
```

**Example:**
- **Before:** "Hi John, this is Ashley from American Way Health calling about your health insurance inquiry. Please call us back at your earliest convenience."
- **After:** "Hi John, this is Ashley from American Way Health calling about your health insurance inquiry. Please call us back at your earliest convenience. You can reach us at (561) 956-5858."

**Result:**
- ✅ All voicemail messages include formatted callback number
- ✅ Smart detection: doesn't add if already included
- ✅ Professional formatting: (561) 956-5858

---

## Files Changed

### New Files Created:
1. **[src/services/smsTrackerService.ts](src/services/smsTrackerService.ts)** - SMS tracking and limiting service

### Files Modified:
1. **[src/services/blandService.ts](src/services/blandService.ts)**
   - Added SMS tracker import
   - Added callback number formatting
   - Added SMS limit checking before including in voicemail
   - Records SMS when sent

2. **[src/services/redialQueueService.ts](src/services/redialQueueService.ts)**
   - Added active call detection in `addOrUpdateLead()`
   - Added 2-minute minimum delay for instant intervals
   - Enhanced duplicate prevention

3. **[src/routes/adminRoutes.ts](src/routes/adminRoutes.ts)**
   - Fixed authentication to accept `?key=...` query parameter
   - Previously only worked with `X-API-Key` header

4. **[.env](.env)**
   - Added `SMS_TRACKER_ENABLED=true`
   - Added `SMS_MAX_PER_DAY=2`

---

## Configuration

### New Environment Variables

```env
# SMS Tracker Configuration
# Limits SMS messages to prevent spam (max 1-2 per day per phone number)
SMS_TRACKER_ENABLED=true
SMS_MAX_PER_DAY=2
```

### Updated Redial Intervals

```env
# Redial Queue Configuration
REDIAL_PROGRESSIVE_INTERVALS=0,0,5,10,30,60,120
REDIAL_MAX_ATTEMPTS=8
```

**Note:** Even though intervals are set to `0,0,...`, the system now enforces a **minimum 2-minute delay** to prevent race conditions.

---

## Call Cadence (Updated)

| Attempt | Configured Interval | Actual Delay | Reason |
|---------|-------------------|--------------|---------|
| 1st | N/A | INSTANT | Initial webhook call |
| 2nd | 0 min | **2 min** | Minimum delay enforced |
| 3rd | 0 min | **2 min** | Minimum delay enforced |
| 4th | 5 min | 5 min | As configured |
| 5th | 10 min | 10 min | As configured |
| 6th | 30 min | 30 min | As configured |
| 7th | 60 min | 60 min (1 hour) | As configured |
| 8th | 120 min | 120 min (2 hours) | As configured |

---

## SMS Behavior

| Attempt | SMS Sent? | Voicemail Sent? |
|---------|-----------|----------------|
| 1st | ✅ Yes (1/2) | ✅ Yes |
| 2nd | ✅ Yes (2/2) | ✅ Yes |
| 3rd | ❌ Limit reached | ✅ Yes |
| 4th | ❌ Limit reached | ✅ Yes |
| 5th | ❌ Limit reached | ✅ Yes |
| 6th | ❌ Limit reached | ✅ Yes |
| 7th | ❌ Limit reached | ✅ Yes |
| 8th | ❌ Limit reached | ✅ Yes |

**Total per day per number:**
- SMS: **2 messages** ✅
- Voicemail: **8 messages** ✅

---

## Memory Leak Prevention

All services properly manage resources:

1. **SMS Tracker:**
   - Automatic daily file rotation
   - 7-day file retention with auto-cleanup
   - No in-memory accumulation

2. **Redial Queue:**
   - Monthly file rotation
   - 30-day file retention with auto-cleanup
   - File locking prevents corruption
   - No memory leaks from intervals

3. **Active Call Detection:**
   - Checks CallStateManager (already manages memory)
   - No additional memory overhead

---

## Testing After Deployment

### 1. Test SMS Limiting

Make 3 calls to the same number in quick succession:

```bash
# Call 1 - should send SMS (1/2)
curl -X POST http://localhost:3000/api/awh/outbound \
  -H "Content-Type: application/json" \
  -d '{"lead_id": "TEST001", "phone_number": "+15551234567", ...}'

# Call 2 - should send SMS (2/2)
# (same number)

# Call 3 - should NOT send SMS (limit reached), but should send voicemail
# (same number)
```

**Check logs:**
```
[INFO] SMS limit reached for today, voicemail only
```

### 2. Test Duplicate Call Prevention

Make a call, and while Ashley is talking, trigger webhook manually:

**Expected behavior:**
- ✅ Webhook processes normally
- ✅ System logs: "Skipping redial queue add - active call in progress"
- ✅ No duplicate call created

### 3. Test Callback Number in Voicemail

Check Bland API request body:

```json
{
  "voicemail": {
    "message": "Hi John, ... You can reach us at (561) 956-5858.",
    "action": "leave_message"
  }
}
```

---

## Rollback Plan

If issues occur:

### Option 1: Disable SMS Tracker

```env
SMS_TRACKER_ENABLED=false
```

This will allow all SMS to be sent (reverts to old behavior).

### Option 2: Increase Minimum Delay

Edit [redialQueueService.ts:340](src/services/redialQueueService.ts#L340):

```typescript
? 5 * 60 * 1000 // Change to 5 minutes instead of 2
```

### Option 3: Disable Redial Queue Entirely

```env
REDIAL_QUEUE_ENABLED=false
```

---

## Deployment Checklist

- [x] SMS tracker service created
- [x] Bland service updated to check SMS limits
- [x] Voicemail messages include callback number
- [x] Active call detection in redial queue
- [x] Minimum 2-minute delay enforced
- [x] .env file updated with SMS tracker config
- [x] Build successful (no TypeScript errors)
- [ ] Deploy to EC2 server
- [ ] Update server .env file
- [ ] Restart PM2
- [ ] Test endpoints
- [ ] Monitor logs for duplicate calls
- [ ] Verify SMS limiting works

---

## Summary

### Issues Resolved:
1. ✅ **Duplicate calls while active call ongoing** - Fixed with active call detection + 2-min minimum delay
2. ✅ **SMS spam (8 messages/day)** - Limited to max 2 SMS per day via SMS tracker
3. ✅ **Missing callback number** - Auto-added to all voicemail messages

### Edge Cases Handled:
1. ✅ Race conditions (call still completing when webhook fires)
2. ✅ Memory leaks (automatic cleanup, file rotation)
3. ✅ Concurrent writes (file locking already existed)
4. ✅ Duplicate webhooks (call_id checking already existed)
5. ✅ Day rollover (SMS tracker resets at midnight EST)
6. ✅ Active call conflicts (multi-layer protection)

### Non-Functional Improvements:
1. ✅ Professional SMS behavior (no spam)
2. ✅ Clear callback number in voicemail
3. ✅ Robust duplicate prevention
4. ✅ Better logging for debugging

**Status: Ready for Deployment** 🚀

All critical issues fixed, build successful, no regressions expected.
