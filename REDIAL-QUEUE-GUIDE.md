# Redial Queue System - Complete Guide

## 📋 Summary of Changes

### Core Problem Identified
- **Miscommunication**: The orchestrator was NOT handling multi-day redial logic (thought Convoso would trigger it)
- **Current state**: Only 124 leads in redial queue (last 2-3 days only)
- **Should be**: ALL leads since December 1st/22nd being redialed daily until SALE or DNC
- **Impact**: ~200 calls/day instead of 5,000-10,000+ calls/day

### Critical Business Rules (From Delaine/Anthony)
1. **Only 2 statuses remove leads from redialing**: `SALE`, `DNC`
2. **Everything else continues redialing**: `TRANSFERRED` (not sale), `VOICEMAIL`, `NO_ANSWER`, `BUSY`, `CALLBACK`, etc.
3. **8 calls per day max**, continues **EVERY DAY** across multiple days until success
4. **Progressive intervals**: Use `REDIAL_PROGRESSIVE_INTERVALS` [0,2,5,10,30,60,120] from env
5. **Scheduled callbacks**: Return to queue, let it happen naturally (no special handling)

---

## 🎯 Tasks & Goals

### ✅ Immediate (For Anthony Meeting)
1. ✅ Total leads from Dec 22 to now
2. ✅ Total leads still for redialing (non-sale, non-DNC)
3. ✅ Total non-sale count
4. ✅ Total non-DNC count
5. ✅ Total DNC count

### 🚀 Short-term (Deploy ASAP)
1. ✅ Fix redial frequency to use env `REDIAL_PROGRESSIVE_INTERVALS` consistently
2. ✅ Create one-time backfill script to pull all leads from Bland (Dec 1 or Dec 22)
3. ✅ Add all non-sale/non-DNC to redial queue
4. ✅ Create detailed breakdown reports

### 📊 Long-term
1. Build dashboard for monitoring
2. Automated daily reports via API
3. Handle scheduled callbacks with dedicated tracking
4. Monitor AWS costs and optimize

---

## ⚠️ Edge Cases Handled

### 1. Duplicate Phone Numbers
**Problem**: Same phone number appears in multiple list IDs in Convoso
**Solution**: Use first match when querying Convoso, store by phone number only (not list_id)

### 2. Rate Limiters
**Problem**: Convoso limits API calls (~200 req/sec), Bland has limits
**Solution**: Batch requests (50 at a time), add 1-second delay between batches

### 3. AWS Cost Spikes
**Problem**: 6000+ leads calling 8x/day = exponential Lambda/API costs
**Solution**:
- Monitor costs via CloudWatch
- Still cheaper than human fronters (~$15k/month saved)
- Optimize with batching and queue processing

### 4. Memory Issues
**Problem**: Large datasets (months of leads) can cause memory leaks
**Solution**: Stream/batch processing, periodic file saves, monthly file rotation

### 5. Scheduled Callbacks
**Problem**: Lead requests callback at specific time
**Solution**: Return to queue naturally with `next_redial_timestamp` set to callback time

### 6. Partial Data
**Problem**: Lead exists in Bland but not in Convoso (deleted/removed)
**Solution**: Skip gracefully with error logging, continue processing others

### 7. Status Mapping
**Problem**: Different outcome formats (`TRANSFERRED` vs `transfer` vs `TRANSFER_SALE`)
**Solution**: Normalize to uppercase, check for substrings, handle variations

---

## 📁 Scripts Available

### 1. `get-detailed-breakdown.js`
**Purpose**: Detailed breakdown of leads by outcome for date range (Dec 22 - today)

**Run**:
```bash
node get-detailed-breakdown.js
```

**Output**:
- Total leads in period
- Active for redialing
- TRANSFERRED (not sale yet) - **still needs redialing!**
- Completed with SALE - **stops redialing**
- Completed with DNC - **stops redialing**
- Completed with other outcomes (voicemail, no answer, etc.)
- Should continue redialing count
- Total non-sale, non-DNC counts

**Use Case**: For Anthony meeting - shows exactly how many leads should be getting 8 calls/day

---

### 2. `get-date-range-report.js`
**Purpose**: Leads and calls data for specific date range with statistics

**Run**:
```bash
node get-date-range-report.js
```

**Output**:
- Total leads created in period
- Total calls done
- Total redials (calls beyond first attempt)
- Call outcomes breakdown
- Connectivity rate, transfer rate

**Use Case**: Performance metrics for team sync meetings

---

### 3. `get-total-leads.js`
**Purpose**: Quick all-time totals

**Run**:
```bash
node get-total-leads.js
```

**Output**:
- Total leads (lifetime)
- Active leads for redialing
- Leads from yesterday
- Leads from older days
- Daily max reached
- Completed leads

**Use Case**: Quick snapshot of queue health

---

### 4. `backfill-from-bland.js` ⭐ **CRITICAL** (RECOMMENDED)
**Purpose**: ONE-TIME backfill script - pulls leads directly from Bland.ai API

**Features**:
- ✅ Pulls ALL calls from Bland.ai (Dec 1, 2025 - Jan 7, 2026)
- ✅ Checks status in Convoso for each lead
- ✅ Only adds non-sale/non-DNC leads to queue
- ✅ Memory optimized (periodic saves, GC enabled)
- ✅ Rate limit safe (batched API calls)
- ✅ Handles duplicate phone numbers (first match)
- ✅ Progress tracking with ETA
- ✅ Dry-run mode for testing

**Run**:
```bash
# Using npm scripts (RECOMMENDED - enables GC):
npm run backfill:dry-run    # Test run (no changes)
npm run backfill             # Real run

# Or directly:
node --expose-gc backfill-from-bland.js --dry-run
node --expose-gc backfill-from-bland.js

# Custom batch size (default: 50)
node --expose-gc backfill-from-bland.js --batch-size=30
```

**Output**:
- Total calls fetched from Bland.ai
- Unique phone numbers extracted
- Convoso status check results
- Filtering breakdown (should redial, skip sale, skip DNC)
- New leads added to queue
- Expected daily call volume

**Use Case**: Deploy this ONCE to backfill all historical leads from Bland.ai

**Why This One?**:
- More reliable (pulls from Bland.ai directly, not webhook logs)
- Works even if webhook logging wasn't enabled early
- Verifies status in Convoso before adding
- Better memory management

---

### 5. `backfill-redial-queue.js` (ALTERNATIVE)
**Purpose**: ONE-TIME backfill script - uses webhook logs (local data)

**Features**:
- Extracts unique phones from webhook logs (Dec 1 or Dec 22 onwards)
- Checks existing redial queue to avoid duplicates
- Adds non-sale/non-DNC leads to queue
- Handles rate limiting with batching
- Dry-run mode for testing

**Run**:
```bash
node backfill-redial-queue.js --dry-run
node backfill-redial-queue.js --start-date=2025-12-01
```

**Use Case**: Use only if you DON'T have Bland API access, or if webhook logs are more complete

**Note**: The `backfill-from-bland.js` script is PREFERRED for most cases

---

## 🚀 Deployment Steps

### Step 1: Test Locally (Optional)
```bash
# Local:
npm run build

# Test dry run
node backfill-redial-queue.js --dry-run
node get-detailed-breakdown.js
```

### Step 2: Commit Changes
```bash
git add .
git commit -m "Add redial queue backfill system and reporting scripts

- Fix redial frequency to use REDIAL_PROGRESSIVE_INTERVALS consistently
- Add backfill-redial-queue.js for historical leads
- Add detailed breakdown reporting
- Handle edge cases: duplicates, rate limits, memory optimization
- Only SALE and DNC stop redialing per business rules"

git push
```

### Step 3: Deploy to EC2
```bash
# SSH to EC2
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Navigate to app
cd /var/www/awh-orchestrator

# Pull latest code
git pull

# Build
npm run build

# IMPORTANT: Run detailed breakdown FIRST (for Anthony meeting)
npm run report:breakdown > anthony-report.txt

# Save output for Anthony meeting
cat anthony-report.txt

# Run backfill TEST (dry run - no changes)
npm run backfill:dry-run

# If dry run looks good, run REAL backfill
# This pulls from Bland.ai (Dec 1 - Jan 7, 2026) and adds to queue
npm run backfill

# Restart orchestrator
pm2 restart awh-orchestrator

# Monitor logs
pm2 logs awh-orchestrator --lines 100
```

### Step 4: Monitor & Verify
```bash
# Check queue processor is working
pm2 logs awh-orchestrator | grep "Processing redial queue"

# Check call volume increases
watch -n 30 'curl -s -H "X-API-Key: YOUR_KEY" http://localhost:3000/api/admin/statistics/today | jq .total_calls'

# Check active leads
node get-total-leads.js
```

---

## 📊 Expected Results

### Before Backfill
- **Active leads**: ~124 (last 2-3 days only)
- **Daily calls**: ~200-1000
- **Problem**: Missing ~700+ historical leads

### After Backfill
- **Active leads**: ~850+ (all from Dec 22 onwards)
- **Daily calls**: ~6,800 (850 leads × 8 calls/day)
- **Result**: Matches fronter call volume

---

## 🔍 Monitoring & Troubleshooting

### Check Queue Health
```bash
# Total leads in queue
node get-total-leads.js

# Detailed breakdown
node get-detailed-breakdown.js

# Daily calls
curl -s -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/statistics/today | jq .
```

### Check for Errors
```bash
# PM2 logs
pm2 logs awh-orchestrator --lines 500

# Error logs only
pm2 logs awh-orchestrator --err

# Application logs
tail -f logs/application.log
```

### Common Issues

**Issue**: Backfill script fails with "webhook logs not found"
**Solution**: Webhook logging must be enabled (`WEBHOOK_LOGGING_ENABLED=true` in .env)

**Issue**: Calls not increasing after backfill
**Solution**:
1. Check PM2 restarted: `pm2 status`
2. Check queue processor running: `pm2 logs | grep "Processing redial queue"`
3. Check business hours (11 AM - 8 PM EST only, configured in `data/scheduler-config.json`)

**Issue**: AWS costs spike
**Solution**:
1. Check CloudWatch costs
2. Verify batch sizes are reasonable
3. Adjust `REDIAL_PROCESS_INTERVAL` in .env (increase from 5 to 10 minutes)

---

## 🎯 For Anthony Meeting

### Key Messages

1. **Root Cause Identified**: Miscommunication on multi-day redial logic
2. **Fix Deployed**: Backfill script adds all historical leads (Dec 22 onwards)
3. **Business Rules Confirmed**: Only SALE and DNC stop redialing (everything else continues)
4. **Expected Volume**: ~6,800 calls/day (850 leads × 8 calls/day)
5. **Timeline**: Deployed immediately, full volume within 24 hours

### Data to Share

Run these commands on EC2 BEFORE the meeting:

```bash
# Get detailed breakdown
node get-detailed-breakdown.js > anthony-report.txt

# Get date range stats
node get-date-range-report.js >> anthony-report.txt

# Share anthony-report.txt with Anthony
cat anthony-report.txt
```

**Key Numbers**:
- Total leads (Dec 22 - now): 852
- Should continue redialing: ~850 (only 2-3 were sales/DNC)
- Expected daily calls: 6,800+
- Days missed: ~16 days (Dec 22 - Jan 7)
- Recovery: Immediate (backfill deployed)

---

## 📝 Notes

### Why Backfill is Critical
- **Before**: Only tracking last 2-3 days of leads
- **After**: Tracking ALL leads since Dec 22 (or Dec 1 if chosen)
- **Impact**: 200 calls/day → 6,800+ calls/day

### Why This Matters
- American WeHealth business runs on Ashley
- Fronters were doing 16,000+ calls/day
- Ashley needs to match or exceed that volume
- Missing redialing = lost revenue for client

### Cost Considerations
- AWS costs will increase with call volume
- Still 90%+ cheaper than human fronters ($15k/month saved)
- Monitor CloudWatch for unexpected spikes
- Optimize if needed (batch sizes, intervals)

---

## ✅ Checklist

### Pre-Deployment
- [ ] Code changes committed and pushed
- [ ] Tested backfill script in dry-run mode
- [ ] Verified webhook logs exist (Dec 22 onwards)
- [ ] Confirmed TCPA hours configured correctly

### Deployment
- [ ] Pulled latest code on EC2
- [ ] Built TypeScript (`npm run build`)
- [ ] Ran detailed breakdown (for Anthony meeting)
- [ ] Ran backfill script (adds historical leads)
- [ ] Restarted PM2 (`pm2 restart awh-orchestrator`)
- [ ] Verified queue processor running

### Post-Deployment
- [ ] Monitor call volume increase (watch for ~6,800/day)
- [ ] Check PM2 logs for errors
- [ ] Share anthony-report.txt with Delaine/Anthony
- [ ] Monitor AWS costs in CloudWatch
- [ ] Verify leads are being redialed across days

---

## 🆘 Emergency Contact

If something goes wrong:

1. **Stop the orchestrator**: `pm2 stop awh-orchestrator`
2. **Check logs**: `pm2 logs awh-orchestrator --err`
3. **Rollback**: `git reset --hard <previous-commit>` then rebuild and restart
4. **Contact**: Joshua, Delaine, or Utkarsh

---

## 🎓 Understanding the System

### How Redialing Works

1. **Lead comes in** → Added to redial queue with status `pending`
2. **Queue processor runs** (every 5 min) → Picks leads ready to call
3. **Call initiated** → Bland makes the call
4. **Outcome received** → Webhook updates lead status
5. **Outcome = SALE or DNC** → Lead marked `completed`, removed from redialing
6. **Outcome = anything else** → Schedule next redial (progressive intervals)
7. **Daily max (8) reached** → Status → `daily_max_reached`, retry tomorrow
8. **12:01 AM EST** → Reset `attempts_today` to 0, status → `pending`
9. **Repeat** → Continue until SALE or DNC

### Why Progressive Intervals

- **1st call**: Instant (0 min)
- **2nd call**: 2 minutes later
- **3rd call**: 5 minutes later
- **4th call**: 10 minutes later
- **5th call**: 30 minutes later
- **6th call**: 60 minutes later
- **7th call**: 120 minutes later
- **8th call**: 120 minutes later (max interval)

This matches fronter behavior: aggressive at first, then spaced out.

### Business Hours & TCPA Compliance

#### TCPA = Telephone Consumer Protection Act

- US federal law regulating telemarketing and automated calls
- Violations can result in $500-$1,500 per call in fines

#### Configured Hours

- **11 AM - 8 PM EST** (9 hours/day)
- **Monday - Friday only**
- Configured in: `data/scheduler-config.json`

#### How it works

- Queue processor only runs during business hours
- Calls scheduled outside hours are delayed until next business day
- Automatic timezone detection per lead (based on state)
- System respects blackout dates (holidays)

#### Capacity Impact

- 9 hours/day = 540 minutes of calling time
- 980 leads × 8 calls/day = 7,840 calls/day = ~15 calls/minute
- System can handle up to ~20-30 calls/minute before hitting API limits

---

## 📚 Additional Resources

- **Redial Queue Service**: [src/services/redialQueueService.ts](src/services/redialQueueService.ts)
- **Queue Processor**: [src/services/queueProcessorService.ts](src/services/queueProcessorService.ts)
- **Daily Report API**: [src/routes/dailyReportRoutes.ts](src/routes/dailyReportRoutes.ts)
- **Statistics Service**: [src/services/statisticsService.ts](src/services/statisticsService.ts)

---

**Document Version**: 1.0
**Last Updated**: 2026-01-07
**Author**: Utkarsh Jaiswal
**Reviewed By**: Delaine Bueno, Joshua Collin
