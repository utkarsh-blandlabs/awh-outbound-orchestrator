# Postman Setup Guide - AWH Test Mode Endpoints

## 📥 Import the Collection

### Step 1: Import to Postman

1. Open Postman
2. Click **"Import"** button (top left)
3. Choose **"Upload Files"**
4. Select: `AWH_Test_Mode_Endpoints.postman_collection.json`
5. Click **"Import"**

### Step 2: Configure Variables (Optional)

The collection includes 3 variables with default values:

| Variable | Default Value | Description |
|----------|---------------|-------------|
| `base_url` | `http://localhost:3000` | Server URL |
| `admin_api_key` | `24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL` | Admin API key |
| `test_phone` | `+16284444907` | Your test phone number |

**To change variables:**
1. Click collection name → **Variables** tab
2. Update **Current Value** column
3. Click **Save**

---

## 🧪 Testing Workflows

### Workflow 1: Quick Test Call

**Purpose:** Test a single call to your phone

1. **Check Status** → Run: `1. Check Test Mode Status`
   - Verify: `business_hours.active = false` (outside hours OK)
   - Verify: `safety.manual_test_calls_only = true`

2. **Trigger Call** → Run: `4. Trigger Test Call`
   - Update phone number in Body if needed
   - Expected: Call to your phone immediately

---

### Workflow 2: Test SMS Limits

**Purpose:** Verify SMS tracker blocks after 2 messages

1. **Reset SMS** → Run: `2. Reset SMS Tracker`
   - Clears any previous SMS counts

2. **Call 1** → Run: `4. Trigger Test Call`
   - Expected: SMS included

3. **Call 2** → Run: `4. Trigger Test Call`
   - Expected: SMS included

4. **Call 3** → Run: `4. Trigger Test Call`
   - Expected: Voicemail only (no SMS)

5. **Check Status** → Run: `1. Check Test Mode Status`
   - Verify: SMS count = 2/2

---

### Workflow 3: Test Redial Queue

**Purpose:** Test redial queue functionality

1. **Reset Counters** → Run: `3. Reset Daily Call Counters`

2. **Check Queue** → Run: `Get Redial Queue (All)`
   - View all leads in queue

3. **Check Stats** → Run: `Get Redial Queue Stats`
   - View queue statistics

---

## 📋 All Available Endpoints

### Test Mode Endpoints

```
✅ GET  /api/admin/test/status              - Check test mode status
✅ POST /api/admin/test/reset-sms-tracker   - Reset SMS limits
✅ POST /api/admin/test/reset-daily-counters - Reset call counters
✅ POST /api/admin/test/trigger-call        - Manual test call
```

### Redial Queue Endpoints

```
✅ GET  /api/admin/redial/queue              - View all leads
✅ GET  /api/admin/redial/queue?status=pending - View pending leads
✅ GET  /api/admin/redial/stats              - Queue statistics
```

### System Health Endpoints

```
✅ GET  /api/admin/health                    - Health check
✅ GET  /api/admin/calls/active              - Active calls
```

---

## 🔑 Authentication

All endpoints use **API Key authentication**:

**Header:**
```
X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

The collection is pre-configured with this header. No manual setup needed!

---

## 📝 Request Body Examples

### Trigger Test Call

```json
{
  "phone_number": "+16284444907",
  "first_name": "Utkarsh",
  "last_name": "Test"
}
```

**Required fields:**
- `phone_number` - Full E.164 format (+1234567890)
- `first_name` - First name for personalization
- `last_name` - Last name for personalization

---

## 🎯 Expected Response Examples

### Test Mode Status (Success)

```json
{
  "success": true,
  "test_mode": {
    "enabled": true,
    "bypass_business_hours": true,
    "allow_sms_reset": true,
    "note": "Manual test calls bypass business hours. Queue processors still respect business hours."
  },
  "business_hours": {
    "active": false,
    "config": {
      "days": [1, 2, 3, 4, 5],
      "startTime": "11:00",
      "endTime": "20:00"
    },
    "note": "Queue processors ALWAYS respect these hours - no test mode bypass"
  },
  "sms_tracker": {
    "enabled": true,
    "max_per_day": 2
  },
  "safety": {
    "queue_processor_respects_hours": true,
    "redial_queue_respects_hours": true,
    "sms_scheduler_respects_tcpa": true,
    "manual_test_calls_only": true
  }
}
```

### Trigger Test Call (Success)

```json
{
  "success": true,
  "message": "Test call initiated successfully",
  "call_id": "f76891e8-6503-4bb3-ac1e-cfee42620c01",
  "phone": "+16284444907",
  "test_mode": true,
  "bypassed_business_hours": true,
  "note": "Monitor logs for call progress"
}
```

### Reset SMS Tracker (Success)

```json
{
  "success": true,
  "message": "SMS tracker reset successfully",
  "records_cleared": 1,
  "note": "You can now test SMS sending again"
}
```

---

## ⚠️ Common Errors

### Error: Test Mode Not Enabled

**Response:**
```json
{
  "success": false,
  "error": "Test mode is not enabled",
  "note": "Set TEST_MODE_ENABLED=true in .env to use test endpoints"
}
```

**Solution:** Enable test mode in `.env`:
```bash
TEST_MODE_ENABLED=true
TEST_MODE_BYPASS_BUSINESS_HOURS=true
TEST_MODE_ALLOW_SMS_RESET=true
```

### Error: Invalid API Key

**Response:**
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

**Solution:** Check `X-API-Key` header matches `.env` value

---

## 🛡️ Safety Checks

Before triggering calls, always verify:

✅ **Test mode status:**
```bash
GET /api/admin/test/status
```

✅ **Business hours (should be false):**
```json
"business_hours": {
  "active": false
}
```

✅ **Safety guarantees:**
```json
"safety": {
  "queue_processor_respects_hours": true,
  "redial_queue_respects_hours": true,
  "manual_test_calls_only": true
}
```

---

## 💡 Tips

1. **Use Environment Variables** - Click collection → Variables → Save different configs for dev/staging/prod

2. **Save Responses** - Click "Save Response" to compare against future tests

3. **Use Tests Tab** - Add assertions to auto-verify responses:
   ```javascript
   pm.test("Status is 200", () => {
       pm.response.to.have.status(200);
   });

   pm.test("Success is true", () => {
       pm.expect(pm.response.json().success).to.be.true;
   });
   ```

4. **Monitor Logs** - Keep `pm2 logs awh-orchestrator` running in another terminal

5. **Use Collection Runner** - Run entire test workflow automatically

---

## 🚀 Quick Start (Copy-Paste)

```bash
# 1. Start server
pm2 restart awh-orchestrator

# 2. Import collection to Postman:
#    AWH_Test_Mode_Endpoints.postman_collection.json

# 3. Run in this order:
#    1. Check Test Mode Status  ✓
#    2. Reset SMS Tracker       ✓
#    3. Trigger Test Call       ✓
#    4. Check Status Again      ✓

# 4. Monitor logs:
pm2 logs awh-orchestrator --lines 50
```

---

## 📞 Support

If you encounter issues:

1. Check logs: `pm2 logs awh-orchestrator`
2. Verify test mode: `GET /api/admin/test/status`
3. Check `.env` configuration
4. Restart server: `pm2 restart awh-orchestrator`

**Documentation:**
- [TEST_MODE_SAFETY_GUIDE.md](TEST_MODE_SAFETY_GUIDE.md)
- [SMS_TRACKER_VERIFICATION.md](SMS_TRACKER_VERIFICATION.md)
- [TEST_MODE_ENDPOINTS.md](TEST_MODE_ENDPOINTS.md)
