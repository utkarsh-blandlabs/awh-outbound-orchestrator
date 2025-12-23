# 🔄 Configuration Persistence Guide

## Quick Answer: YES, Configs Persist!

✅ **Configurations persist** across deployments and rebuilds
✅ **Data persists** across PM2 restarts
✅ **Holiday schedule persists** after code updates

**BUT:** Fresh deployments need configs re-applied.

---

## What Persists vs. What Rebuilds

### ✅ PERSISTS (Survives npm run build + PM2 restart)

#### 1. Configuration Files (`data/` directory)
```
data/
├── scheduler-config.json          ← Holiday blackout dates
├── call-protection-config.json    ← Protection rules
├── redial-queue-config.json       ← Redial settings
├── am-tracker-config.json         ← AM tracker config
└── request-queue.json             ← Queued leads
```

**Why:** These are runtime data, not build artifacts

#### 2. Data Files (Organized by date)
```
data/
├── daily-calls/
│   ├── calls_2024-12-23.json     ← Today's call history
│   ├── calls_2024-12-24.json     ← Tomorrow's calls
│   └── ...
├── statistics/
│   ├── stats_2024-12-23.json     ← Today's stats
│   └── ...
├── redial-queue/
│   ├── queue_2024-12.json        ← This month's redial queue
│   └── ...
└── am-tracker/
    ├── records_2024-12-23.json   ← Today's AM records
    └── ...
```

**Why:** Historical data, needed for analytics

#### 3. Environment Variables
```
.env  ← All API keys, settings, phone numbers
```

**Why:** Not part of source code

---

### ❌ DOES NOT PERSIST (Gets Rebuilt)

#### 1. Compiled JavaScript
```
dist/  ← Completely regenerated on each build
```

**Why:** This IS the build artifact

#### 2. In-Memory State (Lost on PM2 restart)
- CallStateManager pending calls
- setTimeout timers (30-min transfer protection)
- Rate limiter active slots
- Cached configurations

**Why:** RAM-based, not file-based

---

## Deployment Scenarios

### Scenario 1: Normal Code Update (SAFE ✅)

**Steps:**
```bash
git pull
npm run build    # Only rebuilds dist/
pm2 restart      # Reloads code
```

**What happens:**
- ✅ Code updated
- ✅ Configs unchanged
- ✅ Data intact
- ✅ Holiday schedule still active

**Risk:** None - Everything persists

---

### Scenario 2: Fresh Clone / New Server (CAUTION ⚠️)

**Steps:**
```bash
git clone <repo>
npm install
npm run build
cp .env.example .env  # Configure environment
pm2 start
```

**What happens:**
- ❌ No `data/` directory
- ❌ Configs = DEFAULT VALUES
- ❌ NO holiday blackout dates
- ❌ NO custom protection rules

**Fix Required:**
```bash
# Re-apply holiday schedule
./update-holiday-schedule.sh

# OR restore from backup
./restore-configs.sh 2024-12-23_14-30-00
```

---

### Scenario 3: Server Migration (BACKUP REQUIRED 📦)

**Before migration:**
```bash
# On old server
./backup-configs.sh
```

**On new server:**
```bash
git clone <repo>
npm install
npm run build
# Copy backup from old server
scp old-server:~/awh-orchestrator/config-backups/backup_* ./config-backups/
./restore-configs.sh 2024-12-23_14-30-00
pm2 start
```

---

## Backup & Restore Commands

### Create Backup
```bash
./backup-configs.sh
```

**Creates:**
```
config-backups/
└── backup_2024-12-23_14-30-00/
    ├── data/
    │   ├── scheduler-config.json
    │   ├── call-protection-config.json
    │   ├── redial-queue-config.json
    │   ├── am-tracker-config.json
    │   └── ... (all data files)
    ├── .env
    └── MANIFEST.txt
```

**Keeps:** Last 10 backups automatically

---

### Restore Backup
```bash
# List available backups
./restore-configs.sh

# Restore specific backup
./restore-configs.sh 2024-12-23_14-30-00

# Restart service
pm2 restart awh-orchestrator
```

---

## What Gets Backed Up

### Configuration Files (Small, Critical)
- Holiday blackout dates → `scheduler-config.json`
- Call protection rules → `call-protection-config.json`
- Redial queue settings → `redial-queue-config.json`
- AM tracker config → `am-tracker-config.json`

### Data Files (Large, Valuable)
- Call history (last 30 days)
- Statistics (all time)
- Redial queue records
- AM tracker records
- Queued requests

### Environment File
- API keys
- Phone numbers
- Bland AI configuration
- Convoso credentials

---

## Recommended Workflow

### Before Major Deployment
```bash
# 1. Backup current config
./backup-configs.sh

# 2. Pull new code
git pull

# 3. Build
npm run build

# 4. Test (optional)
npm test

# 5. Restart
pm2 restart awh-orchestrator

# 6. Verify holiday schedule still active
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/scheduler/config | \
  jq '.blackoutDates'
```

### If Something Goes Wrong
```bash
# Restore previous config
./restore-configs.sh 2024-12-23_14-30-00

# Restart
pm2 restart awh-orchestrator
```

---

## Holiday Schedule Verification

After any deployment, verify blackout dates are still set:

**Command:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/scheduler/config | \
  jq '.blackoutDates'
```

**Expected Output:**
```json
[
  "2024-12-24",
  "2024-12-25",
  "2024-12-31",
  "2025-01-01"
]
```

**If empty `[]` returned:**
```bash
# Re-apply holiday schedule
./update-holiday-schedule.sh
```

---

## Auto-Creation of Missing Configs

If config files don't exist, services create **defaults**:

### Scheduler Default
```json
{
  "enabled": true,
  "callbacksEnabled": true,
  "timezone": "America/New_York",
  "schedule": {
    "days": [1, 2, 3, 4, 5],
    "startTime": "09:00",
    "endTime": "17:00"
  }
  // ❌ NO blackoutDates - needs manual addition
}
```

### Call Protection Default
```json
{
  "enabled": true,
  "rules": {
    "block_on_transferred": true,
    "block_on_sold": true,
    "block_on_not_interested": true,
    "allow_voicemail_retry": true,
    "allow_no_answer_retry": true
  },
  "duplicate_window_minutes": 10,
  "max_daily_attempts_per_number": 3,
  "allow_different_lead_ids": false
}
```

---

## Git Considerations

### .gitignore Settings
```bash
# Build artifacts (excluded)
dist/
node_modules/

# Data directory (excluded for privacy/size)
data/

# Environment (excluded for security)
.env

# Backups (excluded for size)
config-backups/
```

**Implication:** `data/` directory NOT in git, so fresh clones won't have configs.

---

## Production Best Practices

### 1. **Always Backup Before Updates**
```bash
./backup-configs.sh
git pull
npm run build
pm2 restart awh-orchestrator
```

### 2. **Verify After Deployment**
```bash
# Check health
curl http://localhost:3000/health

# Check blackout dates
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/scheduler/config | \
  jq '.blackoutDates'

# Check active calls
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/calls/active
```

### 3. **Schedule Regular Backups**
```bash
# Add to crontab
0 2 * * * cd /path/to/awh-orchestrator && ./backup-configs.sh
```

### 4. **Document Custom Settings**
Keep a note of:
- Holiday blackout dates
- Custom protection rules
- Modified redial intervals
- Special AM tracker settings

---

## Summary

| Item | Persists on Build? | Persists on Restart? | Persists on Clone? |
|------|-------------------|---------------------|-------------------|
| **Configs (data/)** | ✅ Yes | ✅ Yes | ❌ No (need backup) |
| **Data files** | ✅ Yes | ✅ Yes | ❌ No (need backup) |
| **.env file** | ✅ Yes | ✅ Yes | ❌ No (manual copy) |
| **Compiled code (dist/)** | ❌ Rebuilt | ✅ Yes | ❌ Need build |
| **In-memory state** | ✅ Yes | ❌ No | ❌ No |

**Golden Rule:**
> `npm run build` = Safe ✅
> `git clone` = Need restore ⚠️

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `./backup-configs.sh` | Backup all configs and data |
| `./restore-configs.sh TIMESTAMP` | Restore from backup |
| `./update-holiday-schedule.sh` | Re-apply holiday schedule |
| `npm run build` | Rebuild code only |
| `pm2 restart awh-orchestrator` | Reload service |

---

**Last Updated:** December 23, 2024
**Status:** Production Ready
**Backup Strategy:** Automated + Manual
