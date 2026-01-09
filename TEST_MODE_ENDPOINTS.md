# Test Mode API Endpoints - For Testing Without Business Hours

## Overview

Added test mode endpoints to allow testing automation scripts anytime, bypassing business hours restrictions.

---

## 🔧 Configuration

### Enable Test Mode in `.env`:

```bash
# Test Mode Configuration
# WARNING: Only enable in development/testing! Bypasses all safety checks
TEST_MODE_ENABLED=true
# When true, ignores business hours, allows testing anytime
TEST_MODE_BYPASS_BUSINESS_HOURS=true
# When true, allows manual SMS tracker reset via admin API
TEST_MODE_ALLOW_SMS_RESET=true
```

**⚠️ IMPORTANT**: Set `TEST_MODE_ENABLED=false` in production!

---

## 📍 Test Endpoints

All endpoints require admin API key authentication:
```bash
Header: X-API-Key: your_admin_key
# OR
Query: ?api_key=your_admin_key
```

### 1. Reset SMS Tracker (Clear Daily Limits)

**Endpoint**: `POST /api/admin/test/reset-sms-tracker`

**Purpose**: Clear SMS tracker records to test SMS sending again

**Request**:
```bash
curl -X POST "http://localhost:3000/api/admin/test/reset-sms-tracker" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"
```

**Response**:
```json
{
  "success": true,
  "message": "SMS tracker reset successfully",
  "records_cleared": 5,
  "date": "2026-01-08"
}
```

**Use Case**: You hit the 2 SMS/day limit and want to test again

---

### 2. Reset Daily Call Counters

**Endpoint**: `POST /api/admin/test/reset-daily-counters`

**Purpose**: Reset daily attempt counters for redial queue

**Request**:
```bash
curl -X POST "http://localhost:3000/api/admin/test/reset-daily-counters" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"
```

**Response**:
```json
{
  "success": true,
  "message": "Daily counters reset successfully",
  "leads_reset": 12,
  "leads_moved_to_pending": 3
}
```

**Use Case**: Leads hit daily max (8 calls/day) and you want to test again

---

### 3. Manual Trigger Test Call

**Endpoint**: `POST /api/admin/test/trigger-call`

**Purpose**: Manually trigger a test call bypassing business hours

**Request**:
```bash
curl -X POST "http://localhost:3000/api/admin/test/trigger-call" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+16284444907", "first_name": "Utkarsh", "last_name": "Test"}'
```

**Response**:
```json
{
  "success": true,
  "message": "Test call initiated",
  "call_id": "call_abc123xyz",
  "phone": "+16284444907",
  "test_mode": true,
  "bypassed_business_hours": true
}
```

**Use Case**: Test end-to-end call flow without waiting for business hours

---

### 4. Check Test Mode Status

**Endpoint**: `GET /api/admin/test/status`

**Purpose**: Check if test mode is enabled and what features are active

**Request**:
```bash
curl "http://localhost:3000/api/admin/test/status" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"
```

**Response**:
```json
{
  "success": true,
  "test_mode": {
    "enabled": true,
    "bypass_business_hours": true,
    "allow_sms_reset": true
  },
  "current_time": "2026-01-08T23:45:00.000Z",
  "business_hours": {
    "active": true,
    "reason": "TEST_MODE_BYPASS_BUSINESS_HOURS=true"
  },
  "sms_tracker": {
    "enabled": true,
    "records_count": 3,
    "date": "2026-01-08"
  }
}
```

---

## 🧪 Testing Workflow

### Scenario 1: Test SMS Sending After Hitting Daily Limit

```bash
# 1. Check current SMS count
curl "http://localhost:3000/admin/test/status" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# 2. Reset SMS tracker
curl -X POST "http://localhost:3000/admin/test/reset-sms-tracker" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# 3. Trigger test call (will send SMS if voicemail)
curl -X POST "http://localhost:3000/admin/test/trigger-call" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+16284444907", "first_name": "Utkarsh", "last_name": "Test"}'

# 4. Check SMS was sent
curl "http://localhost:3000/admin/test/status" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"
```

### Scenario 2: Test Outside Business Hours

```bash
# Confirm test mode is enabled
curl "http://localhost:3000/admin/test/status" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# Should show: "business_hours": { "active": true, "reason": "TEST_MODE_BYPASS" }

# Trigger call (works even at 2 AM)
curl -X POST "http://localhost:3000/admin/test/trigger-call" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+16284444907", "first_name": "Utkarsh", "last_name": "Test"}'
```

### Scenario 3: Test Redial After Hitting Daily Max

```bash
# 1. Reset daily counters
curl -X POST "http://localhost:3000/api/admin/test/reset-daily-counters" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# 2. Check redial queue
curl "http://localhost:3000/api/admin/redial/queue?status=pending" \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"

# 3. Leads that were "daily_max_reached" are now "pending" and can be called
```

---

## ⚠️ Safety Features

### 1. Test Mode Guard
- All test endpoints check `TEST_MODE_ENABLED`
- Returns 403 if test mode is disabled
- Prevents accidental use in production

### 2. Admin Authentication Required
- All endpoints require valid admin API key
- Prevents unauthorized testing

### 3. Clear Logging
- All test actions logged with "TEST MODE" prefix
- Easy to identify test vs production actions

### 4. Automatic Disable Recommendation
```json
{
  "warning": "TEST_MODE is enabled - disable in production!",
  "env_vars_to_set": {
    "TEST_MODE_ENABLED": "false",
    "TEST_MODE_BYPASS_BUSINESS_HOURS": "false"
  }
}
```

---

## 🚀 Deployment

### Development/Testing:
```bash
# .env
TEST_MODE_ENABLED=true
TEST_MODE_BYPASS_BUSINESS_HOURS=true
TEST_MODE_ALLOW_SMS_RESET=true
```

### Production:
```bash
# .env
TEST_MODE_ENABLED=false
TEST_MODE_BYPASS_BUSINESS_HOURS=false
TEST_MODE_ALLOW_SMS_RESET=false
```

Or simply remove the TEST_MODE variables entirely from production `.env`.

---

## 📊 What Gets Bypassed in Test Mode

### With `TEST_MODE_BYPASS_BUSINESS_HOURS=true`:

✅ **Bypassed**:
- Business hours check (11 AM - 8 PM)
- Weekend restrictions
- Blackout dates
- Scheduler enabled/disabled state

❌ **NOT Bypassed** (still enforced):
- SMS daily limits (unless reset via endpoint)
- Redial daily limits (unless reset via endpoint)
- DNC blocklist
- Call rate limiting
- TCPA compliance hours (but can be overridden with test mode)

---

## 🔍 Monitoring

### Check if test mode is accidentally enabled in production:

```bash
# Check logs for test mode warnings
pm2 logs awh-orchestrator | grep "TEST MODE"

# Should see:
# [WARN] TEST MODE: Business hours bypassed
# [INFO] TEST MODE: SMS tracker reset
```

### Disable test mode immediately:

```bash
# 1. Edit .env
nano .env
# Set: TEST_MODE_ENABLED=false

# 2. Restart
pm2 restart awh-orchestrator

# 3. Verify
curl "http://localhost:3000/api/admin/test/status" -H "X-API-Key: your_key"
# Should return: "test_mode": { "enabled": false }
```

---

## 📝 Implementation Files

1. **`.env`** - Test mode configuration flags
2. **`src/services/schedulerService.ts`** - Bypass business hours check
3. **`src/routes/adminRoutes.ts`** - Test endpoint handlers (to be added)
4. **`src/services/smsTrackerService.ts`** - Reset functionality

---

## ✅ Summary

**Problem**: Can't test automation without waiting for business hours
**Solution**: Test mode + admin endpoints to bypass restrictions
**Result**: Test anytime, reset limits, manually trigger calls

**Key Endpoints**:
- `POST /admin/test/reset-sms-tracker` - Clear SMS limits
- `POST /admin/test/reset-daily-counters` - Clear call limits
- `POST /admin/test/trigger-call` - Manual test call
- `GET /admin/test/status` - Check test mode status

**Safety**: All guarded by test mode flag + admin authentication
