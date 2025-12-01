#  Quick Start Guide

##  Files Updated!

All code has been updated to **async architecture**. Here's how to get started:

---

## Step 1: Install Dependencies (if needed)

```bash
cd /Users/utkarshjaiswal/Documents/BlandLabs/claude/awh-outbound-orchestrator
npm install
```

---

## Step 2: Configure Environment

```bash
# Copy the example
cp .env.example .env

# Edit with your values
nano .env
```

**Update these values:**
```bash
# Convoso (from Jeff's email)
CONVOSO_AUTH_TOKEN=c5qlgj5n49a6jizahngaai59------
CONVOSO_LIST_ID=16529

# Bland (waiting for details)
BLAND_API_KEY=your_actual_key
BLAND_PATHWAY_ID=your_actual_pathway
```

---

## Step 3: Start the Server

```bash
npm run dev
```

**You should see:**
```
 AWH Outbound Orchestrator
 Server running on port 3000
 Architecture: ASYNC (background processing)
   - Webhooks return immediately (< 1s)
 Ready to receive webhooks!
```

---

## Step 4: Test in Postman

### Request:
```
POST http://localhost:3000/webhooks/awhealth-outbound
Content-Type: application/json
```

### Body:
```json
{
  "first_name": "Steven",
  "last_name": "Tester",
  "phone_number": "9548173961",
  "state": "FL",
  "city": "West Palm Beach",
  "postal_code": "33311",
  "date_of_birth": "January 1, 2001, 12:00 am",
  "age": "25",
  "lead_id": "8763211",
  "list_id": "16529",
  "status": "NEW"
}
```

### Expected Response (immediate!):
```json
{
  "success": true,
  "message": "Webhook received, processing in background",
  "request_id": "req_1764596339969_z1hasx3um"
}
```

**Status:** `202 Accepted`  
**Time:** ~200ms ⚡

---

## Step 5: Watch the Logs

While Postman gets instant response, watch your terminal:

```
[INFO]  Received AWH webhook {"request_id":"req_..."}
[INFO]  Starting async orchestration (background processing)
[INFO]  Starting AWH outbound orchestration
[INFO]  Step 1: Getting or creating Convoso lead
[INFO] Inserting/updating Convoso lead
[INFO]  Lead ready {"lead_id":"8763211"}
[INFO]  Step 2: Triggering Bland outbound call
[WARN]   STUB: Using mock Bland call response
[INFO]  Call initiated
[INFO]  Step 3: Logging call in Convoso
[INFO]  Step 4: Waiting for Bland transcript
[WARN]   STUB: Using mock Bland transcript response
[INFO]  Transcript received
[INFO]  Step 5: Applying path logic and updating lead
[INFO] Updating Convoso call log
[INFO]  Lead updated
[INFO]  Background orchestration completed successfully
```

---


## 📁 All Updated Files

 **Core Files:**
- `src/types/awh.ts` - Type definitions (phone_number, etc.)
- `src/config.ts` - Configuration (CONVOSO_AUTH_TOKEN)
- `src/utils/logger.ts` - Logging utility
- `src/utils/retry.ts` - Retry logic

 **Services:**
- `src/services/blandService.ts` - Bland API (stubbed)
- `src/services/convosoService.ts` - Convoso API (real!)

 **Logic:**
- `src/logic/awhOrchestrator.ts` - Main flow (with request_id)

 **Routes:**
- `src/routes/awhWebhook.ts` - Async webhook (fire-and-forget)

 **App:**
- `src/index.ts` - Express server (async messaging)

 **Config:**
- `.env.example` - Environment variables template

---

##  Verification Checklist

- [ ] `npm run dev` starts without errors
- [ ] You see "ASYNC (background processing)" message
- [ ] Postman test returns `202 Accepted` in < 1 second
- [ ] Server logs show background processing
- [ ] Logs include request_id for tracking

---

##  Still Stubbed

**Bland API** - Waiting for details from Jeff/Delaine:
- Send outbound call endpoint
- Get transcript endpoint
- Request/response formats

Once you get those, update:
- `src/services/blandService.ts` (lines ~54 and ~98)

---

##  Documentation

- **ASYNC_ARCHITECTURE.md** - Why async is better
- **SYNC_TO_ASYNC_MIGRATION.md** - What changed
- **API_INTEGRATION_UPDATE.md** - Convoso API details
- **README.md** - Full project documentation

---

##  Troubleshooting

### Issue: "phone is required"
 **Fixed!** Now uses `phone_number` (correct field name)

### Issue: Postman times out
 **Fixed!** Webhook returns in < 1 second now

### Issue: Can't see results
 **Watch server logs** - Background processing shows there

---

##  You're Ready!

The async architecture is complete and ready to test!

**Test it now:**
```bash
npm run dev
# In Postman: POST http://localhost:3000/webhooks/awhealth-outbound
```

