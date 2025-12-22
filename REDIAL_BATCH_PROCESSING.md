# Redial Queue Batch Processing

## How Many Calls Are Processed At Once?

### Answer: **ALL ready leads are processed in a single batch**

There is **no batch size limit** - the redial queue processor will call ALL leads that pass the 4-stage filtering in one processing cycle.

---

## Processing Flow

### Every 5 Minutes (Configurable):

```
REDIAL_PROCESS_INTERVAL=5  # Check every 5 minutes
```

The queue processor runs and:

1. **Loads all records** from current month file
2. **Applies 4-stage filtering**:
   - ✅ Filter #1: Only today's records
   - ✅ Filter #2: Only favorable status (pending/rescheduled)
   - ✅ Filter #3: Only under max attempts (< 8)
   - ✅ Filter #4: Only time-ready (next_redial_timestamp passed)

3. **Processes ALL filtered leads** sequentially
4. **No batch size limit** - all ready leads are called

---

## Example Scenario

### Scenario: 100 Leads in Redial Queue

**After filtering:**
- Total records: 100
- Today only: 80 (created today)
- Favorable status: 60 (pending or rescheduled)
- Under max attempts: 50 (< 8 attempts)
- Time ready: 30 (next_redial_timestamp passed)

**Result:** **All 30 leads** will be called in this processing cycle

**Log Output:**
```
Redial queue ready leads identified {
  ready_to_dial: 30,
  breakdown: {
    total: 100,
    today_only: 80,
    favorable_status: 60,
    under_max_attempts: 50,
    time_ready: 30
  }
}

CALLING: All safety checks passed, initiating redial (lead 1/30)
CALLING: All safety checks passed, initiating redial (lead 2/30)
CALLING: All safety checks passed, initiating redial (lead 3/30)
...
CALLING: All safety checks passed, initiating redial (lead 30/30)

Redial queue processing completed {
  total_ready: 30,
  calls_made: 28,
  skipped: 2,
  errors: 0
}
```

---

## Rate Limiting

### Sequential Processing

Leads are processed **sequentially** (one at a time) to respect rate limits:

```typescript
// Process leads sequentially to respect rate limits
for (const lead of readyLeads) {
  // Safety checks
  // Make call
  // Next lead
}
```

**Why sequential?**
- Respects rate limiter (max 5 calls/second)
- Allows active call detection to work properly
- Prevents overwhelming Bland API

### Rate Limiter Configuration

```env
RATE_LIMITER_ENABLED=true
RATE_LIMITER_MAX_CALLS_PER_SECOND=5
RATE_LIMITER_SAME_NUMBER_INTERVAL_MS=10000
```

**What this means:**
- Max 5 calls per second (enforced by rate limiter)
- Same number can't be called within 10 seconds
- If 30 leads are ready, they'll be called over ~6 seconds (30 ÷ 5 = 6)

---

## Why No Batch Limit?

### Design Rationale:

1. **Progressive intervals handle volume naturally**
   - First 2 attempts: INSTANT (but 2-min minimum enforced)
   - Later attempts: Spread over hours (5min, 10min, 30min, 60min, 120min)
   - This naturally staggers when leads become "ready"

2. **Business hours restriction**
   - Only processes during 9 AM - 5 PM EST
   - Limited time window prevents massive batches

3. **Today-only filtering**
   - Only processes leads created today
   - Prevents accumulation of old leads

4. **Active call detection**
   - Skips leads with active calls
   - Further reduces batch size in practice

5. **Rate limiting**
   - Sequential processing + rate limiter prevents API overload
   - Even 100 ready leads would be called over ~20 seconds

---

## Typical Batch Sizes in Production

Based on the filtering logic, typical batch sizes are:

### Morning (9 AM - 10 AM):
- **First processing cycle**: 0-5 leads
  - Only leads from yesterday that rolled over
  - Very few leads "time ready"

### Mid-Day (10 AM - 3 PM):
- **Each 5-min cycle**: 5-20 leads
  - New leads coming in from Convoso
  - 2nd and 3rd attempts (instant retries)
  - Some 4th attempts (5-min delay)

### Afternoon (3 PM - 5 PM):
- **Each 5-min cycle**: 10-30 leads
  - Later attempts (30min, 60min, 120min delays)
  - Accumulation throughout the day
  - Peak redialing period

### After Hours (5 PM - 9 AM):
- **No processing** - Scheduler inactive (business hours only)

---

## Monitoring Batch Sizes

### Check Logs for Batch Info:

```bash
pm2 logs | grep "ready_to_dial"
```

**Example output:**
```
Redial queue ready leads identified { ready_to_dial: 15 }
Redial queue ready leads identified { ready_to_dial: 8 }
Redial queue ready leads identified { ready_to_dial: 22 }
```

### Admin API Endpoint:

```bash
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/redial-queue/records | jq '.records | length'
```

This shows total records in queue (not just ready ones).

---

## What If Batch Gets Too Large?

### Scenario: 200+ Leads Ready

If for some reason 200+ leads become "ready" at once (unlikely due to filtering):

**What happens:**
1. ✅ All 200 are processed sequentially
2. ✅ Rate limiter enforces 5 calls/second
3. ✅ Takes ~40 seconds to complete all calls
4. ✅ Active call detection prevents duplicates
5. ✅ Logs show all 200 calls initiated

**No data loss, no errors, just slower processing**

### If You Want to Add a Batch Limit:

You could add this configuration:

```env
# Optional: Max leads to process per cycle
REDIAL_MAX_BATCH_SIZE=50
```

Then modify the code:

```typescript
// Limit batch size if configured
const batchSize = parseInt(process.env["REDIAL_MAX_BATCH_SIZE"] || "0");
const leadsToProcess = batchSize > 0
  ? readyLeads.slice(0, batchSize)
  : readyLeads;

for (const lead of leadsToProcess) {
  // Process lead
}
```

**Currently NOT implemented** - no batch limit exists.

---

## Summary

| Question | Answer |
|----------|--------|
| **How many calls per cycle?** | ALL ready leads (no limit) |
| **How are they processed?** | Sequentially (one at a time) |
| **What limits the batch size?** | Filtering (today, favorable, <8 attempts, time ready) |
| **What if batch is huge?** | Still processes all, just takes longer (5 calls/sec) |
| **Typical batch sizes?** | 5-30 leads per 5-min cycle |
| **Can we add a limit?** | Yes, but not currently implemented |

**Current design:** Process ALL ready leads, rely on natural filtering to keep batches manageable.

---

## Code Reference

**Processing loop:** [redialQueueService.ts:594-694](src/services/redialQueueService.ts#L594-L694)

```typescript
// Process leads sequentially to respect rate limits
let processedCount = 0;
let skippedCount = 0;
let errorCount = 0;

for (const lead of readyLeads) {  // ← ALL ready leads, no limit
  try {
    // Safety checks
    // Make call
    processedCount++;
  } catch (error) {
    errorCount++;
  }
}

logger.info("Redial queue processing completed", {
  total_ready: readyLeads.length,
  calls_made: processedCount,
  skipped: skippedCount,
  errors: errorCount,
});
```

**No `break` statement, no batch limit - processes all leads in `readyLeads` array.**
