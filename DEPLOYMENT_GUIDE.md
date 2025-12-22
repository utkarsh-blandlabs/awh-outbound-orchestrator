# EC2 Production Deployment Guide

## Overview
This guide provides step-by-step instructions to deploy the latest code changes to your EC2 production server, including the new progressive redial intervals feature.

## What's New in This Deployment

### 1. **Progressive Redial Intervals (Fronter Behavior)**
- Changed from fixed 30-minute intervals to dynamic progressive intervals
- Default cadence: 0, 0, 5, 10, 30, 60, 120 minutes
- **1st call**: INSTANT (initial call from webhook)
- **2nd call**: INSTANT (0 minutes after 1st if not picked up)
- **3rd call**: INSTANT (0 minutes after 2nd if not picked up)
- **4th call**: 5 minutes after 3rd
- **5th call**: 10 minutes after 4th
- **6th call**: 30 minutes after 5th
- **7th call**: 60 minutes (1 hour) after 6th
- **8th call**: 120 minutes (2 hours) after 7th

### 2. **Increased Max Attempts**
- Changed from 4 to 8 attempts (matching Fronter's 8-call cadence)

### 3. **Dynamic Configuration**
- Both intervals and max attempts are now fully configurable via .env
- `REDIAL_PROGRESSIVE_INTERVALS`: Comma-separated list of intervals in minutes
- `REDIAL_MAX_ATTEMPTS`: Maximum number of redial attempts

---

## Pre-Deployment Checklist

Before deploying, ensure you have:
- [ ] SSH access to your EC2 server
- [ ] Server IP address or hostname
- [ ] Git repository is set up on EC2
- [ ] PM2 is installed and running
- [ ] Admin API key handy for testing

---

## Deployment Steps

### Step 1: SSH into EC2 Server

```bash
ssh -i /path/to/your-key.pem ubuntu@your-ec2-ip
```

Replace:
- `/path/to/your-key.pem` with your actual EC2 key file path
- `your-ec2-ip` with your EC2 instance IP (e.g., `56.228.64.116` or `client.blandlabs.ai`)

### Step 2: Navigate to Project Directory

```bash
cd /path/to/awh-outbound-orchestrator
```

Replace `/path/to/awh-outbound-orchestrator` with the actual path where your code is deployed.

### Step 3: Check Current Status (Optional)

```bash
# Check current PM2 status
pm2 status

# Check current Git branch and status
git status
git branch
```

### Step 4: Pull Latest Code

```bash
# Stash any local changes (if any)
git stash

# Pull latest code from main/master branch
git pull origin main

# Or if you're on master:
# git pull origin master
```

### Step 5: Update .env File

Open the .env file and update the redial queue configuration:

```bash
nano .env
```

**Find these lines** (around line 111-118):
```env
# Redial Queue Configuration
REDIAL_QUEUE_ENABLED=true
REDIAL_INTERVAL_MINUTES=30
REDIAL_MAX_ATTEMPTS=4
REDIAL_SUCCESS_OUTCOMES=TRANSFERRED,SALE,ACA,CALLBACK
REDIAL_RETENTION_DAYS=30
REDIAL_PROCESS_INTERVAL=5
```

**Replace with**:
```env
# Redial Queue Configuration
# Automatically redials leads that didn't result in sale/transfer
# Uses progressive intervals to match Fronter dialing behavior:
# 2nd call: INSTANT, 3rd: INSTANT, 4th: 5min, 5th: 10min, 6th: 30min, 7th: 1hr, 8th: 2hr
REDIAL_QUEUE_ENABLED=true
REDIAL_PROGRESSIVE_INTERVALS=0,0,5,10,30,60,120
REDIAL_MAX_ATTEMPTS=8
REDIAL_SUCCESS_OUTCOMES=TRANSFERRED,SALE,ACA,CALLBACK
REDIAL_RETENTION_DAYS=30
REDIAL_PROCESS_INTERVAL=5
```

**Save and exit**:
- Press `Ctrl + X`
- Press `Y` to confirm
- Press `Enter` to save

### Step 6: Build the Project

```bash
npm run build
```

**Expected output**:
```
> awh-outbound-orchestrator@1.0.0 build
> tsc

(Build completes with no errors)
```

### Step 7: Restart PM2 Application

```bash
pm2 restart all
```

Or if you have a specific app name:
```bash
pm2 restart awh-outbound-orchestrator
```

### Step 8: Verify Deployment

Check that the application started successfully:

```bash
# Check PM2 status
pm2 status

# Check logs for any errors
pm2 logs --lines 50

# Check if the app is responding
curl -s http://localhost:3000/health
```

**Expected health check response**:
```json
{
  "status": "ok",
  "timestamp": "2024-12-23T...",
  "uptime": 123.45
}
```

---

## Post-Deployment Testing

### Test 1: Check Redial Queue Status

```bash
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/redial-queue/status
```

**Expected response**:
```json
{
  "running": true,
  "enabled": true,
  "is_processing": false,
  "interval_minutes": 5,
  "redial_interval_minutes": 30,
  "max_attempts": 8
}
```

### Test 2: Check Redial Queue Configuration

```bash
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/redial-queue/config
```

**Expected response**:
```json
{
  "enabled": true,
  "redial_interval_minutes": 30,
  "progressive_intervals": [0, 0, 5, 10, 30, 60, 120],
  "max_redial_attempts": 8,
  "success_outcomes": ["TRANSFERRED", "SALE", "ACA", "CALLBACK"],
  "retention_days": 30,
  "process_interval_minutes": 5
}
```

### Test 3: Check Redial Queue Records

```bash
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/redial-queue/records
```

### Test 4: Check Overall Statistics

```bash
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/redial-queue/stats
```

---

## Chrome URL Testing (From Your Browser)

Replace `client.blandlabs.ai` with your actual domain/IP:

### 1. Check Status
```
http://client.blandlabs.ai/api/admin/redial-queue/status?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### 2. Check Configuration
```
http://client.blandlabs.ai/api/admin/redial-queue/config?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### 3. View All Records
```
http://client.blandlabs.ai/api/admin/redial-queue/records?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### 4. View Pending Records Only
```
http://client.blandlabs.ai/api/admin/redial-queue/records?status=pending&key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### 5. View Ready-to-Dial Records
```
http://client.blandlabs.ai/api/admin/redial-queue/records?ready=true&key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### 6. View Statistics
```
http://client.blandlabs.ai/api/admin/redial-queue/stats?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

---

## Customizing Intervals (Optional)

If you want to customize the intervals, edit the `.env` file:

```env
# Example: More aggressive (shorter intervals)
REDIAL_PROGRESSIVE_INTERVALS=0,0,3,7,20,45,90

# Example: More conservative (longer intervals)
REDIAL_PROGRESSIVE_INTERVALS=5,10,30,60,120,240,480

# Example: Fixed interval (all 15 minutes)
REDIAL_PROGRESSIVE_INTERVALS=15,15,15,15,15,15,15
```

**After changing**, rebuild and restart:
```bash
npm run build
pm2 restart all
```

---

## Rollback Plan (If Something Goes Wrong)

If the deployment causes issues:

### Option 1: Revert to Previous Git Commit

```bash
# Check commit history
git log --oneline -10

# Revert to previous commit (replace COMMIT_HASH)
git revert COMMIT_HASH

# Rebuild and restart
npm run build
pm2 restart all
```

### Option 2: Revert .env Changes

```bash
# Edit .env and change back to old values
nano .env

# Change:
REDIAL_PROGRESSIVE_INTERVALS=0,0,5,10,30,60,120
REDIAL_MAX_ATTEMPTS=8

# To:
REDIAL_MAX_ATTEMPTS=4
# (Remove REDIAL_PROGRESSIVE_INTERVALS line)

# Restart
pm2 restart all
```

---

## Monitoring After Deployment

### Watch Logs in Real-Time

```bash
pm2 logs --lines 100
```

### Check for Errors

```bash
pm2 logs --err --lines 50
```

### Monitor System Resources

```bash
pm2 monit
```

---

## Troubleshooting

### Issue: PM2 Not Found
```bash
# Install PM2 globally
npm install -g pm2
```

### Issue: Build Fails
```bash
# Clear node_modules and reinstall
rm -rf node_modules
npm install
npm run build
```

### Issue: Port Already in Use
```bash
# Check what's using port 3000
sudo lsof -i :3000

# Kill the process (replace PID)
sudo kill -9 PID
```

### Issue: Endpoints Return 404
This means the code wasn't deployed or PM2 didn't restart properly:

```bash
# Force restart PM2
pm2 stop all
pm2 start build/index.js --name awh-outbound-orchestrator

# Or
pm2 delete all
pm2 start build/index.js --name awh-outbound-orchestrator
pm2 save
```

---

## Quick Reference Commands

```bash
# Full deployment in one go
cd /path/to/awh-outbound-orchestrator && \
git pull origin main && \
npm run build && \
pm2 restart all && \
pm2 logs --lines 20

# Check everything is working
curl -s http://localhost:3000/health && \
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/redial-queue/config

# Monitor logs
pm2 logs --lines 100
```

---

## Support

If you encounter any issues:
1. Check PM2 logs: `pm2 logs`
2. Check system logs: `journalctl -u pm2-ubuntu -n 50`
3. Verify .env file: `cat .env | grep REDIAL`
4. Test endpoints locally: `curl http://localhost:3000/health`

---

## Summary of Changes

| Setting | Old Value | New Value |
|---------|-----------|-----------|
| `REDIAL_MAX_ATTEMPTS` | 4 | 8 |
| `REDIAL_INTERVAL_MINUTES` | 30 | (deprecated) |
| `REDIAL_PROGRESSIVE_INTERVALS` | (not set) | 0,0,5,10,30,60,120 |

**Key Benefits**:
- ✅ Matches Fronter's 8-call dialing behavior
- ✅ Progressive intervals optimize contact rates
- ✅ Fully configurable via .env (no code changes needed)
- ✅ Backward compatible (falls back to defaults if env vars missing)
- ✅ Active call conflict detection (pushes redial ahead if call ongoing)

---

**Deployment completed! Your redial queue is now using progressive intervals matching Fronter's behavior.**
