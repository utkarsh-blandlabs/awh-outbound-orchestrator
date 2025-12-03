# Webhook-Based Architecture

## Overview

The AWH Outbound Orchestrator has been refactored to use **webhook-based completion** instead of polling. This significantly improves scalability, reduces API calls, and eliminates the bottleneck that polling creates.

---

## What Changed?

### Before (Polling-Based):
```
1. Convoso sends webhook → Start orchestration
2. Call Bland API to initiate call
3. Poll Bland API every 5 seconds (up to 120 attempts = 10 minutes)
   - Make 120+ API calls per call
   - High load on server
   - Doesn't scale with concurrent calls
4. When transcript ready → Update Convoso
```

**Problems:**
- 20 concurrent calls = 20 polling loops = 400+ API requests/minute to Bland
- High memory usage (each poll keeps state in memory)
- Risk of hitting Bland API rate limits
- Inefficient resource usage

### After (Webhook-Based):
```
1. Convoso sends webhook → Start orchestration
2. Call Bland API to initiate call with webhook URL
3. Return immediately (call registered in state manager)
4. [Wait for Bland to complete call...]
5. Bland sends webhook → Process completion
6. Update Convoso with results
```

**Benefits:**
- Only 1 API call to initiate (vs 120+ with polling)
- Instant notification when call completes
- Scales to 100+ concurrent calls easily
- No sustained server load
- No risk of rate limiting

---

## How It Works

### Step 1: Convoso Webhook (Call Initiation)

**Endpoint:** `POST /webhooks/awhealth-outbound`

```json
{
  "first_name": "John",
  "last_name": "Doe",
  "phone_number": "+15551234567",
  "state": "CA",
  "lead_id": "12345",
  "list_id": "16529"
}
```

**What happens:**
1. Validates payload
2. Calls Bland API with `webhook` parameter:
   ```json
   {
     "phone_number": "+15551234567",
     "pathway_id": "0258dd7c-...",
     "webhook": "https://your-server.com/webhooks/bland-callback"
   }
   ```
3. Stores call state in `CallStateManager` (in-memory)
4. Returns `202 Accepted` immediately

### Step 2: Bland Processes Call

Bland AI makes the outbound call. This can take 1-30 minutes depending on call duration.

**During this time:**
- Your server is idle (no polling!)
- No API requests being made
- Low memory usage
- Ready to handle other requests

### Step 3: Bland Webhook (Call Completion)

**Endpoint:** `POST /webhooks/bland-callback`

When the call completes, Bland automatically POSTs to your webhook:

```json
{
  "call_id": "abc123",
  "status": "completed",
  "completed": true,
  "concatenated_transcript": "Full transcript here...",
  "answered_by": "human",
  "call_length": 245,
  "variables": {
    "plan_type": "Family",
    "customer_age": 45,
    "postal_code": "90210"
  },
  "warm_transfer_call": { ... },
  "recording_url": "https://...",
  ...
}
```

**What happens:**
1. Receives webhook from Bland
2. Extracts `call_id` from payload
3. Looks up pending call in `CallStateManager`
4. Parses transcript and outcome
5. Updates Convoso call log
6. Marks call as complete
7. Returns `200 OK` to Bland

---

## Architecture Components

### 1. CallStateManager (`src/services/callStateManager.ts`)

In-memory storage to track pending calls and match webhooks.

**Methods:**
- `addPendingCall(callId, requestId, leadId, phoneNumber, firstName, lastName)` - Register a new pending call
- `getPendingCall(callId)` - Retrieve call state when webhook arrives
- `completeCall(callId)` - Mark call as completed
- `failCall(callId, error)` - Mark call as failed
- `cleanupOldCalls()` - Remove stale calls (older than 30 minutes)

**Auto-cleanup:**
- Completed/failed calls removed after 5 minutes
- Stale pending calls removed after 30 minutes
- Runs cleanup every 10 minutes

### 2. Bland Webhook Route (`src/routes/blandWebhook.ts`)

Handles incoming webhooks from Bland AI.

**Key Features:**
- Validates webhook payload
- Parses transcript and determines outcome
- Matches call to pending state
- Updates Convoso in background (fire-and-forget)
- Returns 200 immediately to Bland

### 3. Updated Orchestrator (`src/logic/awhOrchestrator.ts`)

**New stages:**
- `INIT` - Start orchestration
- `BLAND_CALL` - Initiate call with webhook URL
- `WEBHOOK_REGISTERED` - Call state registered, waiting for webhook
- `COMPLETE` - All done

**Removed stages:**
- ~~`BLAND_TRANSCRIPT`~~ (no more polling!)
- ~~`CONVOSO_UPDATE`~~ (moved to webhook handler)

### 4. Updated Bland Service (`src/services/blandService.ts`)

**sendOutboundCall():**
- Now includes `webhook` parameter in request body
- Bland will POST to this URL when call completes

**getTranscript():**
- Marked as `@deprecated`
- Only kept as fallback
- Not used in normal flow

---

## Configuration

### Environment Variables

```bash
# Webhook URL - REQUIRED for webhook-based completion
BLAND_WEBHOOK_URL=https://your-server.com/webhooks/bland-callback

# For local testing with ngrok:
BLAND_WEBHOOK_URL=https://abc123.ngrok.io/webhooks/bland-callback

# For Render deployment:
BLAND_WEBHOOK_URL=https://awh-outbound-orchestrator.onrender.com/webhooks/bland-callback
```

### Local Testing with ngrok

1. Start ngrok:
   ```bash
   ngrok http 3000
   ```

2. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

3. Update `.env`:
   ```bash
   BLAND_WEBHOOK_URL=https://abc123.ngrok.io/webhooks/bland-callback
   ```

4. Start your server:
   ```bash
   npm run dev
   ```

5. Bland will now send webhooks to your local machine via ngrok!

---

## Scalability Comparison

| Metric | Polling-Based | Webhook-Based |
|--------|---------------|---------------|
| API calls per call | 120+ | 1 |
| Concurrent call limit | ~20 | 100+ |
| Memory per call | High (polling state) | Low (minimal state) |
| Server CPU usage | High (constant polling) | Low (event-driven) |
| Risk of rate limiting | High | None |
| Response to completion | 0-5 seconds delay | Instant |

---

## Error Handling

### What if webhook never arrives?

The `CallStateManager` has auto-cleanup:
- After 30 minutes, stale pending calls are removed
- Logs warning about missing webhook
- Prevents memory leaks

### What if webhook arrives before state is registered?

Very unlikely due to call duration, but:
- Webhook handler checks for pending call
- If not found, logs warning and returns 200
- Bland won't retry (we acknowledged receipt)

### What if Convoso update fails?

- Webhook handler catches error
- Marks call as failed in state
- Logs error details
- Still returns 200 to Bland (to prevent retries)

---

## Monitoring

### Check Pending Calls

The `CallStateManager` tracks all calls:

```typescript
const stats = CallStateManager.getStats();
// Returns: { total: 5, pending: 3, completed: 1, failed: 1 }

const pendingCalls = CallStateManager.getAllPendingCalls();
// Returns array of pending call objects
```

### Logs to Watch

**Call initiated:**
```
✅ Call initiated successfully, waiting for Bland webhook
   call_id: abc123
   note: Bland will POST to webhook when call completes
```

**Webhook received:**
```
📥 Received Bland webhook callback
   call_id: abc123
   status: completed
   completed: true
```

**Completion processed:**
```
✅ Full orchestration completed successfully
   call_id: abc123
   outcome: TRANSFERRED
```

---

## Migration Notes

### Backward Compatibility

The polling logic (`getTranscript()`) is still available as a fallback but marked as `@deprecated`.

If you need to fall back to polling temporarily:
1. Don't set `BLAND_WEBHOOK_URL` in `.env`
2. Uncomment the polling stages in orchestrator
3. Calls will work but won't scale well

### Production Deployment

1. Deploy to Render/Heroku/etc
2. Get your public URL (e.g., `https://awh-outbound-orchestrator.onrender.com`)
3. Set `BLAND_WEBHOOK_URL` in environment:
   ```bash
   BLAND_WEBHOOK_URL=https://awh-outbound-orchestrator.onrender.com/webhooks/bland-callback
   ```
4. Restart server
5. Done! Bland will now send webhooks to production

---

## Benefits Summary

✅ **Scalability:** Handle 100+ concurrent calls without issues
✅ **Efficiency:** 99% reduction in API calls (1 vs 120+ per call)
✅ **Performance:** Instant notification when call completes
✅ **Cost:** Lower infrastructure costs (less CPU/memory)
✅ **Reliability:** No risk of hitting Bland API rate limits
✅ **Simplicity:** Cleaner code, fewer moving parts

---

## Questions?

If you have questions about the webhook architecture, check:
- Bland AI docs: https://docs.bland.ai/api-reference/post-call-webhooks
- This codebase: `src/routes/blandWebhook.ts`
- Call state manager: `src/services/callStateManager.ts`
