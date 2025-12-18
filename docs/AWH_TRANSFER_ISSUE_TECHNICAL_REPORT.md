# Technical Report: Call Transfer Failure Analysis
## AWH Live Agent Queue - Ashley AI Integration

**Date:** December 18, 2025
**Prepared By:** BlandLabs Engineering Team
**Severity:** Critical - Blocking Production Deployment
**Impact:** 100% of transfers fail when using Ashley AI's static phone number

---

## Executive Summary

Call transfers from Ashley AI to AWH's live agent queue are failing when using Ashley AI's static phone number (`+15619565858`) as the caller ID. The same transfer mechanism works perfectly when using random Bland AI pool numbers. This indicates a **phone system routing configuration issue** at AWH that is blocking or rejecting transfers originating from Ashley AI's specific phone number.

**Business Impact:**
- Cannot use consistent caller ID for callbacks
- SMS functionality broken (requires static From number)
- Convoso routing broken (pathway routing depends on From number)
- Customer experience degraded (random callback numbers)

---

## Problem Statement

### Environment
- **Ashley AI Phone Number:** `+15619565858`
- **AWH Agent Queue:** `+12173866023`
- **Bland AI Pathway:** `0258dd7c-e952-43ca-806e-23e1c6c7334b`
- **Transfer Mechanism:** Warm transfer with proxy caller ID

### Symptoms
1. ❌ Transfers **initiated** but **never connect** when From = `+15619565858`
2. ✅ Transfers **complete successfully** when From = random Bland number
3. ❌ Calls hang for 3+ minutes before timing out
4. ❌ Transfer metadata fields remain `null` (transferred_at, transferred_to, etc.)
5. ✅ Pathway configuration verified correct ({{to}} proxy working)

---

## Technical Evidence

### Test Scenario
- **Test Customer Number:** `+16284444907`
- **Transfer Destination:** `+12173866023` (AWH Agent Queue)
- **Pathway Version:** 62
- **Transfer Proxy:** `{{to}}` (customer's number shown to agent)

### Failed Transfer (Ashley's Number)

**Call ID:** `f26b85a8-e979-4a91-9070-cbc161d0e856`
**Test Time:** 2025-12-17 19:11:27 UTC

```json
{
  "call_id": "f26b85a8-e979-4a91-9070-cbc161d0e856",
  "from": "+15619565858",              // Ashley AI number
  "to": "+16284444907",                // Test customer
  "answered_by": "human",
  "disposition_tag": "TRANSFERRED",     // ❌ Misleading - pathway reached transfer node

  // Transfer fields - ALL NULL:
  "transferred_at": null,               // ❌ No timestamp
  "transferred_to": null,               // ❌ No destination
  "warm_transfer_call": null,           // ❌ No transfer data
  "warm_transfer_calls": null,          // ❌ No transfer calls
  "pre_transfer_duration": null,        // ❌ No timing
  "post_transfer_duration": null,       // ❌ No timing

  "call_length": 3.27,                  // Call connected for 3.27 min
  "corrected_duration": "196",          // 3 min 16 sec total
  "call_ended_by": "USER",
  "status": "completed"
}
```

**Analysis:**
- Pathway successfully reached transfer node (disposition_tag = "TRANSFERRED")
- Bland AI attempted transfer to `+12173866023`
- Transfer **never connected** (all transfer fields null)
- Call hung for 196 seconds waiting for agent
- Eventually timed out/ended

### Successful Transfer (Random Number)

**Call ID:** `dd84d804-2b61-474a-b79f-3afbbe5affce`
**Test Time:** 2025-12-17 19:17:05 UTC

```json
{
  "call_id": "dd84d804-2b61-474a-b79f-3afbbe5affce",
  "from": "+12312784228",              // ✅ Random Bland pool number
  "to": "+16284444907",                // Same test customer
  "answered_by": "human",
  "disposition_tag": "TRANSFERRED",     // ✅ Actually transferred

  // Transfer fields - ALL POPULATED:
  "transferred_at": "2025-12-17T19:18:42.525Z",  // ✅ Transfer timestamp
  "transferred_to": "+12173866023",              // ✅ Agent queue
  "warm_transfer_call": {                        // ✅ Transfer data (2 items)
    "state": "MERGED",
    // ... additional data
  },
  "warm_transfer_calls": {                       // ✅ Transfer calls (2 items)
    // ... call data
  },
  "pre_transfer_duration": 1.542,                // ✅ 1.5 sec before transfer
  "post_transfer_duration": 0.375,               // ✅ 0.4 sec after transfer

  "call_length": 1.92,                  // Call connected for 1.92 min
  "corrected_duration": "115",          // 1 min 55 sec total
  "call_ended_by": "USER",
  "status": "completed"
}
```

**Analysis:**
- Same pathway, same configuration, same test customer
- **Only difference:** From number (`+12312784228` vs `+15619565858`)
- Transfer completed in **1.5 seconds**
- Agent answered successfully
- All transfer metadata populated correctly

---

## Call Flow Diagrams

### Scenario 1: Failed Transfer (Ashley's Number)

```
┌─────────────────┐
│  Convoso CRM    │
│  Sends Webhook  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ BlandLabs Orchestrator  │
│ Initiates Call          │
└────────┬────────────────┘
         │
         ▼ API Call: POST /v1/calls
         │ from: "+15619565858"
         │ to: "+16284444907"
         │ pathway_id: "0258dd7c..."
         ▼
┌─────────────────────────┐
│    Bland AI Platform    │
│   Calls Customer        │
└────────┬────────────────┘
         │
         ▼ Ashley AI speaks to customer
         │ Collects: age, plan type, zip
         │ Customer requests agent
         ▼
┌─────────────────────────┐
│  Pathway Transfer Node  │
│  Proxy: {{to}}          │
│  → Shows +16284444907   │
└────────┬────────────────┘
         │
         ▼ Attempts transfer to +12173866023
         │ Caller ID from: +15619565858
         │ Caller ID to agent: +16284444907 (via proxy)
         ▼
┌─────────────────────────┐
│  AWH Agent Queue        │
│  +12173866023           │
│                         │
│  ❌ BLOCKS/REJECTS      │  ← ISSUE HERE
│  Incoming from:         │
│  +15619565858           │
└────────┬────────────────┘
         │
         ▼ Transfer never connects
         │ Call hangs for 196 seconds
         ▼
┌─────────────────────────┐
│   Call Times Out        │
│   Transfer Failed       │
│   Customer Frustrated   │
└─────────────────────────┘
```

### Scenario 2: Successful Transfer (Random Number)

```
┌─────────────────┐
│  Convoso CRM    │
│  Sends Webhook  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ BlandLabs Orchestrator  │
│ Initiates Call          │
└────────┬────────────────┘
         │
         ▼ API Call: POST /v1/calls
         │ from: "" (empty)
         │ to: "+16284444907"
         │ pathway_id: "0258dd7c..."
         ▼
┌─────────────────────────┐
│    Bland AI Platform    │
│   Assigns Random From   │
│   from: "+12312784228"  │
└────────┬────────────────┘
         │
         ▼ Calls Customer
         │ Same conversation flow
         │ Customer requests agent
         ▼
┌─────────────────────────┐
│  Pathway Transfer Node  │
│  Proxy: {{to}}          │
│  → Shows +16284444907   │
└────────┬────────────────┘
         │
         ▼ Attempts transfer to +12173866023
         │ Caller ID from: +12312784228
         │ Caller ID to agent: +16284444907 (via proxy)
         ▼
┌─────────────────────────┐
│  AWH Agent Queue        │
│  +12173866023           │
│                         │
│  ✅ ACCEPTS             │  ← Works Here
│  Incoming from:         │
│  +12312784228           │
└────────┬────────────────┘
         │
         ▼ Transfer connects in 1.5 seconds
         │ Agent answers
         ▼
┌─────────────────────────┐
│  Successful Transfer    │
│  Agent speaks to        │
│  customer               │
└─────────────────────────┘
```

---

## Root Cause Analysis

### What We've Ruled Out

✅ **Bland AI Platform Issue**
- Same pathway configuration
- Same transfer node settings
- Same proxy configuration ({{to}})
- Works with other numbers

✅ **Orchestrator Code Issue**
- Same API call parameters
- Same request body
- Transfer data verified in logs

✅ **Pathway Configuration Issue**
- Transfer proxy correctly set to {{to}}
- Customer number verified in variables
- Transfer node settings identical in both tests

### Root Cause: AWH Phone System Routing Rules

**The AWH agent queue system (`+12173866023`) has routing rules that:**

1. **Accept** transfers from unknown/random numbers → ✅ Works
2. **Block/Reject** transfers from Ashley AI's number (`+15619565858`) → ❌ Fails

**Possible Mechanisms:**
- **Caller ID Filtering:** Whitelist/blacklist of allowed originating numbers
- **Loop Prevention:** System detects internal number and rejects to prevent routing loops
- **ANI Restrictions:** Only accepts calls from specific number ranges
- **IVR Routing Rules:** Routes Ashley's number back to IVR instead of agent queue

---

## Technical Verification Performed

### 1. Pathway Configuration ✅
- Transfer node proxy: `{{to}}` (verified correct)
- Transfer destination: `+12173866023` (verified correct)
- Variables populated: `to = +16284444907` (verified in logs)

### 2. Bland API Integration ✅
- API requests identical except `from` parameter
- Webhook responses show clear difference in transfer fields
- Transfer mechanism working (proven by successful test)

### 3. Call Flow Analysis ✅
- Both calls reach transfer node successfully
- Pathway logs show transfer attempt initiated
- Only destination phone system behaves differently

---

## Required Action from AWH Telecom Team

### Primary Request
**Configure the agent queue system (`+12173866023`) to ACCEPT incoming transfers from Ashley AI's phone number (`+15619565858`).**

### Configuration Details

**What Should Work:**
```
Incoming Call to +12173866023:
  - Originating From: +15619565858 (Ashley AI)
  - Caller ID to Agent: +16284444907 (customer via proxy)
  - Action: ACCEPT and route to available agent
```

**Current Behavior:**
```
Incoming Call to +12173866023:
  - Originating From: +15619565858 (Ashley AI)
  - Action: BLOCK/REJECT/LOOP (exact behavior unknown)
```

### Areas to Check

1. **Caller ID Filters**
   - Whitelist of allowed originating numbers
   - Blacklist of blocked numbers
   - Check if `+15619565858` is blocked

2. **IVR Routing Rules**
   - Rules for routing internal numbers
   - Loop prevention logic
   - Transfer acceptance criteria

3. **PBX/Call Manager Configuration**
   - Trunk routing rules
   - ANI-based routing
   - Transfer restrictions

4. **DID/Number Configuration**
   - How `+12173866023` handles incoming calls
   - Transfer vs. direct dial behavior
   - Number ownership/assignment

---

## Testing Plan

### Phase 1: Configuration Change
AWH telecom team updates routing rules to allow transfers from `+15619565858`

### Phase 2: Verification Test
**Test Call:**
```bash
# BlandLabs will initiate test call
API: POST /v1/calls
Body: {
  "from": "+15619565858",
  "to": "+16284444907",
  "pathway_id": "0258dd7c-e952-43ca-806e-23e1c6c7334b",
  "transfer_phone_number": "+12173866023"
}
```

**Expected Result:**
- Transfer completes successfully
- `transferred_at` field populated with timestamp
- `transferred_to` = `+12173866023`
- `warm_transfer_call.state` = `MERGED`
- Agent receives call showing customer number `+16284444907`

### Phase 3: Production Deployment
Once verified, update production configuration:
```bash
# .env file change
BLAND_FROM=+15619565858
```

---

## Timeline and Urgency

**Current Impact:**
- ❌ SMS functionality broken (since Dec 10)
- ❌ Callback functionality broken (random numbers)
- ❌ Convoso routing broken (pathway depends on From)
- ❌ Cannot deploy to production

**Temporary Workaround:**
- Using random Bland pool numbers (SMS doesn't work)
- Customer callbacks go to random numbers
- Not acceptable for production

**Requested Timeline:**
- AWH configuration change: **Within 24-48 hours**
- Verification testing: **Same day as change**
- Production deployment: **Immediately after verification**

---

## Call Logs for Reference

### Failed Transfer Call
- **Call ID:** `f26b85a8-e979-4a91-9070-cbc161d0e856`
- **Time:** 2025-12-17 19:11:27 - 19:14:47 UTC
- **Duration:** 196 seconds
- **Recording:** Available in Bland dashboard
- **Webhook:** https://awh-outbound-orchestrator.onrender.com/webhooks/bland-callback

### Successful Transfer Call
- **Call ID:** `dd84d804-2b61-474a-b79f-3afbbe5affce`
- **Time:** 2025-12-17 19:17:05 - 19:19:05 UTC
- **Duration:** 115 seconds
- **Recording:** Available in Bland dashboard
- **Webhook:** https://awh-outbound-orchestrator.onrender.com/webhooks/bland-callback

---

## Contact Information

**For Technical Questions:**
- BlandLabs Engineering Team
- Email: [engineering@blandlabs.ai]
- Available for live debugging session if needed

**For Testing Coordination:**
- We can schedule a live test call with AWH team present
- Real-time monitoring of transfer attempt
- Immediate feedback on configuration changes

---

## Appendix A: Full Webhook Payloads

### Failed Transfer Webhook
```json
{
  "to": "+16284444907",
  "c_id": "f26b85a8-e979-4a91-9070-cbc161d0e856",
  "from": "+15619565858",
  "price": 0.294,
  "end_at": "2025-12-17T19:14:47.000Z",
  "record": true,
  "status": "completed",
  "call_id": "f26b85a8-e979-4a91-9070-cbc161d0e856",
  "inbound": false,
  "completed": true,
  "answered_by": "human",
  "call_length": 3.26666666666667,
  "disposition_tag": "TRANSFERRED",
  "corrected_duration": "196",
  "transferred_at": null,
  "transferred_to": null,
  "warm_transfer_call": null,
  "pre_transfer_duration": null,
  "post_transfer_duration": null,
  "call_ended_by": "USER"
}
```

### Successful Transfer Webhook
```json
{
  "to": "+16284444907",
  "c_id": "dd84d804-2b61-474a-b79f-3afbbe5affce",
  "from": "+12312784228",
  "price": 0.148,
  "end_at": "2025-12-17T19:19:05.000Z",
  "record": true,
  "status": "completed",
  "call_id": "dd84d804-2b61-474a-b79f-3afbbe5affce",
  "inbound": false,
  "completed": true,
  "answered_by": "human",
  "call_length": 1.91666666666667,
  "disposition_tag": "TRANSFERRED",
  "corrected_duration": "115",
  "transferred_at": "2025-12-17T19:18:42.525Z",
  "transferred_to": "+12173866023",
  "warm_transfer_call": {
    "state": "MERGED"
  },
  "pre_transfer_duration": 1.542083333333333,
  "post_transfer_duration": 0.3745833333333368,
  "call_ended_by": "USER"
}
```

---

## Appendix B: System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Call Flow Architecture                     │
└──────────────────────────────────────────────────────────────┘

  Convoso CRM                BlandLabs               Bland AI
  (Lead Source)            (Orchestrator)           (AI Agent)
       │                         │                       │
       │  1. Webhook             │                       │
       │  /awhealth-outbound     │                       │
       ├────────────────────────→│                       │
       │                         │                       │
       │                         │  2. POST /v1/calls    │
       │                         │  from: +15619565858   │
       │                         ├──────────────────────→│
       │                         │                       │
       │                         │                       │  3. Call Customer
       │                         │                       │  +16284444907
       │                         │                       ├─────────────→ Customer
       │                         │                       │
       │                         │                       │  4. Conversation
       │                         │                       │  Collect info
       │                         │                       │  Request transfer
       │                         │                       │
       │                         │                       │  5. Transfer Node
       │                         │                       │  to: +12173866023
       │                         │                       │  proxy: {{to}}
       │                         │                       │
       │                         │                       │  6. Attempt Transfer
       │                         │                       ├─────────────→ AWH Queue
       │                         │                       │              +12173866023
       │                         │                       │
       │                         │                       │              ❌ BLOCKED
       │                         │                       │
       │                         │  7. Webhook           │
       │                         │  /bland-callback      │
       │                         │←─────────────────────┤│
       │                         │                       │
       │  8. Update Call Log     │                       │
       │←────────────────────────┤                       │
       │                         │                       │
```

---

**Document End**

**Next Steps:** Please review and configure the agent queue to allow transfers from Ashley AI's number. Contact BlandLabs engineering for any clarifications or to schedule a live debugging session.
