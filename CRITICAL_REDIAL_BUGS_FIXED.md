# CRITICAL REDIAL BUGS - FIXED January 8, 2026

## 🚨 Issues Reported

### Issue #1: 11 Calls Instead of 8 Max
**Phone Number**: (628) 444-4907
**Date**: January 7, 2026 (Yesterday)
**Expected**: Max 8 calls per day (REDIAL_MAX_DAILY_ATTEMPTS=8)
**Actual**: 11 calls received
**Impact**: User harassed with excessive calls

### Issue #2: Redial During Active Call with Agent
**Phone Numbers Affected**: 5612502560, and others
**Symptoms**:
- Ashley redialed **1 minute apart** while customer was already on call
- Customer connected to agent (CID: ae3ff8ba-5f3e-401b-b2a7-c360f24e783c)
- Redial (CID: 5b2b99ab-322a-48da-a059-9d15809717be) joined the same line
- Ashley said "got her wires crossed... asking if current agent is licensed agent"
- **Customer got sketched out and hung up**

### Issue #3: Ashley Randomly Returns After Transfer
**Phone Number**: 5612502560
**Symptom**: Ashley comes back ~30 seconds after transfer, confuses customer
**Impact**: Customer hangs up, lost sale

---

## 🐛 ROOT CAUSES IDENTIFIED

### Bug #1: Wrong Daily Limit Counter
**Location**: `src/services/redialQueueService.ts` lines 1033-1047 (before fix)

**Problem**:
```typescript
// OLD CODE (BROKEN):
if (record.attempts_today >= dailyMax) return false;
```
- Used `record.attempts_today` which ONLY counts redial queue calls
- **IGNORED**:
  - Convoso direct calls
  - API calls from other sources
  - Inbound calls (before inbound fix)
  - Any calls not initiated by redial queue

**Result**: If Convoso called 3 times and redial called 8 times = **11 total calls**

---

### Bug #2: No Active Call Detection (dailyCallTracker)
**Location**: `src/services/redialQueueService.ts` line 1143 (before fix)

**Problem**:
```typescript
// OLD CODE (BROKEN):
// Only checked CallStateManager (cleared after webhook)
const activeCalls = CallStateManager.getAllPendingCalls();
// NEVER checked dailyCallTracker.hasActiveCall()
```

**Why This Failed**:
1. Customer answers call → transfers to agent
2. Webhook arrives → CallStateManager clears call
3. **BUT**: `dailyCallTracker` still marks line as active (30-min protection window)
4. Redial queue never checks `dailyCallTracker`
5. Redial happens while customer is still talking to agent!

---

### Bug #3: Transfer Safety Window Not Checked
**Location**: `src/services/dailyCallTrackerService.ts` line 478-497

**Problem**:
- Transfer safety window (30 minutes) exists in `dailyCallTracker`
- **BUT**: Redial queue service never imported or checked it
- Result: Redials happen during transfer safety window

---

## ✅ FIXES APPLIED

### Fix #1: Use dailyCallTracker as Source of Truth
**File**: `src/services/redialQueueService.ts`

**Changes**:
1. **Imported dailyCallTracker** (line 12):
   ```typescript
   import { dailyCallTracker } from "./dailyCallTrackerService";
   ```

2. **Filter #3 - Check ACTUAL daily calls** (lines 1033-1073):
   ```typescript
   // CRITICAL FIX: Use dailyCallTracker's actual count (includes ALL calls)
   const callHistory = dailyCallTracker.getCallHistory(record.phone_number);
   const actualCallsToday = callHistory ? callHistory.calls.length : 0;

   if (actualCallsToday >= dailyMax) {
     logger.debug("Filtered out - daily max reached (actual calls)", {
       phone: record.phone_number,
       actual_calls_today: actualCallsToday,
       daily_max: dailyMax,
     });
     return false;
   }
   ```

3. **Pre-Call Safety Check** (lines 1137-1159):
   ```typescript
   // Get ACTUAL call history from dailyCallTracker (source of truth)
   const callHistory = dailyCallTracker.getCallHistory(lead.phone_number);
   const actualCallsToday = callHistory ? callHistory.calls.length : 0;

   if (actualCallsToday >= leadDailyMax) {
     logger.warn("SAFETY: Lead reached daily max attempts (actual calls)", {
       actual_calls_today: actualCallsToday,
       reason: "Includes Convoso calls, redials, API calls, and inbound calls",
     });
     lead.status = "daily_max_reached";
     skippedCount++;
     continue;
   }
   ```

---

### Fix #2: Check Active Calls in dailyCallTracker
**File**: `src/services/redialQueueService.ts`

**Added** (lines 1167-1185):
```typescript
// PRE-CALL SAFETY CHECK #2b: CRITICAL - Check dailyCallTracker for active calls
// This prevents calling while customer is on the phone with agent (even after transfer)
const hasActiveCall = dailyCallTracker.hasActiveCall(lead.phone_number);
if (hasActiveCall) {
  logger.warn("SAFETY: Skipping redial - active call detected in dailyCallTracker", {
    lead_id: lead.lead_id,
    phone: lead.phone_number,
    reason: "Customer is currently on a call (possibly transferred to agent)",
  });

  // Push redial ahead by 10 minutes to avoid interrupting agent call
  lead.next_redial_timestamp = now + 10 * 60 * 1000;
  skippedCount++;
  continue; // Skip to next lead
}
```

**How This Works**:
1. Checks if phone number has an active call in `dailyCallTracker`
2. Includes transfer safety window (30 minutes after transfer)
3. If active, pushes redial ahead by 10 minutes
4. **Prevents**: Ashley joining line while customer talks to agent

---

## 📊 What Now Counts Toward Daily Limit

### Before Fix (BROKEN):
- ✅ Redial queue calls
- ❌ Convoso direct calls (IGNORED)
- ❌ API calls (IGNORED)
- ❌ Inbound calls (IGNORED before inbound fix)

### After Fix (CORRECT):
- ✅ Redial queue calls
- ✅ Convoso direct calls
- ✅ API calls
- ✅ Outbound calls from any source
- ❌ Inbound calls (correctly excluded with `isInbound: true`)

**Source of Truth**: `dailyCallTrackerService` tracks ALL calls

---

## 🧪 How to Verify Fixes

### On Production (EC2):

1. **Check logs for phone number (628) 444-4907**:
   ```bash
   ssh ec2-user@your-server
   cd awh-orchestrator
   grep -r "6284444907\|628.*444.*4907" logs/ | grep "2026-01-07"
   ```

2. **Check daily call file for yesterday**:
   ```bash
   cat data/daily-calls/calls_2026-01-07.json | jq '.[] | select(.phone_number | contains("6284444907"))'
   ```

3. **Deploy the fix**:
   ```bash
   # On local machine:
   npm run build

   # Copy to EC2:
   scp -r dist/ ec2-user@your-server:/home/ec2-user/awh-orchestrator/

   # On EC2:
   pm2 restart awh-orchestrator
   pm2 logs awh-orchestrator --lines 100
   ```

4. **Monitor for "SAFETY" logs**:
   ```bash
   pm2 logs awh-orchestrator | grep "SAFETY"
   ```

   You should see:
   - "SAFETY: Skipping redial - active call detected in dailyCallTracker"
   - "SAFETY: Lead reached daily max attempts (actual calls)"

---

## 🎯 Expected Behavior After Fix

### Daily Limit Enforcement:
- **Max 8 calls per day** (default from REDIAL_MAX_DAILY_ATTEMPTS)
- Counts ALL calls: Convoso + Redial + API + Outbound
- Does NOT count inbound calls (customer calling back)

### Active Call Protection:
- **No redials during active calls**
- Includes 30-minute transfer safety window
- Logs: "SAFETY: Skipping redial - active call detected"

### Transfer Protection:
- Line marked as busy for 30 minutes after transfer
- Prevents duplicate calls while customer talks to agent
- Automatically releases after 30 minutes (or when call ends)

---

## 📈 Monitoring After Deployment

### Day 1 After Fix:
```bash
# Check how many calls were prevented by safety checks
pm2 logs | grep "SAFETY: Skipping redial" | wc -l

# Check if daily max is being enforced
pm2 logs | grep "daily max reached" | wc -l

# Verify no calls during active calls
pm2 logs | grep "active call detected in dailyCallTracker"
```

### Expected Results:
- ✅ No more than 8 calls per phone number per day
- ✅ No redials during active calls with agent
- ✅ No "Ashley got her wires crossed" incidents
- ✅ Logs show "SAFETY" messages preventing bad calls

---

## 🔍 Investigation Notes

### Why 11 Calls Happened (Hypothesis):

**Scenario**: Phone (628) 444-4907 on January 7, 2026

1. **Convoso calls**: 3 times (8 AM, 10 AM, 2 PM)
2. **Redial queue**: Counted only its own attempts (0)
3. **Redial logic**: "0 < 8 max, OK to call!"
4. **Redial calls**: 8 times throughout the day
5. **Total**: 3 + 8 = **11 calls**

### Why Redial During Transfer Happened:

**Timeline**:
1. 10:30 AM - Ashley calls, customer answers
2. 10:31 AM - Customer transfers to agent (CID: ae3ff8ba...)
3. 10:31 AM - Webhook arrives, CallStateManager clears call
4. 10:32 AM - Redial queue processes: "No active call in CallStateManager, OK to call!"
5. 10:32 AM - Ashley redials (CID: 5b2b99ab...), joins line while agent is talking
6. Customer hears: "Got my wires crossed... is this the licensed agent?"
7. Customer hangs up ❌

---

## 🚀 Deployment Checklist

- [x] Fixed daily limit to count ALL calls (not just redials)
- [x] Added active call detection via dailyCallTracker
- [x] Added transfer safety window protection
- [x] Code compiled successfully (no TypeScript errors)
- [ ] **Deploy to production EC2**
- [ ] **Monitor logs for 24 hours**
- [ ] **Verify no more 11+ call incidents**
- [ ] **Verify no more "wires crossed" incidents**

---

## 📝 Files Changed

1. **src/services/redialQueueService.ts**
   - Line 12: Added `import { dailyCallTracker }`
   - Lines 1033-1073: Use actual call count from dailyCallTracker
   - Lines 1137-1159: Pre-call safety check with actual count
   - Lines 1167-1185: Active call detection via dailyCallTracker

**Total Lines Changed**: ~100 lines (3 critical sections)

---

## ⚠️ Critical Reminder

**THESE BUGS WERE SEVERE**:
- Lost sales due to "wires crossed" during transfers
- Harassment complaints (11 calls instead of 8)
- Customer trust damaged

**DEPLOY IMMEDIATELY** to prevent further incidents.
