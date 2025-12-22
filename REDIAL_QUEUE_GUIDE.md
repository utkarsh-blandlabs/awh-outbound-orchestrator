# Redial Queue System - Complete Guide

## 📋 Overview

The Redial Queue automatically redials leads that didn't result in a sale or transfer. It handles:
- ✅ Automatic redialing every 30 minutes (configurable)
- ✅ Scheduled callbacks at specific times
- ✅ Max attempt limits (default: 4)
- ✅ Success outcome detection (TRANSFERRED, SALE, etc.)
- ✅ File persistence (30 days retention)
- ✅ Atomic file writes (prevents data corruption)
- ✅ File locking (handles concurrent writes)
- ✅ Integration with business hours scheduler
- ✅ Dynamic on/off control via API
- ✅ Per-lead pause/resume/remove controls

---

## 🏗️ Architecture & Edge Cases Handled

### 1. **Concurrent Write Protection**
- ✅ File locking mechanism prevents simultaneous writes
- ✅ Atomic writes (write to `.tmp` then rename)
- ✅ Wait-for-lock with timeout (max 5 seconds)

### 2. **Convoso Duplicate Call Handling**
- ✅ Tracks by lead_id + phone_number (unique key)
- ✅ If Convoso calls same lead, updates existing record
- ✅ Both systems update same redial queue entry

### 3. **Memory Management**
- ✅ Monthly file rotation (one file per month)
- ✅ Automatic cleanup of files older than 30 days
- ✅ No in-memory cache growth (Map is file-backed)

### 4. **Success Detection**
- ✅ Configurable success outcomes: `TRANSFERRED`, `SALE`, `ACA`, `CALLBACK`
- ✅ Automatically marks record as "completed" on success
- ✅ Stops redialing when success detected

### 5. **Business Hours Integration**
- ✅ Only processes queue during business hours (11 AM - 8 PM EST)
- ✅ Scheduled callbacks honor business hours
- ✅ Paused when scheduler inactive

### 6. **Data Persistence**
- ✅ Survives server restarts (file-based)
- ✅ Survives PM2 restarts
- ✅ 30-day retention (configurable)
- ✅ Monthly file rotation

---

## 🔧 Configuration (.env)

```env
# Redial Queue Configuration
REDIAL_QUEUE_ENABLED=true                    # Auto-start on/off
REDIAL_INTERVAL_MINUTES=30                   # Time between redials
REDIAL_MAX_ATTEMPTS=4                        # Max attempts per lead
REDIAL_SUCCESS_OUTCOMES=TRANSFERRED,SALE,ACA,CALLBACK  # Stop redialing on these
REDIAL_RETENTION_DAYS=30                     # Keep files for 30 days
REDIAL_PROCESS_INTERVAL=5                    # Check queue every 5 minutes
```

---

## 📡 API Endpoints

### Base URL
```
Production: https://client.blandlabs.ai/api/admin/redial-queue
Local: http://localhost:3000/api/admin/redial-queue
```

### Authentication
All endpoints require `X-API-Key` header:
```
X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

---

## 🎯 Quick Start Guide

### 1. Check Status
```bash
curl -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/status
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2024-12-22T...",
  "status": {
    "running": true,
    "enabled": true,
    "is_processing": false,
    "interval_minutes": 5,
    "redial_interval_minutes": 30,
    "max_attempts": 4
  },
  "stats": {
    "enabled": true,
    "total_records": 145,
    "pending": 78,
    "rescheduled": 12,
    "completed": 45,
    "max_attempts": 10,
    "paused": 0,
    "ready_to_dial": 5,
    "current_month": "2024-12"
  }
}
```

### 2. View All Leads in Queue
```bash
curl -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/records
```

### 3. View Ready-to-Dial Leads
```bash
curl -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  "https://client.blandlabs.ai/api/admin/redial-queue/records?ready=true"
```

### 4. View Pending Leads
```bash
curl -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  "https://client.blandlabs.ai/api/admin/redial-queue/records?status=pending"
```

### 5. View Completed Leads
```bash
curl -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  "https://client.blandlabs.ai/api/admin/redial-queue/records?status=completed"
```

---

## 🎮 Control Endpoints

### Enable/Disable Queue Processing

**Enable:**
```bash
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/enable
```

**Disable:**
```bash
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/disable
```

### Start/Stop Processor

**Start:**
```bash
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/start
```

**Stop:**
```bash
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/stop
```

### Manual Trigger Processing
```bash
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/process
```

---

## ⚙️ Update Configuration

```bash
curl -X PUT -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "redial_interval_minutes": 45,
    "max_redial_attempts": 5
  }' \
  https://client.blandlabs.ai/api/admin/redial-queue/config
```

---

## 🎯 Lead Management

### Pause a Lead (Stop Redialing)
```bash
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  "https://client.blandlabs.ai/api/admin/redial-queue/lead/123456/pause?phone=+15551234567"
```

### Resume a Paused Lead
```bash
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  "https://client.blandlabs.ai/api/admin/redial-queue/lead/123456/resume?phone=+15551234567"
```

### Remove a Lead from Queue
```bash
curl -X DELETE -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  "https://client.blandlabs.ai/api/admin/redial-queue/lead/123456?phone=+15551234567"
```

---

## 📊 Record Format

```json
{
  "lead_id": "123456",
  "phone_number": "+15551234567",
  "list_id": "456",
  "first_name": "John",
  "last_name": "Doe",
  "state": "FL",
  "attempts": 2,
  "last_call_timestamp": 1703280000000,
  "next_redial_timestamp": 1703281800000,
  "scheduled_callback_time": null,
  "outcomes": ["VOICEMAIL", "NO_ANSWER"],
  "last_outcome": "NO_ANSWER",
  "last_call_id": "abc123",
  "created_at": 1703280000000,
  "updated_at": 1703280000000,
  "status": "pending",

  // Enriched fields (added by API)
  "last_call_iso": "2024-12-22T18:00:00Z",
  "next_redial_iso": "2024-12-22T18:30:00Z",
  "created_at_iso": "2024-12-22T18:00:00Z",
  "minutes_until_next_redial": 10,
  "is_ready": false
}
```

---

## 🔄 How It Works

### 1. Call Completes (Webhook)
```
Call ends → Webhook received → Redial queue updated
```

- If outcome is **SUCCESS** (TRANSFERRED, SALE, etc.): Mark as "completed", stop redialing
- If outcome is **FAILURE** (VOICEMAIL, NO_ANSWER, etc.): Add to queue for redial in 30 min
- If **scheduled callback**: Set next_redial_timestamp to callback time

### 2. Automatic Processing
```
Every 5 minutes → Check for ready leads → Dial sequentially
```

- Processor checks every 5 minutes (configurable)
- Only runs during business hours (11 AM - 8 PM EST)
- Dials leads where `next_redial_timestamp <= now` and `attempts < max`

### 3. Success Detection
```
TRANSFERRED/SALE detected → Mark completed → Stop redialing
```

### 4. Max Attempts
```
Attempt #4 reached → Status = "max_attempts" → No more redialing
```

---

## 📁 File Structure

```
data/
└── redial-queue/
    ├── redial-queue_2024-12.json  ← Current month
    ├── redial-queue_2024-11.json  ← Last month (deleted after 30 days)
    └── redial-queue_2024-10.json  ← Old (will be deleted)
```

### File Format
```json
{
  "123456_5551234567": {
    "lead_id": "123456",
    "phone_number": "+15551234567",
    ...
  },
  "789012_5559876543": {
    "lead_id": "789012",
    "phone_number": "+15559876543",
    ...
  }
}
```

---

## 🔒 Edge Cases Covered

| Edge Case | Solution |
|-----------|----------|
| **Concurrent writes** | File locking + atomic writes |
| **Convoso also calls lead** | Same key (lead_id + phone), both update same record |
| **Server restart** | File-based persistence, loads on startup |
| **Memory leak** | Monthly rotation + 30-day cleanup |
| **Success after 3 failures** | Automatically marks completed, stops redial |
| **Scheduled callback at 3 PM** | Sets next_redial_timestamp to 3 PM |
| **Business hours end during processing** | Stops processing, resumes next day |
| **File corruption** | Atomic writes prevent corruption |
| **Duplicate webhooks** | Idempotent (updates existing record) |
| **Max attempts reached** | Status = "max_attempts", no more dials |

---

## 🚀 Deployment Checklist

### Before D-Day

1. **Verify configuration:**
```bash
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/config | jq .
```

2. **Check status:**
```bash
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/status | jq .
```

3. **Ensure enabled:**
```bash
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/enable
```

### Monitoring

```bash
# Check queue depth
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/status | jq '.stats.ready_to_dial'

# Check if processing
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/status | jq '.status.is_processing'
```

---

## 📚 Chrome URLs (Quick Access)

### Status
```
https://client.blandlabs.ai/api/admin/redial-queue/status?api_key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### All Records
```
https://client.blandlabs.ai/api/admin/redial-queue/records?api_key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### Ready to Dial
```
https://client.blandlabs.ai/api/admin/redial-queue/records?ready=true&api_key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### Pending Leads
```
https://client.blandlabs.ai/api/admin/redial-queue/records?status=pending&api_key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### Completed Leads
```
https://client.blandlabs.ai/api/admin/redial-queue/records?status=completed&api_key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

---

## 💡 Pro Tips

1. **Monitor ready_to_dial count** - Should grow during business hours
2. **Check completed count** - Should increase as sales/transfers happen
3. **Watch max_attempts count** - Leads that hit limit and stop
4. **Use pause feature** - For leads you want to handle manually
5. **Cleanup old files** - Runs automatically, but can trigger manually

---

## 🆘 Troubleshooting

### Queue Not Processing
```bash
# Check if enabled
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/config | jq .config.enabled

# Check if running
curl -s -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/status | jq .status.running

# Manual trigger
curl -X POST -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  https://client.blandlabs.ai/api/admin/redial-queue/process
```

### Leads Not Redialing
- Check `next_redial_timestamp` vs current time
- Verify `status != "max_attempts"`
- Confirm business hours active
- Check `attempts < max_attempts`

### File Issues
- Check disk space: `df -h`
- Verify file exists: `ls -lh data/redial-queue/`
- Check permissions: `ls -la data/redial-queue/`

---

## 🎉 Summary

You now have a fully automated redial system that:
- ✅ Automatically redials unsuccessful calls
- ✅ Handles scheduled callbacks
- ✅ Stops on success (TRANSFERRED/SALE)
- ✅ Respects max attempts
- ✅ Survives restarts (file-based)
- ✅ Handles concurrent writes safely
- ✅ Integrates with business hours
- ✅ Provides complete API control
- ✅ Keeps data for 30 days
- ✅ Works seamlessly with Convoso

Ready for production! 🚀
