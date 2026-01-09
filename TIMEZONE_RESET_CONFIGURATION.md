# Timezone & Reset Configuration Changes - January 8, 2026

## Summary

Updated the system to support configurable reset timing and timezone behavior for TCPA compliance.

---

## 🔧 Changes Made

### 1. Added New Environment Variables

**File**: [.env:141-149](claude/awh-outbound-orchestrator/.env#L141-L149)

```bash
# Daily Reset Configuration
REDIAL_MAX_DAILY_ATTEMPTS=8
# Reset timing: 'midnight' (12:01 AM) or 'business_hours' (before start, after end)
REDIAL_RESET_TIMING=business_hours
# Hour (0-23) to reset daily counters when using 'midnight' mode (0 = 12:01 AM EST)
REDIAL_DAILY_RESET_HOUR=0

# Timezone Configuration
# TCPA_DYNAMIC_TIMEZONE: If true, uses customer's local timezone for TCPA hours (11 AM - 8 PM)
# If false (default), everyone uses EST timezone for TCPA compliance
TCPA_DYNAMIC_TIMEZONE=false
```

### 2. Updated Redial Queue Service

**File**: [src/services/redialQueueService.ts](claude/awh-outbound-orchestrator/src/services/redialQueueService.ts)

#### Added `reset_timing` to Config Interface (Line 42):
```typescript
interface RedialQueueConfig {
  // ... existing fields
  reset_timing: "midnight" | "business_hours"; // When to reset daily counters
}
```

#### Updated Constructor to Read Config (Line 88):
```typescript
reset_timing: (process.env["REDIAL_RESET_TIMING"] || "business_hours") as "midnight" | "business_hours",
```

#### Enhanced Reset Scheduler (Lines 169-271):
- **Midnight Mode**: Resets at 12:01 AM EST (original behavior)
- **Business Hours Mode**: Resets at two times:
  - **Before Start**: 5 minutes before business opens (e.g., 10:55 AM for 11:00 AM start)
  - **After End**: Exactly when business closes (e.g., 8:00 PM for 20:00 end)

---

## 📋 Configuration Details

### Reset Timing Modes

#### Option 1: Midnight Reset (Traditional)
```bash
REDIAL_RESET_TIMING=midnight
REDIAL_DAILY_RESET_HOUR=0  # 12:01 AM EST
```

**Behavior**:
- Daily counters reset at midnight (12:01 AM EST)
- Leads that hit daily max can be called again after midnight
- Single reset per day

#### Option 2: Business Hours Reset (NEW - Default)
```bash
REDIAL_RESET_TIMING=business_hours
```

**Behavior**:
- Reads business hours from `data/scheduler-config.json`
- **Morning Reset**: 5 minutes before business starts
  - Example: For 11:00 AM start → resets at 10:55 AM
- **Evening Reset**: Exactly when business ends
  - Example: For 8:00 PM end → resets at 8:00 PM
- Two resets per day (morning + evening)

**Why This Is Better**:
- Ensures fresh daily counters when business starts
- Cleans up at end of day for next morning
- Prevents midnight downtime from affecting operations

---

## 🌍 Timezone Behavior

### Current Configuration (Default)
```bash
TCPA_DYNAMIC_TIMEZONE=false
```

**Everyone uses EST timezone for TCPA compliance**:
- All calls/SMS: 11 AM - 8 PM **EST**
- No per-customer timezone detection
- Simpler, consistent behavior
- Recommended for initial deployment

### Future Option (Not Yet Implemented)
```bash
TCPA_DYNAMIC_TIMEZONE=true
```

**Would use customer's local timezone** (requires additional implementation):
- California customer: 11 AM - 8 PM **PST**
- New York customer: 11 AM - 8 PM **EST**
- Texas customer: 11 AM - 8 PM **CST**
- Requires zip code → timezone mapping
- More complex but better TCPA compliance

---

## 📊 How Business Hours Reset Works

### Example with 11:00 AM - 8:00 PM Schedule

**10:55 AM EST** (5 min before start):
```
[INFO] Daily reset triggered {
  time_est: "10:55",
  reset_reason: "before_business_hours",
  reset_timing_mode: "business_hours"
}
[INFO] Reset daily attempt counters for new day { leads_reset: 45 }
```

**Result**:
- All leads that hit daily max (8 calls) yesterday → back to `pending`
- `attempts_today` counter → reset to 0
- Fresh start for the day

**8:00 PM EST** (exactly at end):
```
[INFO] Daily reset triggered {
  time_est: "20:00",
  reset_reason: "after_business_hours",
  reset_timing_mode: "business_hours"
}
[INFO] Reset daily attempt counters for new day { leads_reset: 23 }
```

**Result**:
- Cleanup for any leads that hit max during the day
- Prepares for next morning
- Next morning reset will be fresh regardless

---

## 🚀 Deployment Instructions

### Already Done Locally:
- ✅ `.env` updated with new variables
- ✅ `redialQueueService.ts` updated with new logic
- ✅ Compiled successfully (`npm run build`)

### To Deploy to Production:

#### Step 1: Update .env on Production Server
```bash
ssh ec2-user@your-server
cd awh-outbound-orchestrator
nano .env
```

Add these lines (around line 141):
```bash
REDIAL_RESET_TIMING=business_hours
TCPA_DYNAMIC_TIMEZONE=false
```

#### Step 2: Deploy Updated Code
```bash
# On local machine
cd /Users/utkarshjaiswal/Documents/BlandLabs/claude/awh-outbound-orchestrator
npm run build
scp -r dist/ ec2-user@your-server:~/awh-outbound-orchestrator/
```

#### Step 3: Restart PM2
```bash
ssh ec2-user@your-server
cd awh-outbound-orchestrator
pm2 restart awh-orchestrator
```

#### Step 4: Verify Configuration Loaded
```bash
pm2 logs awh-orchestrator --lines 50 | grep -i "reset scheduler"
```

Expected output:
```
[INFO] Daily reset scheduler started {
  check_interval_seconds: 60,
  reset_timing: "business_hours",
  note: "Resets before business start and after business end"
}
```

---

## 📝 Monitoring After Deployment

### Check Reset Logs

**Morning Reset (before business hours)**:
```bash
pm2 logs awh-orchestrator | grep "before_business_hours"
```

Expected around 10:55 AM EST:
```
[INFO] Daily reset triggered {
  time_est: "10:55",
  reset_reason: "before_business_hours"
}
[INFO] Reset daily attempt counters for new day { leads_reset: 45 }
```

**Evening Reset (after business hours)**:
```bash
pm2 logs awh-orchestrator | grep "after_business_hours"
```

Expected at 8:00 PM EST:
```
[INFO] Daily reset triggered {
  time_est: "20:00",
  reset_reason: "after_business_hours"
}
[INFO] Reset daily attempt counters for new day { leads_reset: 12 }
```

---

## 🔄 Switching Between Modes

### To Use Midnight Reset (Old Behavior):
```bash
# In .env
REDIAL_RESET_TIMING=midnight
REDIAL_DAILY_RESET_HOUR=0  # or any hour 0-23

# Restart
pm2 restart awh-orchestrator
```

### To Use Business Hours Reset (New Default):
```bash
# In .env
REDIAL_RESET_TIMING=business_hours

# Restart
pm2 restart awh-orchestrator
```

---

## 📅 Business Hours Configuration

The business hours are read from: `data/scheduler-config.json`

**Current Config**:
```json
{
  "enabled": true,
  "timezone": "America/New_York",
  "schedule": {
    "days": [1, 2, 3, 4, 5],
    "startTime": "11:00",
    "endTime": "20:00"
  }
}
```

**Reset Times**:
- Morning: `10:55 AM` (5 min before 11:00)
- Evening: `8:00 PM` (exactly at 20:00)

### To Change Business Hours:
```bash
# Edit scheduler config
nano data/scheduler-config.json

# Change startTime/endTime
"startTime": "09:00",  # Opens at 9 AM
"endTime": "17:00"     # Closes at 5 PM

# Restart
pm2 restart awh-orchestrator
```

**New Reset Times**:
- Morning: `8:55 AM` (5 min before 9:00)
- Evening: `5:00 PM` (exactly at 17:00)

---

## ⚠️ Important Notes

### 1. All Times Are EST
- Server uses `America/New_York` timezone
- Business hours are in EST
- Reset times are in EST
- TCPA hours currently EST for all customers (`TCPA_DYNAMIC_TIMEZONE=false`)

### 2. Two Resets Per Day in Business Hours Mode
- Morning reset prepares for the day
- Evening reset cleans up at close
- Both resets do the same thing (reset `attempts_today` counters)
- Second reset ensures clean state if something weird happened during the day

### 3. Backward Compatible
- Default is `business_hours` mode for new deployments
- Can switch to `midnight` mode by changing env variable
- No data loss when switching modes

### 4. TCPA Dynamic Timezone Not Yet Implemented
- `TCPA_DYNAMIC_TIMEZONE=false` is the only working mode currently
- Setting to `true` won't do anything yet (no code implemented)
- Future enhancement would require:
  - Zip code → timezone mapping
  - Per-lead timezone detection
  - TCPA hour calculation per timezone

---

## 🧪 Testing

### Test Morning Reset:
```bash
# Change current time in scheduler config to trigger reset
# Or wait until 10:55 AM EST
pm2 logs awh-orchestrator --lines 100 | grep "before_business_hours"
```

### Test Evening Reset:
```bash
# Wait until 8:00 PM EST
pm2 logs awh-orchestrator --lines 100 | grep "after_business_hours"
```

### Verify Counters Reset:
```bash
# Check that leads at daily_max_reached are now pending
pm2 logs awh-orchestrator | grep "Reset lead from daily_max_reached to pending"
```

---

## 📁 Files Changed

1. **`.env`** (Lines 141-149)
   - Added `REDIAL_RESET_TIMING` variable
   - Added `TCPA_DYNAMIC_TIMEZONE` variable

2. **`src/services/redialQueueService.ts`**
   - Line 42: Added `reset_timing` to interface
   - Line 88: Load `reset_timing` from env
   - Lines 169-271: Enhanced reset scheduler with business hours support

3. **`dist/`** - Rebuilt TypeScript (ready for deployment)

---

## ✅ Summary

**Default Behavior (Now)**:
- Reset timing: **Business hours** (10:55 AM + 8:00 PM EST)
- TCPA timezone: **EST for everyone**
- Two resets per day for cleaner operations

**Previous Behavior**:
- Reset timing: Midnight (12:01 AM EST)
- TCPA timezone: EST for everyone
- One reset per day

**Benefits**:
- ✅ Fresh counters when business opens
- ✅ Clean slate ready for next day
- ✅ No midnight downtime affecting operations
- ✅ Backward compatible (can switch back to midnight)
- ✅ Ready for future dynamic timezone support
