# 🚫 Blocklist System Documentation

## Overview

The Blocklist System allows you to dynamically flag and block specific phone numbers, lead IDs, emails, or any other field to prevent calls **BEFORE** they reach Bland AI. This saves API costs and ensures compliance with do-not-call requests.

**Key Features:**
- ✅ Dynamic flags (add/remove without code changes)
- ✅ Blocks calls BEFORE Bland AI (saves API costs)
- ✅ Flexible field matching (phone, lead_id, email, etc.)
- ✅ Tracks all blocked attempts with timestamps
- ✅ Statistics and reporting by date range
- ✅ Complete audit trail

---

## How It Works

### Check Order (CRITICAL)

```
1. Scheduler check (business hours)
2. Answering machine tracker check
3. Call protection rules check
4. **BLOCKLIST CHECK** ← NEW (happens HERE, before Bland AI)
5. Bland AI call initiated
```

**Why this order matters:**
- Blocklist checks happen AFTER basic rules (hours, protection)
- But BEFORE calling Bland AI
- Saves API costs by not making calls to blocked numbers

---

## File Structure

```
data/
├── blocklist-config.json              # Blocklist flags configuration
└── blocklist-attempts/
    ├── attempts_2024-12-24.json       # Daily (today's blocked attempts)
    ├── attempts_2024-12-25.json       # Daily (tomorrow's blocked attempts)
    └── attempts_2024-12-26.json       # Daily (auto-created each day)
```

**Rotation:** Daily files created at midnight EST (same as daily call tracker)

---

## Configuration File

### blocklist-config.json

```json
{
  "enabled": true,
  "flags": [
    {
      "id": "flag_1735084012345_abc123def",
      "field": "phone",
      "value": "3055551234",
      "reason": "Customer requested no contact",
      "added_at": "2024-12-24T15:30:00.000Z",
      "added_by": "admin"
    },
    {
      "id": "flag_1735084012346_xyz789ghi",
      "field": "lead_id",
      "value": "12345",
      "reason": "Duplicate lead - permanently block",
      "added_at": "2024-12-24T16:00:00.000Z",
      "added_by": "utkarsh"
    }
  ]
}
```

**Fields:**
- `id` - Unique identifier (auto-generated)
- `field` - Field name to match (phone, lead_id, email, etc.)
- `value` - Value to block (exact match)
- `reason` - Optional reason for blocking
- `added_at` - ISO timestamp when flag was added
- `added_by` - Optional who added this flag

---

## API Endpoints

### Base URL
```
http://localhost:3000/api/admin/blocklist
```

### Authentication
All endpoints require admin API key:
```bash
-H "X-API-Key: YOUR_ADMIN_API_KEY"
```

---

### 1. Get All Flags

**GET** `/api/admin/blocklist`

**Description:** Retrieve all blocklist flags and configuration

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/blocklist
```

**Response:**
```json
{
  "enabled": true,
  "flags_count": 2,
  "flags": [
    {
      "id": "flag_1735084012345_abc123def",
      "field": "phone",
      "value": "3055551234",
      "reason": "Customer requested no contact",
      "added_at": "2024-12-24T15:30:00.000Z"
    },
    {
      "id": "flag_1735084012346_xyz789ghi",
      "field": "lead_id",
      "value": "12345",
      "reason": "Duplicate lead",
      "added_at": "2024-12-24T16:00:00.000Z"
    }
  ]
}
```

---

### 2. Add Flag (Block Number/Lead)

**POST** `/api/admin/blocklist`

**Description:** Add a new blocklist flag

**Body:**
```json
{
  "field": "phone",
  "value": "3055551234",
  "reason": "Customer requested no contact"
}
```

**Example:**
```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "phone",
    "value": "3055551234",
    "reason": "Customer requested no contact"
  }' \
  http://localhost:3000/api/admin/blocklist
```

**Response:**
```json
{
  "success": true,
  "message": "Blocklist flag added successfully",
  "flag": {
    "id": "flag_1735084012345_abc123def",
    "field": "phone",
    "value": "3055551234",
    "reason": "Customer requested no contact",
    "added_at": "2024-12-24T15:30:00.000Z"
  }
}
```

**Supported Fields:**
- `phone` - Phone number (e.g., "3055551234")
- `phone_number` - Full phone with country code (e.g., "+13055551234")
- `lead_id` - Lead ID from Convoso
- `email` - Email address
- `first_name` - First name
- `last_name` - Last name
- `state` - State abbreviation
- Any custom field from payload

---

### 3. Remove Flag (Unblock)

**DELETE** `/api/admin/blocklist/:flagId`

**Description:** Remove a blocklist flag by ID

**Example:**
```bash
curl -X DELETE \
  -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/blocklist/flag_1735084012345_abc123def
```

**Response:**
```json
{
  "success": true,
  "message": "Blocklist flag removed successfully"
}
```

---

### 4. Enable/Disable Blocklist

**PUT** `/api/admin/blocklist/enabled`

**Description:** Enable or disable the entire blocklist system

**Body:**
```json
{
  "enabled": false
}
```

**Example:**
```bash
# Disable blocklist (all flags ignored)
curl -X PUT \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:3000/api/admin/blocklist/enabled

# Enable blocklist
curl -X PUT \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  http://localhost:3000/api/admin/blocklist/enabled
```

**Response:**
```json
{
  "success": true,
  "message": "Blocklist disabled successfully",
  "enabled": false
}
```

---

### 5. Get Today's Blocked Attempts

**GET** `/api/admin/blocklist/attempts/today`

**Description:** Get all blocked attempts for today

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/blocklist/attempts/today
```

**Response:**
```json
{
  "date": "2024-12-24",
  "total_attempts": 15,
  "blocked_count": 15,
  "attempts": [
    {
      "timestamp": "2024-12-24T15:35:12.000Z",
      "field": "phone",
      "value": "3055551234",
      "lead_id": "67890",
      "phone": "3055551234",
      "blocked": true,
      "reason": "Blocked by flag: phone=3055551234",
      "flag_id": "flag_1735084012345_abc123def"
    }
  ]
}
```

---

### 6. Get Blocked Attempts by Date

**GET** `/api/admin/blocklist/attempts/:date`

**Description:** Get blocked attempts for a specific date

**Date Format:** YYYY-MM-DD

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/blocklist/attempts/2024-12-24
```

**Response:** Same format as today's attempts

---

### 7. Get Statistics (Date Range)

**GET** `/api/admin/blocklist/statistics?start=YYYY-MM-DD&end=YYYY-MM-DD`

**Description:** Get detailed statistics for a date range

**Query Parameters:**
- `start` - Start date (YYYY-MM-DD) - Default: 7 days ago
- `end` - End date (YYYY-MM-DD) - Default: today

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/admin/blocklist/statistics?start=2024-12-01&end=2024-12-24"
```

**Response:**
```json
{
  "date_range": {
    "start": "2024-12-01",
    "end": "2024-12-24"
  },
  "total_attempts": 150,
  "blocked_attempts": 150,
  "by_flag": {
    "flag_1735084012345_abc123def": {
      "flag": {
        "id": "flag_1735084012345_abc123def",
        "field": "phone",
        "value": "3055551234",
        "reason": "Customer requested no contact"
      },
      "count": 45,
      "dates": {
        "2024-12-23": 15,
        "2024-12-24": 30
      }
    }
  },
  "by_field": {
    "phone": {
      "count": 120,
      "values": {
        "3055551234": 45,
        "3055559999": 75
      }
    },
    "lead_id": {
      "count": 30,
      "values": {
        "12345": 30
      }
    }
  }
}
```

---

## Usage Examples

### Example 1: Block a Phone Number

**Scenario:** Customer "305-555-1234" requested no contact

```bash
# Add flag
curl -X POST \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "phone",
    "value": "3055551234",
    "reason": "Customer requested no contact - do not call"
  }' \
  http://localhost:3000/api/admin/blocklist
```

**Result:**
- All future calls to 305-555-1234 will be blocked
- Blocked BEFORE calling Bland AI
- Attempt logged with reason

---

### Example 2: Block a Lead ID

**Scenario:** Lead ID "12345" is a duplicate, never call again

```bash
curl -X POST \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "lead_id",
    "value": "12345",
    "reason": "Duplicate lead - permanent block"
  }' \
  http://localhost:3000/api/admin/blocklist
```

---

### Example 3: Block an Email

**Scenario:** Block all calls to leads with email "test@example.com"

```bash
curl -X POST \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "email",
    "value": "test@example.com",
    "reason": "Test account - do not call"
  }' \
  http://localhost:3000/api/admin/blocklist
```

---

### Example 4: View Today's Blocked Calls

**Scenario:** Check how many calls were blocked today

```bash
curl -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/blocklist/attempts/today | jq '.'
```

**Output:**
```json
{
  "date": "2024-12-24",
  "total_attempts": 15,
  "blocked_count": 15,
  "attempts": [...]
}
```

---

### Example 5: Weekly Statistics

**Scenario:** Get stats for last 7 days to see which numbers were blocked most

```bash
curl -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  "http://localhost:3000/api/admin/blocklist/statistics?start=2024-12-17&end=2024-12-24" | jq '.'
```

---

### Example 6: Remove Flag (Unblock)

**Scenario:** Customer "305-555-1234" now wants to be called again

```bash
# First, get the flag ID
curl -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/blocklist | jq '.flags[] | select(.value=="3055551234")'

# Output:
# {
#   "id": "flag_1735084012345_abc123def",
#   "field": "phone",
#   "value": "3055551234"
# }

# Remove the flag
curl -X DELETE \
  -H "X-API-Key: 24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL" \
  http://localhost:3000/api/admin/blocklist/flag_1735084012345_abc123def
```

---

## Monitoring & Logs

### Log Messages

**When call is blocked:**
```
[INFO] Call blocked by blocklist flag {
  request_id: "req_1735084012345_abc123",
  phone: "3055551234",
  lead_id: "67890",
  reason: "Blocked by flag: phone=3055551234",
  flag_id: "flag_1735084012345_abc123def",
  flag_field: "phone",
  flag_value: "3055551234"
}
```

**When flag is added:**
```
[INFO] Blocklist flag added {
  id: "flag_1735084012345_abc123def",
  field: "phone",
  value: "3055551234",
  reason: "Customer requested no contact"
}
```

**When flag is removed:**
```
[INFO] Blocklist flag removed {
  id: "flag_1735084012345_abc123def",
  field: "phone",
  value: "3055551234"
}
```

---

## Best Practices

### 1. Use Descriptive Reasons
```json
// ✅ GOOD
{
  "field": "phone",
  "value": "3055551234",
  "reason": "Customer requested no contact via email on 2024-12-24"
}

// ❌ BAD
{
  "field": "phone",
  "value": "3055551234",
  "reason": "blocked"
}
```

### 2. Phone Number Format
Use the same format as your incoming data:
```json
// If your system uses format: "3055551234"
{
  "field": "phone",
  "value": "3055551234"
}

// If your system uses format: "+13055551234"
{
  "field": "phone_number",
  "value": "+13055551234"
}
```

### 3. Regular Cleanup
Review flags monthly and remove obsolete ones:
```bash
# Get all flags
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/blocklist | jq '.flags'

# Remove old/unnecessary flags
curl -X DELETE \
  -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/blocklist/FLAG_ID
```

### 4. Monitor Statistics
```bash
# Weekly review
curl -H "X-API-Key: YOUR_KEY" \
  "http://localhost:3000/api/admin/blocklist/statistics?start=2024-12-17&end=2024-12-24" \
  | jq '.by_field'
```

---

## AWS Storage Commands

### Check Disk Usage on AWS EC2

```bash
# Check overall disk usage
df -h

# Check data directory size
du -sh /home/ec2-user/awh-outbound-orchestrator/data

# Check blocklist files specifically
du -sh /home/ec2-user/awh-outbound-orchestrator/data/blocklist-*

# List all blocklist attempts files with sizes
ls -lh /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/

# Check PM2 logs size
du -sh ~/.pm2/logs/

# Check total application directory size
du -sh /home/ec2-user/awh-outbound-orchestrator/
```

### Clean Up Old Attempts Files

```bash
# Remove attempts files older than 30 days
find /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/ \
  -name "attempts_*.json" \
  -mtime +30 \
  -delete

# Or move to archive instead of delete
mkdir -p /home/ec2-user/archive/blocklist-attempts
find /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/ \
  -name "attempts_*.json" \
  -mtime +30 \
  -exec mv {} /home/ec2-user/archive/blocklist-attempts/ \;
```

### PM2 Storage Details

```bash
# Check PM2 application details
pm2 show awh-orchestrator

# Check PM2 logs disk usage
du -sh ~/.pm2/logs/

# Rotate PM2 logs (clears old logs)
pm2 flush

# Or install PM2 log rotate module
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### Monitor Real-Time Storage

```bash
# Watch disk usage in real-time
watch -n 5 'df -h && du -sh /home/ec2-user/awh-outbound-orchestrator/data'
```

---

## Troubleshooting

### Issue: Flag not blocking calls

**Check 1:** Is blocklist enabled?
```bash
curl -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/blocklist | jq '.enabled'

# Should return: true
```

**Check 2:** Is field name correct?
```bash
# View incoming payload field names
pm2 logs awh-orchestrator | grep "Starting orchestration"

# Ensure flag field matches payload field
```

**Check 3:** Is value exact match?
```json
// Value must match EXACTLY (case-sensitive)
"3055551234" ≠ "+13055551234"
"3055551234" ≠ "305-555-1234"
"3055551234" = "3055551234" ✅
```

---

## Summary

**What it does:**
- Blocks calls to flagged numbers/leads BEFORE calling Bland AI
- Saves API costs and ensures compliance
- Tracks all blocked attempts with audit trail

**When to use:**
- Customer requested no contact
- Duplicate leads
- Test accounts
- Problematic numbers
- Compliance requirements

**Key endpoints:**
- `POST /api/admin/blocklist` - Add flag
- `DELETE /api/admin/blocklist/:flagId` - Remove flag
- `GET /api/admin/blocklist/attempts/today` - View blocked calls
- `GET /api/admin/blocklist/statistics` - Get statistics

**Files:**
- `data/blocklist-config.json` - Flags configuration
- `data/blocklist-attempts/attempts_YYYY-MM-DD.json` - Daily blocked attempts

---

**Created:** December 24, 2024
**Status:** Production Ready
**Build:** ✅ Successful
