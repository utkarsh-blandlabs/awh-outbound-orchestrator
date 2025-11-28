# Architecture Decision: Synchronous vs Async Webhooks

## Current Implementation: SYNCHRONOUS

The webhook connection **stays open** until the entire orchestration completes.

```
Convoso → POST /webhook
            ↓
         [Connection STAYS OPEN]
            ↓
         Step 1: Get/Create Lead (2s)
            ↓
         Step 2: Trigger Bland Call (2s)
            ↓
         Step 3: Log Call (2s)
            ↓
         Step 4: WAIT for Transcript (30s - 5min) ⏰
            ↓
         Step 5: Update Lead (2s)
            ↓
         Return Final Result
            ↓
         [Connection CLOSES]
```

**Total time:** 30 seconds to 5 minutes per webhook

## Why Synchronous?

### 1. **Matches Zapier Behavior**
Zapier executions are synchronous - they complete all steps before finishing. This is what Convoso expects.

### 2. **Convoso Gets Immediate Feedback**
Convoso receives the final result (success/failure, outcome, transcript) in the same HTTP response.

### 3. **Simpler Integration**

No need for:

- Callback webhooks back to Convoso
- Polling mechanisms
- Result storage/retrieval

### 4. **Guaranteed Processing Order**

Each request processes completely before the next one starts (if needed).

## Tradeoffs & Considerations

### 1. **Connection Timeout Risk**

**Problem:** If Bland takes > 10 minutes, the connection will timeout.

**Mitigation:**

- Server timeout set to 10 minutes (600 seconds)
- Bland polling timeout set to 5 minutes max
- If call takes longer, it fails gracefully

**Solution if needed:**
```typescript
// In config.ts, you can adjust:
BLAND_POLL_MAX_ATTEMPTS=120  // 10 minutes instead of 5
```

### 2. **Concurrent Request Handling**

**How many concurrent connections can Node.js handle?**

Node.js (with Express) can handle:

- **Default:** ~100-200 concurrent long-lived connections
- **With tuning:** 1,000+ concurrent connections
- **Per request:** Each request uses ~1 connection + minimal memory

**For AWH volume (~100+ calls/day):**

- Peak concurrent = ~5-10 requests at once (assuming 2-minute average)
- **No problem at all**

**If you need more:**

- Increase Node.js max connections: `server.maxConnections = 1000`
- Use clustering (multiple Node processes)
- Add load balancer

### 3. **Failure Recovery**

**What if connection drops mid-processing?**

Current behavior:

1. Lead gets created
2. Call gets initiated
3. Connection drops [X]
4. Convoso doesn't get result
5. But call still completes in Bland
6. Transcript gets lost

**Solution:** Add idempotency + retry logic (see below)

---

## Recommended Configuration

### For AWH's Volume (100+ calls/day):

**Current synchronous approach is FINE**
**Why:**

- Peak concurrent: 5-10 requests
- Node.js can handle 100+ easily
- Simple to debug and maintain
- Matches Zapier behavior

### If Volume Increases (1,000+ calls/day):

Switch to **Bland Webhooks** (Option A)

---

## Connection Capacity Analysis

### Node.js Connection Limits

**Single Node.js process:**
```
Max concurrent connections: ~1,000 (default)
Per connection memory: ~10 MB
Max with 8GB RAM: ~800 concurrent
```

**With current implementation:**
```
Average request duration: 2 minutes
Requests per hour: 30
Peak concurrent: ~1 (30 requests / 30 intervals per hour)
```

**At 1,000 calls/day:**
```
Calls per hour: ~42
Average duration: 2 minutes
Peak concurrent: ~2-3
```

---

## 📝 Summary

| Approach | Response Time | Concurrent Capacity | Complexity | Best For |
|----------|---------------|---------------------|------------|----------|
| **Synchronous (Current)** | 30s - 5min  | 100-1,000 | Low | < 1,000/day |
| **Bland Webhooks** | < 5s | Unlimited | Medium | Any volume |
| **Queue-Based** | < 1s | Unlimited | High | > 10,000/day |

**For AWH:** Synchronous is perfect for now.

**For scale:** Switch to Bland webhooks when volume increases.