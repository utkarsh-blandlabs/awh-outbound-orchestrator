# SMS Automation Fix - January 8, 2026

## Problem Identified

**SMS Automation was DISABLED** in the `.env` file:
```bash
SMS_AUTOMATION_ENABLED=false  # ❌ This prevented ALL SMS from being sent
```

## Root Cause

The SMS automation system was built and deployed, but the feature flag was left disabled. This means:
- ✅ SMS webhook is working perfectly (tested successfully)
- ✅ SMS templates are configured correctly
- ✅ SMS scheduler code is deployed
- ✅ SMS day gaps and timing configured properly
- ❌ **BUT the master switch was OFF** - so no SMS were sent

## Fix Applied

Changed `.env` line 179:
```bash
# BEFORE:
SMS_AUTOMATION_ENABLED=false

# AFTER:
SMS_AUTOMATION_ENABLED=true  ✅
```

---

## How to Deploy to Production

### Step 1: Update .env on EC2 Server

SSH into your production server and edit the `.env` file:

```bash
ssh ec2-user@ec2-56-228-64-116.eu-north-1.compute.amazonaws.com
cd awh-outbound-orchestrator
nano .env
```

Find this line (around line 179):
```bash
SMS_AUTOMATION_ENABLED=false
```

Change it to:
```bash
SMS_AUTOMATION_ENABLED=true
```

Save and exit (Ctrl+O, Enter, Ctrl+X)

### Step 2: Restart PM2

```bash
pm2 restart awh-orchestrator
```

### Step 3: Verify SMS Scheduler is Running

Check the logs to confirm SMS automation started:

```bash
pm2 logs awh-orchestrator --lines 50 | grep -i "SMS"
```

You should see:
```
[INFO] SMS Scheduler initialized { enabled: true, intervalMinutes: 5, ... }
```

---

## What Will Happen After Enabling

### Immediate Effects:

1. **SMS Scheduler Starts**: Runs every 5 minutes to check for leads needing SMS
2. **Triggers on**: VOICEMAIL or NO_ANSWER outcomes
3. **SMS Sequence**:
   - Day 0 (immediately): SMS #1
   - Day 1: SMS #2
   - Day 3: SMS #3
   - Day 7: SMS #4
4. **TCPA Compliance**: Only sends between 11 AM - 8 PM (local time)
5. **Weekend Protection**: No SMS on Saturday/Sunday

### Expected First SMS:

When a call results in VOICEMAIL or NO_ANSWER, the lead will immediately receive:

```
Hey {{first_name}}, your healthcare plan request has been received!
We will be calling you shortly. Or if you prefer, Call us (561) 956-5858
and let's get you covered. Text STOP to be removed anytime.
```

---

## Monitoring After Deployment

### Check SMS Activity:

```bash
# See if leads are being added to SMS queue
pm2 logs awh-orchestrator | grep "Lead added to SMS queue"

# See if SMS are being sent
pm2 logs awh-orchestrator | grep "SMS sent successfully"

# Check for any errors
pm2 logs awh-orchestrator | grep -i "sms.*error"
```

### Check Pending SMS Queue:

```bash
cat data/sms-pending-leads.json | jq . | head -50
```

This shows all leads waiting for SMS.

---

## SMS Configuration Summary

All properly configured in `.env`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `SMS_AUTOMATION_ENABLED` | `true` ✅ | Master switch - NOW ON |
| `SMS_AUTOMATION_TRIGGERS` | `VOICEMAIL,NO_ANSWER` | When to send SMS |
| `SMS_DAY_GAPS` | `0,1,3,7` | Day 0, 1, 3, 7 sequence |
| `SMS_MAX_MESSAGES` | `4` | Maximum 4 SMS per lead |
| `SMS_START_HOUR` | `11` | 11 AM earliest |
| `SMS_END_HOUR` | `20` | 8 PM latest |
| `SMS_SCHEDULER_INTERVAL_MINUTES` | `5` | Check every 5 minutes |

---

## Why This Happened

The SMS automation system was built in a previous session and all the code/configuration was completed, but the feature flag was intentionally left `false` pending final approval/testing. It was never turned on.

---

## Next Steps

1. **Enable on Production** (follow steps above)
2. **Monitor for 24 hours** to ensure SMS are sending properly
3. **Check Bland.ai dashboard** to see SMS delivery status
4. **Verify DNC webhook** is working when customers reply "STOP"

---

## Quick Test After Deployment

To test if SMS automation is working:

1. Make a test call that results in VOICEMAIL or NO_ANSWER
2. Check logs: `pm2 logs | grep "Lead added to SMS queue"`
3. Within 5 minutes, check logs: `pm2 logs | grep "SMS sent successfully"`
4. Verify SMS was actually delivered in Bland.ai dashboard

---

## Support

If SMS still don't send after enabling:

1. Check Bland.ai API key is valid
2. Check Bland.ai SMS credits/balance
3. Check phone number `+15619565858` is verified for SMS in Bland.ai
4. Check logs for any API errors from Bland

