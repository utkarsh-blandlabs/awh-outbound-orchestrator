# AWH Outbound Orchestrator - Testing Guide

## Overview

The **AWH Outbound Orchestrator** is a Node.js service that replaces our Zapier automation for outbound calls. It receives webhooks from Convoso, triggers Bland AI calls, and updates leads with results.

**Production URL:** `https://awh-outbound-orchestrator.onrender.com`

---

## What This Service Does

```
┌─────────────────────────────────────────────────────────────┐
│  Complete Flow                                               │
└─────────────────────────────────────────────────────────────┘

1. Convoso sends webhook with lead info
      ↓
2. Our service receives it (< 1 second response)
      ↓
3. Background: Creates/updates lead in Convoso
      ↓
4. Background: Triggers Ashley AI call via Bland
      ↓
5. Background: Waits for call to complete (30s - 5min)
      ↓
6. Background: Updates Convoso with transcript & outcome
      ↓
   Done!
```

**Key Point:** The webhook returns immediately (~200ms), then everything happens in the background. This means Convoso doesn't wait, and we avoid timeout issues.

---

## Quick Test (Postman)

### Step 1: Open Postman

If you don't have Postman:
- Download from: https://www.postman.com/downloads/
- Or use web version: https://web.postman.com/

### Step 2: Create New Request

1. Click **"New"** → **"HTTP Request"**
2. Set method to **POST**
3. Enter URL: `https://awh-outbound-orchestrator.onrender.com/webhooks/awhealth-outbound`

### Step 3: Set Headers

Click the **"Headers"** tab and add:

| Key | Value |
|-----|-------|
| `Content-Type` | `application/json` |

### Step 4: Set Body

1. Click the **"Body"** tab
2. Select **"raw"**
3. Select **"JSON"** from dropdown
4. Paste this payload:

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

### Step 5: Send Request

Click the **"Send"** button

### Step 6: Check Response

You should get this response **immediately** (< 1 second):

```json
{
  "success": true,
  "message": "Webhook received, processing in background",
  "request_id": "req_1764596339969_z1hasx3um"
}
```

**Status Code:** `202 Accepted`  
**Response Time:** ~200-500ms

 **This means it worked!** The service is now processing the call in the background.

---

## Test Scenarios

### Test 1: Valid Full Payload (Recommended)

**Purpose:** Test with all fields (most realistic)

**Payload:**
```json
{
  "first_name": "John",
  "last_name": "Smith",
  "phone_number": "5551234567",
  "state": "CA",
  "city": "Los Angeles",
  "postal_code": "90001",
  "date_of_birth": "June 15, 1985, 12:00 pm",
  "age": "39",
  "lead_id": "test_001",
  "list_id": "16529",
  "status": "NEW",
  "email": "john.smith@example.com",
  "address1": "123 Main St"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Webhook received, processing in background",
  "request_id": "req_..."
}
```
**Status:** `202 Accepted`

---

### Test 2: Minimal Required Fields Only

**Purpose:** Test minimum viable payload

**Payload:**
```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "phone_number": "5559876543",
  "state": "NY",
  "lead_id": "test_002",
  "list_id": "16529"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Webhook received, processing in background",
  "request_id": "req_..."
}
```
**Status:** `202 Accepted`

---

### ❌ Test 3: Invalid Payload (Missing Required Fields)

**Purpose:** Test error handling

**Payload:**
```json
{
  "first_name": "Bob",
  "last_name": "Jones"
}
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Invalid payload: phone_number is required, state is required, lead_id is required, list_id is required",
  "request_id": "req_..."
}
```
**Status:** `400 Bad Request`

---

### ❌ Test 4: Wrong Field Names (Common Mistake)

**Purpose:** Test validation

**Payload:**
```json
{
  "first_name": "Alice",
  "last_name": "Johnson",
  "phone": "5551112222",
  "state": "TX",
  "lead_id": "test_003",
  "list_id": "16529"
}
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Invalid payload: phone_number is required",
  "request_id": "req_..."
}
```
**Status:** `400 Bad Request`

**Note:** It's `phone_number`, not `phone`!

---

## Health Check Endpoint

Test if the service is running:

**Request:**
```
GET https://awh-outbound-orchestrator.onrender.com/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "awh-outbound-orchestrator",
  "timestamp": "2025-12-02T14:30:00.000Z",
  "architecture": "async"
}
```
**Status:** `200 OK`

---

## 📋 Required Fields Reference

| Field | Type | Required | Example |
|-------|------|----------|---------|
| `first_name` | string | ✅ Yes | "Steven" |
| `last_name` | string | ✅ Yes | "Tester" |
| `phone_number` | string | ✅ Yes | "9548173961" |
| `state` | string | ✅ Yes | "FL" |
| `lead_id` | string | ✅ Yes | "8763211" |
| `list_id` | string | ✅ Yes | "16529" |
| `city` | string | ⭕ Optional | "West Palm Beach" |
| `postal_code` | string | ⭕ Optional | "33311" |
| `date_of_birth` | string | ⭕ Optional | "January 1, 2001, 12:00 am" |
| `age` | string | ⭕ Optional | "25" |
| `email` | string | ⭕ Optional | "test@example.com" |
| `address1` | string | ⭕ Optional | "123 Main St" |
| `status` | string | ⭕ Optional | "NEW" |

---

## ⏱️ Response Times

| Scenario | Expected Time |
|----------|---------------|
| Valid webhook | < 500ms |
| Invalid payload | < 100ms |
| Health check | < 100ms |
| Background processing | 30s - 5 min |

**Note:** The webhook returns immediately. Background processing (calling Bland, getting transcript) happens after the response is sent.

---

## 🎯 What Happens After You Get 202 Response

Once you get the `202 Accepted` response, here's what's happening in the background:

```
[Your request is done, you got 202 response]

Meanwhile, on the server:

 T+0s: Creating/updating lead in Convoso
 T+2s: Triggering Bland AI outbound call
 T+4s: Ashley AI calls the customer
 T+34s - 5min: Call happens, customer talks to Ashley
 T+35s - 5min: Service polls Bland for transcript
 T+36s - 5min: Updates Convoso with transcript & outcome
 Done!
```

**How to verify it worked:**
1. Check Convoso CRM for the lead update (look for the lead_id you sent)
2. Look for call log with transcript
3. Check if lead status was updated

---

## Troubleshooting

### Issue: "Could not get any response"

**Symptoms:**
- Postman shows red error: "Could not get any response"
- No response received

**Solutions:**
1. Check the URL is correct: `https://awh-outbound-orchestrator.onrender.com/webhooks/awhealth-outbound`
2. Check your internet connection
3. Try the health check endpoint first: `GET https://awh-outbound-orchestrator.onrender.com/health`
4. If health check works but webhook doesn't, contact dev team

---

### Issue: "400 Bad Request - Invalid payload"

**Symptoms:**
```json
{
  "success": false,
  "error": "Invalid payload: ...",
  "request_id": "req_..."
}
```

**Solutions:**
1. Check you have ALL required fields:
   - `first_name`
   - `last_name`
   - `phone_number` (NOT "phone")
   - `state`
   - `lead_id`
   - `list_id`
2. Check field names are **exactly** as shown (case-sensitive)
3. Check you're sending JSON (Content-Type: application/json)
4. Copy a working example from this doc

---

### Issue: Slow Response (> 5 seconds)

**Symptoms:**
- Request takes more than 5 seconds
- Times out

**This should not happen!** The service should respond in < 1 second.

**Solutions:**
1. Check server status: `GET https://awh-outbound-orchestrator.onrender.com/health`
2. Render may be "sleeping" - first request wakes it up (takes ~30s)
3. Try again - second request should be fast
4. Contact dev team if persists

---

### Issue: 500 Internal Server Error

**Symptoms:**
```json
{
  "error": "Internal Server Error",
  "message": "..."
}
```

**This is a server-side error.**

**Solutions:**
1. Note the `request_id` from response
2. Share with dev team immediately
3. They can check logs using the request_id

---

## Postman Screenshots Guide

### Setting Up the Request : 

**1. Method & URL:**
```
[POST] [https://awh-outbound-orchestrator.onrender.com/webhooks/awhealth-outbound]
```

**2. Headers Tab:**
```
Key: Content-Type
Value: application/json
```

**3. Body Tab:**
```
● raw
▼ JSON

{
  "first_name": "Steven",
  ...
}
```

**4. Send Button:**
```
[Send]
```

**5. Response (Bottom Panel):**
```
Status: 202 Accepted    Time: 234 ms    Size: 125 B

{
  "success": true,
  "message": "Webhook received, processing in background",
  "request_id": "req_..."
}
```

---

## Creating a Postman Collection (Optional)

To save these tests for reuse:

1. Click **"Save"** button in Postman
2. Create new collection: **"AWH Orchestrator Tests"**
3. Save request as: **"Test Valid Webhook"**
4. Add more requests:
   - "Test Health Check"
   - "Test Minimal Payload"
   - "Test Invalid Payload"

**Sharing with team:**
1. Click **"..."** next to collection name
2. Select **"Export"**
3. Choose **"Collection v2.1"**
4. Share the exported JSON file

---

## Important Notes

### Security:

- This endpoint is public (no auth required currently)
- Only use test data, not real customer info
- In production, Convoso will call this endpoint securely

### Environment:

- **Production URL:** `https://awh-outbound-orchestrator.onrender.com`
- This is the LIVE service replacing Zapier
- Test responsibly

### Monitoring:

- Every request gets a unique `request_id`
- Save this ID if you need to report issues
- Dev team can trace the entire flow using this ID

---

## 📊 Expected Response Codes

| Code | Meaning | When It Happens |
|------|---------|-----------------|
| `200 OK` | Success | Health check endpoint |
| `202 Accepted` | Processing | Valid webhook received, processing in background |
| `400 Bad Request` | Invalid | Missing required fields or wrong format |
| `404 Not Found` | Wrong URL | Check the endpoint URL |
| `500 Internal Server Error` | Server error | Contact dev team with request_id |

---

## Testing Checklist for Team

Use this checklist when testing:

- [ ] Health check works: `GET /health` returns 200
- [ ] Valid full payload returns 202 in < 1 second
- [ ] Minimal payload returns 202 in < 1 second
- [ ] Invalid payload returns 400 with error message
- [ ] Response includes `request_id`
- [ ] Response time is under 500ms for webhooks
- [ ] Lead appears in Convoso (check manually)
- [ ] Call log appears in Convoso (after ~5 min)

---

## Understanding the Architecture

**Q: Why does it return 202 so quickly?**  
A: We use async architecture. The webhook responds immediately, then processes the call in the background. This prevents timeouts and scales better.

**Q: How do I know if the call actually happened?**  
A: Check Convoso CRM ~5 minutes after sending webhook. Look for:
1. Lead with the lead_id you sent
2. Call log entry
3. Transcript in lead notes

**Q: What if something fails in background?**  
A: The dev team monitors logs with request_id. If a call fails, they'll see it in logs and can investigate.

**Q: Can I get the transcript in the webhook response?**  
A: No - the call takes 30s - 5min to complete. That's why we use async. Convoso gets updated via their `/v1/log/update` endpoint when ready.

---

**Service Status:**
- Check: https://awh-outbound-orchestrator.onrender.com/health
- Hosting: Render.com

---

## 🎉 Success Criteria

**You're successful when:**
1.  Postman shows `202 Accepted` in < 1 second
2.  Response includes `success: true`
3.  Response includes `request_id`
4.  Lead appears in Convoso CRM
5.  Call log appears in Convoso (after ~5 min)

**If all 5 are checked, the service is working perfectly!**

---


## 🚀 Quick Reference Card

**Production Webhook:**
```
POST https://awh-outbound-orchestrator.onrender.com/webhooks/awhealth-outbound
Content-Type: application/json

{
  "first_name": "string",
  "last_name": "string",
  "phone_number": "string",
  "state": "string",
  "lead_id": "string",
  "list_id": "string"
}

→ 202 Accepted in < 500ms
```

**Health Check:**
```
GET https://awh-outbound-orchestrator.onrender.com/health

→ 200 OK in < 100ms
```

---
 

**Need Help?**
1. Check this document first
2. Try the health check endpoint
3. Contact dev team with:
   - What you tried
   - Screenshot of Postman
   - The `request_id` from response
   - Error message (if any)

---

**Last Updated:** December 2, 2025  
**Version:** 1.0 (Async Architecture)  
**Status:** Production Ready ✅

---

**Happy Testing! 🧪**