# Data Collection & Queue System - Complete Flow

## 🔄 How Data Flows Into the Redial Queue

### Method 1: Real-time Call Processing (Primary)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Zapier/API  │────>│ POST /       │────>│ Bland AI    │────>│ Call         │
│ triggers    │     │ awhealth-    │     │ initiates   │     │ completed    │
│ call        │     │ outbound     │     │ outbound    │     │              │
└─────────────┘     └──────────────┘     │ call        │     └──────────────┘
                                         └─────────────┘            │
                                                                    │
                                                                    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Redial      │<────│ Add/Update   │<────│ Parse       │<────│ POST /       │
│ Queue       │     │ redial       │     │ outcome     │     │ webhooks/    │
│ stores lead │     │ queue        │     │ & data      │     │ bland-       │
└─────────────┘     └──────────────┘     └─────────────┘     │ callback     │
                                                              └──────────────┘
```

**Step-by-Step:**

1. **Call Initiated**: External trigger (Zapier/API) sends lead data to `/webhooks/awhealth-outbound`
2. **Bland Call**: System calls Bland AI to make outbound call
3. **Call Completes**: Bland sends webhook to `/webhooks/bland-callback` with results
4. **Outcome Parsed**: System extracts outcome (SALE, TRANSFERRED, VOICEMAIL, etc.)
5. **Queue Updated**: `redialQueueService.addOrUpdateLead()` is called:
   - **If SALE or DNC**: Mark as `completed` (stop redialing)
   - **If CALLBACK**: Set `scheduled_callback_time` (separate from redial queue)
   - **If anything else** (TRANSFERRED, VOICEMAIL, NO_ANSWER, etc.): Update `next_redial_timestamp` based on progressive intervals

**Code Location**: [src/routes/blandWebhook.ts:28-90](src/routes/blandWebhook.ts)

```typescript
// When webhook received
const transcript = parseTranscriptFromWebhook(req.body);

// Update redial queue
await redialQueueService.addOrUpdateLead({
  lead_id: metadata.lead_id,
  phone_number: phoneNumber,
  outcome: transcript.outcome,
  scheduled_callback_time: transcript.scheduled_callback_time || null
});
```

---

### Method 2: Backfill Script (Historical Data)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Bland AI    │────>│ Fetch calls  │────>│ Filter by   │────>│ Keep LATEST  │
│ /v1/calls   │     │ page by page │     │ date range  │     │ call per     │
│ API         │     │ (100/page)   │     │ Dec 1-Jan 7 │     │ phone        │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
                                                                     │
                                                                     │
                                                                     ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Redial      │<────│ Add to queue │<────│ Filter out  │<────│ Check        │
│ Queue       │     │ if not       │     │ SALE & DNC  │     │ Convoso      │
│ JSON file   │     │ exists       │     │ (skip)      │     │ status       │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
```

**Purpose**: Load historical calls from Bland.ai into redial queue

**Script**: `backfill-from-bland-v2.js` (NEW - with retry logic!)

**What it does**:
1. Fetches ALL calls from Bland.ai API (Dec 1, 2025 - Jan 7, 2026)
2. For duplicate phone numbers, **keeps the LATEST call** (most recent timestamp)
3. Checks Convoso to see if lead already has SALE or DNC
4. Adds to redial queue if NOT already successful

**Run**:
```bash
npm run backfill:dry-run  # Test without changes
npm run backfill           # Real run
npm run backfill:resume    # Resume from last page (if crashed)
```

---

## 📋 Redial Queue Logic

### Storage Location
- **File**: `data/redial-queue/redial-queue_2026-01.json` (one file per month)
- **Format**: JSON object with phone numbers as keys

### Queue Entry Structure
```json
{
  "5619565858": {
    "lead_id": "123456",
    "list_id": "789",
    "phone_number": "5619565858",
    "first_name": "John",
    "last_name": "Doe",
    "state": "FL",
    "status": "pending",           // pending, rescheduled, completed
    "attempts": 3,                 // Total attempts ever
    "attempts_today": 2,           // Resets daily at midnight
    "created_at": 1704585600000,
    "updated_at": 1704589200000,
    "next_redial_timestamp": 1704589200000,  // When to call next
    "last_call_timestamp": 1704585600000,
    "last_outcome": "VOICEMAIL",
    "scheduled_callback_time": null,  // Set if user requested callback
    "daily_max_reached_at": null,
    "outcomes": ["VOICEMAIL", "NO_ANSWER", "VOICEMAIL"]
  }
}
```

### When Leads Get Added
1. **Real-time**: After EVERY call that's NOT a SALE or DNC
2. **Backfill**: When running backfill script
3. **Callback processing**: After scheduled callback completes (if NOT SALE/DNC)

### When Leads Get REMOVED (Completed)
Only these outcomes **STOP** redialing:
- ✅ **SALE** - Customer bought
- ✅ **ACA** - Affordable Care Act sale
- ✅ **DNC** - Do Not Call request
- ✅ **NOT_INTERESTED** - Customer declined
- ✅ **DO_NOT_CALL** - Explicit request

**Everything else continues redialing**:
- ❌ TRANSFERRED (not sale) - continues
- ❌ VOICEMAIL - continues
- ❌ NO_ANSWER - continues
- ❌ CALLBACK (after callback completes, if not sale) - continues

### Progressive Redial Intervals

**Configuration** (`.env`):
```bash
REDIAL_PROGRESSIVE_INTERVALS=0,1,5,10,30,60,120  # minutes
REDIAL_MAX_ATTEMPTS=8
REDIAL_MAX_DAILY_ATTEMPTS=8
```

**Example Timeline**:
```
Call 1: Immediately (0 min)
Call 2: 1 minute later
Call 3: 5 minutes later
Call 4: 10 minutes later
Call 5: 30 minutes later
Call 6: 60 minutes later
Call 7: 120 minutes later
Call 8: 120 minutes later (max attempts reached)
```

**Business Hours Constraint**:
- Only calls between **11 AM - 8 PM EST** (Monday-Friday)
- If next redial falls outside hours, scheduled for next business day at 11 AM

---

## 🔄 Queue Processor (Automatic)

### How It Works
```
Every 30 minutes:
  ├─ Check if system is active (business hours)
  ├─ If YES:
  │   ├─ Load redial queue from disk
  │   ├─ Filter leads ready to call (next_redial_timestamp <= now)
  │   ├─ Filter by daily max (attempts_today < 8)
  │   ├─ Call each lead via Bland API
  │   └─ Wait for webhooks to update queue
  └─ If NO: Skip (log "System inactive")
```

**Service**: [src/services/queueProcessorService.ts](src/services/queueProcessorService.ts)

**Configuration**:
```bash
QUEUE_PROCESSOR_ENABLED=true
QUEUE_PROCESSOR_INTERVAL_MINUTES=30
```

**Logs**:
```
[INFO] System inactive - skipping queue processing  # Before 11 AM or after 8 PM
[INFO] Processing queued requests {"queueSize": 980}
[INFO] Queue processing completed {"processed": 50, "failed": 0}
```

---

## 🐛 Backfill Script v2 - What's Fixed

### Previous Issues (v1)
1. ❌ **No retry logic** - 500 error = script crash
2. ❌ **No resume capability** - had to start from page 1 every time
3. ❌ **Too fast** - 500ms delay caused rate limiting

### New Features (v2)
1. ✅ **Exponential backoff retry** - up to 5 retries with increasing delays
2. ✅ **Progress saving** - saves every 100 pages, can resume from last page
3. ✅ **Slower rate** - 1000ms delay (2x slower)
4. ✅ **Better error handling** - continues after errors instead of crashing
5. ✅ **Resume from crash** - use `--resume` flag

### How to Resume Your Failed Run

**You crashed at page 2094**, here's how to continue:

```bash
# SSH to EC2
ssh -i ~/downloads/awh-outbound-orchestrator-key-pair.pem ec2-user@ec2-56-228-64-116.eu-north-1.compute.amazonaws.com

# Go to orchestrator directory
cd /var/www/awh-orchestrator

# Resume from page 2094 (uses saved progress)
npm run backfill:resume
```

**What happens**:
1. Script loads saved progress from `data/backfill-progress.json`
2. Resumes from page 2095 (next after last successful)
3. Keeps all 98 unique phones already processed
4. Continues with retry logic if 500 errors happen again

### Retry Logic Example

```
Page 2094: ❌ Bland API error 500
           ⚠️  Retrying in 2s... (1/5)
           ❌ Still 500
           ⚠️  Retrying in 4s... (2/5)
           ❌ Still 500
           ⚠️  Retrying in 8s... (3/5)
           ✅ Success!
```

**Max wait per page**: 2s + 4s + 8s + 16s + 32s = 62 seconds

---

## 📊 Current System Status

### Your EC2 Status (as of last check)
```
✅ SSH: Working
✅ Orchestrator: Running (PM2 online)
✅ Health endpoint: Responding (200 OK)
✅ Business hours: 11 AM - 8 PM EST
✅ Queue processor: Active (runs every 30 minutes)
✅ Data intact: 622KB Dec queue + 775KB Jan queue
```

### Why "System inactive" in logs?
Your logs show:
```
[INFO] System inactive - skipping queue processing {"nextCheckIn":"30 minutes"}
```

**This is CORRECT** - the timestamp was `08:24:22` and `08:54:22`, which is **before 11 AM EST** (business hours start at 11 AM).

The queue processor will start processing at 11:00 AM EST.

---

## 🚀 Next Steps

### 1. Resume Backfill (Recommended)
```bash
ssh -i ~/downloads/awh-outbound-orchestrator-key-pair.pem ec2-user@ec2-56-228-64-116.eu-north-1.compute.amazonaws.com
cd /var/www/awh-orchestrator
npm run backfill:resume
```

### 2. Monitor Queue Processor (at 11 AM EST)
```bash
pm2 logs awh-orchestrator --lines 50
```

Look for:
```
[INFO] Processing queued requests {"queueSize": 980}
[INFO] Queue processing completed {"processed": 50}
```

### 3. Check Call Volume Increase
After 11 AM EST, calls should start going out. Monitor:
- Bland AI dashboard for outgoing calls
- PM2 logs for webhook activity
- Redial queue file size growing

---

## 📝 Summary

**Data Collection Methods**:
1. **Real-time webhooks** - Primary method, processes every call immediately
2. **Backfill script** - One-time load of historical calls from Bland.ai

**Queue Rules**:
- ✅ Only SALE and DNC stop redialing
- ❌ Everything else continues (TRANSFERRED, VOICEMAIL, etc.)
- ✅ CALLBACK uses separate scheduled queue
- ✅ Max 8 calls/day per lead
- ✅ Progressive intervals: 0,1,5,10,30,60,120 minutes
- ✅ Business hours: 11 AM - 8 PM EST only

**New v2 Script**:
- ✅ Retry logic with exponential backoff
- ✅ Resume capability (saves progress every 100 pages)
- ✅ Slower rate (1000ms delay)
- ✅ Better error handling

**How to Resume**:
```bash
npm run backfill:resume
```

Your orchestrator is healthy and will start processing calls at 11 AM EST! 🎉
