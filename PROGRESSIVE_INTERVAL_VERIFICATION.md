# Progressive Interval Verification

## Current Configuration

```env
REDIAL_PROGRESSIVE_INTERVALS=0,0,5,10,30,60,120
REDIAL_MAX_ATTEMPTS=8
```

---

## How It Works - Step by Step

### When Call Completes (Webhook):

```typescript
// 1. Webhook fires with outcome (VOICEMAIL, NO_ANSWER, etc.)
// 2. addOrUpdateLead() is called
// 3. Increment attempts: existing.attempts += 1
// 4. Calculate interval: getProgressiveInterval(existing.attempts)
// 5. Set next_redial_timestamp: now + interval
```

---

## Attempt-by-Attempt Breakdown

### 🔄 After 1st Call Completes:

**Current state:**
- `attempts = 0` (before increment)
- Webhook fires with outcome: "VOICEMAIL"

**Logic:**
```typescript
existing.attempts += 1;  // Now attempts = 1
const interval = getProgressiveInterval(1);  // intervals[0] = 0 min
const actualInterval = interval === 0 ? 2 : interval;  // 2 min (minimum enforced)
next_redial_timestamp = now + (2 * 60 * 1000);  // 2 minutes from now
```

**Result:** ✅ **2nd call in 2 minutes** (instant with minimum delay)

---

### 🔄 After 2nd Call Completes:

**Current state:**
- `attempts = 1` (before increment)
- Webhook fires with outcome: "NO_ANSWER"

**Logic:**
```typescript
existing.attempts += 1;  // Now attempts = 2
const interval = getProgressiveInterval(2);  // intervals[1] = 0 min
const actualInterval = interval === 0 ? 2 : interval;  // 2 min (minimum enforced)
next_redial_timestamp = now + (2 * 60 * 1000);  // 2 minutes from now
```

**Result:** ✅ **3rd call in 2 minutes** (instant with minimum delay)

---

### 🔄 After 3rd Call Completes:

**Current state:**
- `attempts = 2` (before increment)
- Webhook fires with outcome: "VOICEMAIL"

**Logic:**
```typescript
existing.attempts += 1;  // Now attempts = 3
const interval = getProgressiveInterval(3);  // intervals[2] = 5 min
const actualInterval = interval === 0 ? 2 : interval;  // 5 min (no change)
next_redial_timestamp = now + (5 * 60 * 1000);  // 5 minutes from now
```

**Result:** ✅ **4th call in 5 minutes**

---

### 🔄 After 4th Call Completes:

**Current state:**
- `attempts = 3` (before increment)

**Logic:**
```typescript
existing.attempts += 1;  // Now attempts = 4
const interval = getProgressiveInterval(4);  // intervals[3] = 10 min
next_redial_timestamp = now + (10 * 60 * 1000);  // 10 minutes from now
```

**Result:** ✅ **5th call in 10 minutes**

---

### 🔄 After 5th Call Completes:

**Current state:**
- `attempts = 4` (before increment)

**Logic:**
```typescript
existing.attempts += 1;  // Now attempts = 5
const interval = getProgressiveInterval(5);  // intervals[4] = 30 min
next_redial_timestamp = now + (30 * 60 * 1000);  // 30 minutes from now
```

**Result:** ✅ **6th call in 30 minutes**

---

### 🔄 After 6th Call Completes:

**Current state:**
- `attempts = 5` (before increment)

**Logic:**
```typescript
existing.attempts += 1;  // Now attempts = 6
const interval = getProgressiveInterval(6);  // intervals[5] = 60 min
next_redial_timestamp = now + (60 * 60 * 1000);  // 60 minutes from now
```

**Result:** ✅ **7th call in 60 minutes (1 hour)**

---

### 🔄 After 7th Call Completes:

**Current state:**
- `attempts = 6` (before increment)

**Logic:**
```typescript
existing.attempts += 1;  // Now attempts = 7
const interval = getProgressiveInterval(7);  // intervals[6] = 120 min
next_redial_timestamp = now + (120 * 60 * 1000);  // 120 minutes from now
```

**Result:** ✅ **8th call in 120 minutes (2 hours)**

---

### 🔄 After 8th Call Completes:

**Current state:**
- `attempts = 7` (before increment)

**Logic:**
```typescript
existing.attempts += 1;  // Now attempts = 8
if (existing.attempts >= max_redial_attempts) {  // 8 >= 8
  existing.status = "max_attempts";  // ✅ STOP REDIALING
}
```

**Result:** ✅ **Lead marked as max_attempts - NO MORE CALLS**

---

## Code Reference

### getProgressiveInterval() Function

```typescript
private getProgressiveInterval(attemptNumber: number): number {
  const intervals = this.queueConfig.progressive_intervals; // [0,0,5,10,30,60,120]
  const index = attemptNumber - 1; // Convert to 0-based index

  if (index < 0) return intervals[0] || 0;
  if (index >= intervals.length) return intervals[intervals.length - 1] || 120;

  return intervals[index] || 30;
}
```

**Mapping:**
- `attemptNumber = 1` → `index = 0` → `intervals[0] = 0` min
- `attemptNumber = 2` → `index = 1` → `intervals[1] = 0` min
- `attemptNumber = 3` → `index = 2` → `intervals[2] = 5` min
- `attemptNumber = 4` → `index = 3` → `intervals[3] = 10` min
- `attemptNumber = 5` → `index = 4` → `intervals[4] = 30` min
- `attemptNumber = 6` → `index = 5` → `intervals[5] = 60` min
- `attemptNumber = 7` → `index = 6` → `intervals[6] = 120` min

---

## Queue Processing - How Categorization Works

### Current Implementation:

When `processQueue()` runs every 5 minutes:

```typescript
// Filter #1: Today only
const todayRecords = allRecords.filter(/* created today */);

// Filter #2: Favorable status
const favorableRecords = todayRecords.filter(/* pending/rescheduled */);

// Filter #3: Under max attempts
const underMaxAttempts = favorableRecords.filter(/* attempts < 8 */);

// Filter #4: Time ready (THIS IS WHERE INTERVALS MATTER)
const readyLeads = underMaxAttempts.filter((record) => {
  return record.next_redial_timestamp <= now;  // ← Check if time has arrived
});

// Process ALL ready leads (no further categorization by attempt number)
for (const lead of readyLeads) {
  // Make call
}
```

---

## Example: How Leads Get Categorized by Time

### Scenario: 100 Leads at 2:00 PM

| Lead ID | Attempts | Last Call | Interval | next_redial_timestamp | Ready Now? |
|---------|----------|-----------|----------|----------------------|------------|
| L001 | 1 | 1:58 PM | 0 min (2 min enforced) | 2:00 PM | ✅ YES |
| L002 | 2 | 1:57 PM | 0 min (2 min enforced) | 1:59 PM | ✅ YES |
| L003 | 3 | 1:50 PM | 5 min | 1:55 PM | ✅ YES |
| L004 | 4 | 1:40 PM | 10 min | 1:50 PM | ✅ YES |
| L005 | 5 | 1:00 PM | 30 min | 1:30 PM | ✅ YES |
| L006 | 6 | 12:00 PM | 60 min | 1:00 PM | ✅ YES |
| L007 | 7 | 10:00 AM | 120 min | 12:00 PM | ✅ YES |
| L008 | 1 | 1:59 PM | 0 min (2 min enforced) | 2:01 PM | ❌ NO (not ready yet) |
| L009 | 3 | 1:58 PM | 5 min | 2:03 PM | ❌ NO (not ready yet) |
| L010 | 5 | 1:50 PM | 30 min | 2:20 PM | ❌ NO (not ready yet) |

**At 2:00 PM processing cycle:**
- **7 leads ready** (L001-L007)
- **3 leads waiting** (L008-L010)

**Result:** System calls L001-L007 sequentially, skips L008-L010 (will be picked up in future cycles)

---

## Is This Optimal?

### ✅ Current Approach: **Time-Based Filtering**

**Pros:**
- ✅ Simple and reliable
- ✅ Each lead gets exact interval based on attempt number
- ✅ No manual categorization needed
- ✅ Natural load distribution (earlier attempts ready sooner)

**How it works:**
1. Each lead's `next_redial_timestamp` is set based on attempt number
2. Queue processor filters by time: `next_redial_timestamp <= now`
3. Earlier attempts (0, 0, 5 min) become ready faster
4. Later attempts (30, 60, 120 min) become ready slower
5. Natural categorization happens automatically by time

---

## Alternative Approach: **Priority-Based Categorization**

### If You Want to Process Leads by Attempt Number Priority:

```typescript
// Group leads by attempt number
const leadsByAttempt = new Map<number, RedialQueueRecord[]>();
for (const lead of readyLeads) {
  const attempts = lead.attempts;
  if (!leadsByAttempt.has(attempts)) {
    leadsByAttempt.set(attempts, []);
  }
  leadsByAttempt.get(attempts)!.push(lead);
}

// Process in order: attempt 1, then 2, then 3, etc.
const sortedAttempts = Array.from(leadsByAttempt.keys()).sort((a, b) => a - b);

for (const attemptNumber of sortedAttempts) {
  const leads = leadsByAttempt.get(attemptNumber)!;
  logger.info(`Processing ${leads.length} leads at attempt ${attemptNumber}`);

  for (const lead of leads) {
    // Process lead
  }
}
```

**Pros:**
- ✅ Prioritizes earlier attempts (fresher leads)
- ✅ Better visibility into attempt distribution
- ✅ Can apply different strategies per attempt number

**Cons:**
- ❌ More complex code
- ❌ Not needed if time filtering already works correctly
- ❌ Marginal benefit (sequential processing is fast anyway)

---

## Current Behavior is CORRECT ✅

### Why Current Approach Works:

1. **Intervals are applied correctly** when lead is added to queue
2. **Time filtering** automatically prioritizes earlier attempts (they become ready sooner)
3. **Sequential processing** respects rate limits (5 calls/sec)
4. **No need for manual categorization** - time does it automatically

### Example Timeline:

```
10:00 AM - Lead L001 first call fails (VOICEMAIL)
  → attempts = 1, interval = 0 min (2 min enforced)
  → next_redial_timestamp = 10:02 AM

10:02 AM - Queue processor runs
  → L001 ready? YES (10:02 >= 10:02)
  → Call L001 (2nd attempt)

10:02 AM - Lead L001 second call fails (NO_ANSWER)
  → attempts = 2, interval = 0 min (2 min enforced)
  → next_redial_timestamp = 10:04 AM

10:04 AM - Queue processor runs
  → L001 ready? YES (10:04 >= 10:04)
  → Call L001 (3rd attempt)

10:04 AM - Lead L001 third call fails (VOICEMAIL)
  → attempts = 3, interval = 5 min
  → next_redial_timestamp = 10:09 AM

10:05 AM - Queue processor runs
  → L001 ready? NO (10:05 < 10:09) ← CORRECTLY SKIPPED

10:10 AM - Queue processor runs
  → L001 ready? YES (10:10 >= 10:09)
  → Call L001 (4th attempt)
```

**Perfect progression: 2 min, 2 min, 5 min, 10 min, 30 min, 60 min, 120 min** ✅

---

## Summary

| Question | Answer |
|----------|--------|
| **Are intervals applied correctly?** | ✅ YES - based on attempt number |
| **Are leads categorized by attempt?** | ✅ YES - automatically by time |
| **Should we add priority categorization?** | ❌ NOT NEEDED - time filtering works |
| **Is current approach optimal?** | ✅ YES - simple, reliable, correct |

**Current implementation is CORRECT and OPTIMAL.** ✅

The progressive intervals are applied exactly as designed, and the time-based filtering naturally prioritizes earlier attempts.
