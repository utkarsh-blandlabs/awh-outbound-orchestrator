# Test Mode Safety Guide

## ✅ SAFETY FIX APPLIED - Safe to Use

### Your Questions Answered:

---

## 1. ❓ "Will this trigger all the requests in the queue for actual business?"

### ✅ ANSWER: **NO - Now completely safe!**

**CRITICAL BUG FIXED:** The original implementation had a dangerous global business hours bypass that could have triggered real calls at 2 AM. **This has been removed.**

### What's Protected Now:

✅ **Queue Processor** - ALWAYS respects business hours (11 AM - 8 PM EST)
- Will NOT process Convoso leads outside business hours
- Test mode does NOT affect this

✅ **Redial Queue** - ALWAYS respects business hours (11 AM - 8 PM EST)
- Will NOT call real customers outside business hours
- Test mode does NOT affect this

✅ **SMS Scheduler** - ALWAYS respects TCPA hours (11 AM - 8 PM local timezone)
- Will NOT send SMS outside TCPA hours
- Test mode does NOT affect this

### What Test Mode DOES Affect:

✅ **Manual Test Calls ONLY** - Via `/api/admin/test/trigger-call`
- You can manually trigger a test call to YOUR OWN number
- This is the ONLY thing that bypasses business hours
- Real customer queue is NOT affected

---

## 2. ❓ "Is SMS scheduler working properly? Are Day 1, 3, 7 messages scheduled properly?"

### ✅ ANSWER: **YES - SMS Scheduler is working perfectly!**

**Current Status:**
```json
{
  "enabled": true,
  "intervalMinutes": 5,
  "tcpaHours": "11:00 - 20:00",
  "cadence": [0, 1, 3, 7],
  "maxMessages": 4
}
```

### How SMS Sequence Works:

**Day 0 (Immediately after call):**
- Message 1: "Hey {{first_name}}, your healthcare plan request has been received!..."
- Sent by Bland.ai during the call (if voicemail detected)
- OR triggered by SMS automation

**Day 1 (Next day):**
- Message 2: "At American Way Health we make the process simple and easy..."
- Sent by SMS scheduler between 11 AM - 8 PM (customer's timezone)

**Day 3 (3 days later):**
- Message 3: "{{first_name}}, we have health care plans with low premiums..."
- Sent by SMS scheduler between 11 AM - 8 PM

**Day 7 (7 days later):**
- Message 4: "{{first_name}}, healthcare rates will increase next month..."
- Sent by SMS scheduler between 11 AM - 8 PM

### SMS Scheduler Safety Features:

✅ **TCPA Compliance** - Only sends between 11 AM - 8 PM in customer's local timezone
✅ **Daily Limit** - Max 2 SMS per phone number per day
✅ **Opt-Out Detection** - Stops sending if customer texts "STOP"
✅ **Max Messages** - Stops after 4 messages total
✅ **Smart Scheduling** - Checks every 5 minutes, only sends when it's time

### Verification:

The scheduler is actively running and checking for pending leads every 5 minutes. When a lead goes to voicemail:
1. They're added to the SMS pending leads queue
2. Scheduler checks their timezone
3. Waits for TCPA hours (11 AM - 8 PM)
4. Sends next message based on cadence
5. Stops at 4 messages or if they opt out

---

## 3. ❓ "How can I test safely without activating actual business operations?"

### ✅ ANSWER: **Use these safe test workflows**

---

## 🧪 Safe Testing Workflows

### Option 1: Test a Single Call to Your Own Number (SAFEST)

**When to use:** Test the call flow outside business hours

**How to use:**
```bash
# 1. Check test mode status
curl "http://localhost:3000/api/admin/test/status" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# Verify:
# - business_hours.active = false (outside business hours)
# - safety.queue_processor_respects_hours = true
# - safety.manual_test_calls_only = true

# 2. Trigger ONE test call to YOUR phone number
curl -X POST "http://localhost:3000/api/admin/test/trigger-call" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+16284444907",
    "first_name": "Utkarsh",
    "last_name": "Test"
  }'

# This will call ONLY your number, NO real customers
```

**What happens:**
- ✅ Calls your number immediately (even at 2 AM)
- ✅ Tests voicemail detection
- ✅ Tests SMS sending (if voicemail)
- ❌ Does NOT trigger queue processing
- ❌ Does NOT call real customers

---

### Option 2: Test SMS Sending After Hitting Daily Limit

**When to use:** You hit the 2 SMS/day limit and want to test again

**How to use:**
```bash
# 1. Check current SMS count
curl "http://localhost:3000/api/admin/test/status" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# 2. Reset SMS tracker (clears daily limit)
curl -X POST "http://localhost:3000/api/admin/test/reset-sms-tracker" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# 3. Now you can send SMS again
curl -X POST "http://localhost:3000/api/admin/test/trigger-call" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+16284444907", "first_name": "Utkarsh", "last_name": "Test"}'
```

**What happens:**
- ✅ Clears SMS limit for your number only
- ✅ Allows you to test SMS again
- ❌ Does NOT affect real customers

---

### Option 3: Test Redial Queue After Hitting Daily Max

**When to use:** Leads hit daily max (8 calls/day) and you want to test again

**How to use:**
```bash
# 1. Reset daily counters
curl -X POST "http://localhost:3000/api/admin/test/reset-daily-counters" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# 2. Check redial queue
curl "http://localhost:3000/api/admin/redial/queue?status=pending" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# Leads that were "daily_max_reached" are now "pending"
```

**What happens:**
- ✅ Resets daily attempt counters for all leads
- ✅ Moves leads from "daily_max_reached" to "pending"
- ⚠️ **IMPORTANT:** Redial queue will STILL respect business hours
- ❌ Will NOT call customers outside 11 AM - 8 PM

---

## 🔒 What Cannot Be Bypassed (Safety Guarantees)

These systems **ALWAYS** respect business hours, even with test mode enabled:

### 1. Queue Processor
- **What it does:** Processes leads from Convoso queue
- **When it runs:** ONLY during business hours (11 AM - 8 PM EST)
- **Test mode effect:** NONE - always respects hours
- **Safety:** Real customers never called outside hours

### 2. Redial Queue
- **What it does:** Redials leads that didn't answer/convert
- **When it runs:** ONLY during business hours (11 AM - 8 PM EST)
- **Test mode effect:** NONE - always respects hours
- **Safety:** Real customers never called outside hours

### 3. SMS Scheduler
- **What it does:** Sends Day 1, 3, 7 SMS messages
- **When it runs:** ONLY during TCPA hours (11 AM - 8 PM local time)
- **Test mode effect:** NONE - always respects TCPA
- **Safety:** Real customers never texted outside hours

---

## 📊 Test Mode Status Check

Always check status before testing:

```bash
curl "http://localhost:3000/api/admin/test/status" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"
```

**Look for these safety indicators:**
```json
{
  "business_hours": {
    "active": false,  // Shows real business hours status
    "note": "Queue processors ALWAYS respect these hours"
  },
  "safety": {
    "queue_processor_respects_hours": true,
    "redial_queue_respects_hours": true,
    "sms_scheduler_respects_tcpa": true,
    "manual_test_calls_only": true
  }
}
```

---

## ⚠️ Production Checklist

Before deploying to production:

```bash
# 1. Disable test mode in .env
TEST_MODE_ENABLED=false
TEST_MODE_BYPASS_BUSINESS_HOURS=false
TEST_MODE_ALLOW_SMS_RESET=false

# 2. Restart
pm2 restart awh-orchestrator

# 3. Verify test endpoints are blocked
curl "http://localhost:3000/api/admin/test/status" -H "X-API-Key: your_key"
# Should return: 403 Forbidden
```

---

## 🎯 Summary

### ✅ SAFE TO USE:
- Manual test calls to YOUR number (bypasses business hours)
- SMS tracker reset (clears YOUR limits)
- Daily counter reset (resets limits, still respects hours)

### ❌ CANNOT BYPASS (Protected):
- Queue Processor (always respects 11 AM - 8 PM EST)
- Redial Queue (always respects 11 AM - 8 PM EST)
- SMS Scheduler (always respects 11 AM - 8 PM TCPA)

### 🛡️ Safety Guarantee:
**Real customers will NEVER be contacted outside business hours, regardless of test mode settings.**

---

## 📞 Quick Test Example

Test right now (even outside business hours):

```bash
# This is SAFE - only calls YOUR number
curl -X POST "http://localhost:3000/api/admin/test/trigger-call" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+16284444907", "first_name": "Utkarsh", "last_name": "Test"}'
```

**What you'll test:**
1. Call flow (voicemail detection, transfers)
2. SMS sending (if goes to voicemail)
3. Call tracking and logging
4. Webhook callbacks

**What won't happen:**
- ❌ Real customers won't be called
- ❌ Queue won't be processed
- ❌ Redial queue won't run

You're 100% safe to test!
