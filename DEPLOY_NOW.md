# Quick Deployment Commands

## SSH into Server

```bash
ssh -i /path/to/your-key.pem ubuntu@client.blandlabs.ai
```

## Navigate to Project

```bash
cd /path/to/awh-outbound-orchestrator
```

## Pull Latest Code

```bash
git pull origin main
```

## Update Version Timestamp

```bash
./update-version.sh
```

This updates `version.json` with the current deployment timestamp.

## Update .env File

```bash
nano .env
```

**Add these lines** (after line 41):

```env
# SMS Tracker Configuration
# Limits SMS messages to prevent spam (max 1-2 per day per phone number)
SMS_TRACKER_ENABLED=true
SMS_MAX_PER_DAY=2
```

**Save:** `Ctrl+X`, then `Y`, then `Enter`

## Build Project

```bash
npm run build
```

## Restart PM2

```bash
pm2 restart all
```

## Verify Deployment

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs --lines 50

# Test health endpoint (verify version and deployedAt)
curl http://localhost:3000/health | jq

# Expected output:
# {
#   "status": "ok",
#   "service": "awh-outbound-orchestrator",
#   "version": "1.0.0",
#   "deployedAt": "2025-12-22T20:34:32.000Z",  ← Current timestamp
#   "environment": "production",
#   "uptime": 5,  ← Seconds since restart
#   "timestamp": "2025-12-22T20:34:37.000Z",
#   "architecture": "async"
# }

# Test redial config
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/redial-queue/config
```

## Monitor for Issues

```bash
# Watch logs in real-time
pm2 logs

# Look for these messages:
# ✅ "SMS limit reached for today, voicemail only"
# ✅ "Skipping redial queue add - active call in progress"
# ✅ "Redial queue service initialized" with progressive_intervals: [0,0,5,10,30,60,120]
```

---

## What Changed

1. **No more duplicate calls** - System checks for active calls before redialing
2. **SMS limited to 2/day** - First 2 attempts send SMS, rest only voicemail
3. **Callback number in voicemail** - All voicemails include "(561) 956-5858"
4. **Minimum 2-min delay** - Even "instant" (0 min) intervals now wait 2 minutes
5. **Version tracking** - Health endpoint now shows version, deployment time, and uptime

---

## Rollback (If Needed)

```bash
# Disable SMS tracker
nano .env
# Set: SMS_TRACKER_ENABLED=false

# Restart
pm2 restart all
```

---

**Deploy now and monitor logs!** 🚀
