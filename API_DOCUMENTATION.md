# AWH Outbound Orchestrator - API Documentation

**Version**: 1.0.0
**Last Updated**: January 13, 2026
**Total Endpoints**: 80+

---

## Quick Reference

### Webhook Endpoints (No Auth Required)
- `POST /webhooks/awhealth-outbound` - Main call trigger from Convoso
- `POST /webhooks/bland-callback` - Call completion from Bland AI
- `POST /webhooks/call-back` - Callback requests (Zapier replacement)
- `POST /webhooks/sms-reply` - SMS replies from customers
- `POST /webhooks/pathway/update-zip` - Real-time zip code updates
- `POST /webhooks/pathway/update-lead-data` - Real-time lead data updates

### Admin API (Auth Required)
- Base path: `/api/admin`
- Authentication: `x-api-key` header or `api_key` query parameter
- 75+ management endpoints

---

## Table of Contents

1. [Webhook Endpoints](#webhook-endpoints)
2. [Admin API - System Management](#admin-api---system-management)
3. [Admin API - Calls Management](#admin-api---calls-management)
4. [Admin API - Statistics](#admin-api---statistics)
5. [Admin API - Queue Management](#admin-api---queue-management)
6. [Admin API - Blocklist](#admin-api---blocklist)
7. [Admin API - Reports](#admin-api---reports)
8. [Authentication](#authentication)
9. [Error Handling](#error-handling)

---

## Webhook Endpoints

### 1. AWHealth Outbound Webhook

```
POST /webhooks/awhealth-outbound
```

**Purpose**: Main webhook to receive outbound call triggers from Convoso
**Authentication**: None
**When to call**: Triggered automatically by Convoso when a lead needs to be called

**Request Body**:
```json
{
  "phone_number": "5551234567",      // Required
  "lead_id": "12345",                 // Required
  "list_id": "789",                   // Required
  "first_name": "John",               // Optional
  "last_name": "Doe",                 // Optional
  "state": "CA",                      // Optional
  "email": "john@example.com",        // Optional
  "postal_code": "90001"              // Optional
}
```

**Success Response** (202 Accepted):
```json
{
  "success": true,
  "message": "Webhook received, processing in background",
  "request_id": "req_1234567890_abc123"
}
```

**What happens**:
1. ✅ Validates required fields
2. ✅ Checks blocklist
3. ✅ Applies 2-minute rate limit per number
4. ✅ Initiates Bland AI call
5. ✅ Stores call state
6. ✅ Returns immediately (async processing)

---

### 2. Bland AI Callback Webhook

```
POST /webhooks/bland-callback
```

**Purpose**: Receives call completion callbacks from Bland AI
**Authentication**: None
**When to call**: Triggered automatically by Bland AI when call completes

**Request Body** (from Bland AI):
```json
{
  "call_id": "call_xyz",
  "status": "completed",
  "answered_by": "human",
  "to": "5551234567",
  "concatenated_transcript": "...",
  "pathway_tags": ["interested", "callback"],
  "transferred_to": "5555551234",
  "call_length": 120
}
```

**What happens**:
1. ✅ Matches call with stored state
2. ✅ Updates Convoso with outcome
3. ✅ Records statistics
4. ✅ Manages redial queue
5. ✅ Detects STOP/DNC requests
6. ✅ Blocks failed numbers for 24h
7. ✅ Adds voicemail/no-answer to SMS queue

**Call Outcomes**:
- `human` → Update Convoso, record stats
- `transferred` → Mark as transferred
- `voicemail` → Add to redial + SMS queue
- `no_answer` → Add to redial queue
- `busy/failed` → Block for 24h + add to redial
- `DNC/STOP` → Add to blocklist, stop all contact

---

### 3. Callback Request Webhook

```
POST /webhooks/call-back
```

**Purpose**: Zapier replacement - receives callback triggers from Convoso
**Authentication**: None
**When to call**: Triggered when customer requests callback

**Request Body**:
```json
{
  "phone_number": "5551234567",      // Required
  "first_name": "John",               // Required
  "last_name": "Doe",                 // Required
  "lead_id": "12345",                 // Required
  "list_id": "789",                   // Optional
  "status": "CALLBACK"
}
```

**What happens**:
1. ✅ Validates required fields
2. ✅ Initiates Bland AI call immediately
3. ✅ Stores call state for webhook matching
4. ✅ Waits for bland-callback to complete flow

---

### 4. SMS Reply Webhook

```
POST /webhooks/sms-reply
```

**Purpose**: Handles incoming SMS replies from customers
**Authentication**: None
**When to call**: Triggered by Bland AI when customer replies to SMS

**Request Body**:
```json
{
  "from": "5551234567",              // Required - Customer phone
  "to": "5559876543",                // Required - Our number
  "body": "Yes, please call me back" // Required - SMS content
}
```

**Reply Types**:
- **POSITIVE** - Wants callback: `YES, CALL ME, INTERESTED, CALLBACK`
- **NEGATIVE** - Not interested: `NO, NOT INTERESTED`
- **OPT_OUT** - Stop contact: `STOP, UNSUBSCRIBE, DNC, CANCEL`
- **UNKNOWN** - Doesn't match any pattern

**What happens**:

**For OPT_OUT (STOP, DNC)**:
1. ✅ Adds to blocklist immediately
2. ✅ Removes from SMS queue
3. ✅ Updates Convoso status to "DNC"
4. ✅ Removes from redial queue
5. ✅ TCPA-compliant processing

**For POSITIVE (YES, CALL ME)**:
1. ✅ Schedules callback via Convoso
2. ✅ Initiates Bland AI call

---

### 5. Pathway Real-time Update Webhooks

#### Update Zip Code

```
POST /webhooks/pathway/update-zip
```

**Purpose**: Updates lead's zip code in Convoso DURING active call
**Authentication**: None
**When to call**: Called by Bland AI pathway when Ashley collects zip code

**Request Body**:
```json
{
  "phone_number": "5551234567",      // Required
  "lead_id": "12345",                 // Required
  "list_id": "789",                   // Required
  "zip_code": "90001"                 // Required - 5 digits
}
```

**Success Response** (200 OK):
```json
{
  "success": true,
  "message": "Zip code updated successfully in Convoso",
  "lead_id": "12345",
  "zip_code": "90001",
  "updated_at": "2026-01-13T10:30:00Z"
}
```

**What happens**:
1. ✅ Validates zip code format (5 digits)
2. ✅ Updates Convoso immediately (<500ms)
3. ✅ Live agent sees correct zip when call transfers

**Use Case**: Solves problem where live agents see wrong/old zip codes because updates happen after call ends.

---

#### Update Lead Data (Generic)

```
POST /webhooks/pathway/update-lead-data
```

**Purpose**: Update any lead data during pathway execution
**Authentication**: None
**When to call**: Called by Bland AI pathway when collecting lead info

**Request Body**:
```json
{
  "phone_number": "5551234567",
  "lead_id": "12345",
  "list_id": "789",
  "data": {
    "postal_code": "90001",
    "state": "CA",
    "plan_type": "Medicare Advantage",
    "age": "65"
  }
}
```

**Success Response** (200 OK):
```json
{
  "success": true,
  "fields_updated": ["postal_code", "state", "plan_type"],
  "updated_at": "2026-01-13T10:30:00Z"
}
```

---

## Admin API - System Management

**Base Path**: `/api/admin`
**Authentication**: Required (see [Authentication](#authentication))

### Get System Configuration

```
GET /api/admin/config
```

**Purpose**: Get system configuration (excluding sensitive data)
**When to call**: Check current system settings

**Response**:
```json
{
  "server": { "port": 3000, "nodeEnv": "production" },
  "bland": { "pathwayId": "...", "voiceId": "..." },
  "convoso": { "apiUrl": "...", "campaignId": "..." },
  "retry": { "maxRetries": 3, "retryDelay": 1000 },
  "rateLimit": { "enabled": true, "intervalMinutes": 2 }
}
```

---

### Get System Health

```
GET /api/admin/health
```

**Purpose**: Comprehensive system health check
**When to call**: Monitor system status, troubleshoot issues

**Response**:
```json
{
  "status": "healthy",
  "uptime": 86400,
  "memory": {
    "used": "150 MB",
    "percentUsed": "1.83%"
  },
  "activeCalls": {
    "total": 45,
    "pending": 3
  },
  "services": {
    "queueProcessor": "running",
    "smsScheduler": "running"
  }
}
```

---

## Admin API - Calls Management

### Get All Active Calls

```
GET /api/admin/calls/active
```

**Purpose**: Get all active/pending calls
**When to call**: Monitor current call volume

**Response**:
```json
{
  "count": 3,
  "calls": [
    {
      "call_id": "call_xyz",
      "phone_number": "5551234567",
      "status": "pending",
      "duration_seconds": 300,
      "is_stale": false
    }
  ]
}
```

---

### Get Call Statistics

```
GET /api/admin/calls/stats
```

**Purpose**: Get call cache statistics
**Response**: Total, pending, completed, failed counts + memory metrics

---

### Get Specific Call

```
GET /api/admin/calls/:call_id
```

**Purpose**: Get details for specific call
**When to call**: Troubleshoot specific call

---

### Delete Specific Call

```
DELETE /api/admin/calls/:call_id
```

**Purpose**: Manually remove call from cache
**When to call**: Clean up stuck calls

---

### Clear Completed Calls Cache

```
POST /api/admin/cache/clear
```

**Purpose**: Clear all completed calls from cache
**When to call**: Free memory, clean up old calls

**Response**:
```json
{
  "success": true,
  "stats": {
    "before": { "total": 150 },
    "after": { "total": 10 },
    "cleared": 140
  }
}
```

---

### Get Call History for Phone

```
GET /api/admin/calls/history/:phoneNumber
```

**Purpose**: Get call history for specific phone
**When to call**: Investigate call patterns

---

### Get Today's Calls

```
GET /api/admin/calls/today
```

**Purpose**: Get all calls made today
**When to call**: Daily reporting

---

### Block/Unblock Phone Number

```
POST /api/admin/calls/block
POST /api/admin/calls/unblock
```

**Purpose**: Manually block/unblock phone number
**Request Body**:
```json
{
  "phone_number": "5551234567",
  "reason": "Customer requested DNC"
}
```

---

### Get/Update Call Protection Config

```
GET  /api/admin/calls/protection/config
PUT  /api/admin/calls/protection/config
```

**Purpose**: Manage rate limiting and call protection
**Settings**: intervalMinutes, maxAttemptsPerDay

---

## Admin API - Statistics

### Get Today's Statistics

```
GET /api/admin/statistics/today
```

**Response**:
```json
{
  "date": "2026-01-13",
  "statistics": {
    "total_calls": 250,
    "human_answered": 100,
    "voicemail": 80,
    "transferred": 50,
    "dnc_requests": 5
  }
}
```

---

### Get Statistics for Date

```
GET /api/admin/statistics/date/:date
```

**Parameters**: `date` - Format: YYYY-MM-DD

---

### Get Statistics for Date Range

```
GET /api/admin/statistics/range?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```

**Purpose**: Weekly/monthly reporting

---

### Get All-Time Statistics

```
GET /api/admin/statistics/all-time
```

**Purpose**: System-wide reporting

---

## Admin API - Queue Management

### Scheduler Endpoints

```
GET  /api/admin/scheduler/config
PUT  /api/admin/scheduler/config
GET  /api/admin/scheduler/queue
POST /api/admin/scheduler/queue/process
DELETE /api/admin/scheduler/queue
```

**Purpose**: Manage callback scheduling and business hours

---

### Redial Queue Endpoints

#### Get Redial Queue Status

```
GET /api/admin/redial-queue/status
```

**Response**:
```json
{
  "status": {
    "enabled": true,
    "running": true
  },
  "stats": {
    "totalLeads": 1942,
    "readyToDial": 150,
    "pending": 50
  },
  "config": {
    "maxDailyAttempts": 8,
    "retentionDays": 30
  }
}
```

---

#### Get/Update Redial Queue Config

```
GET /api/admin/redial-queue/config
PUT /api/admin/redial-queue/config
```

**Settings**: maxDailyAttempts, retentionDays, processingIntervalMinutes

---

#### Get Redial Queue Records

```
GET /api/admin/redial-queue/records?status=pending&ready=true&limit=100
```

**Query Parameters**:
- `status` - Filter by status
- `ready` - Filter by ready to dial
- `limit` - Max records (default: 100)
- `offset` - Pagination offset

---

#### Control Redial Queue

```
POST /api/admin/redial-queue/start
POST /api/admin/redial-queue/stop
POST /api/admin/redial-queue/process
POST /api/admin/redial-queue/enable
POST /api/admin/redial-queue/disable
```

---

#### Manage Individual Leads

```
DELETE /api/admin/redial-queue/lead/:lead_id?phone=xxx
POST   /api/admin/redial-queue/lead/:lead_id/pause?phone=xxx
POST   /api/admin/redial-queue/lead/:lead_id/resume?phone=xxx
```

**Purpose**: Remove, pause, or resume specific leads

---

#### Cleanup Old Files

```
POST /api/admin/redial-queue/cleanup
```

**Purpose**: Remove old files beyond retention period

---

### Queue Processor Endpoints

```
GET  /api/admin/queue-processor/status
POST /api/admin/queue-processor/process
GET  /api/admin/queue-processor/config
PUT  /api/admin/queue-processor/config
POST /api/admin/queue-processor/start
POST /api/admin/queue-processor/stop
POST /api/admin/queue-processor/enable
POST /api/admin/queue-processor/disable
```

---

## Admin API - Blocklist

### Get Blocklist

```
GET /api/admin/blocklist
```

**Response**:
```json
{
  "enabled": true,
  "count": 50,
  "flags": [
    {
      "field": "phone_number",
      "value": "5551234567",
      "reason": "Customer requested DNC"
    }
  ]
}
```

---

### Add/Remove from Blocklist

```
POST   /api/admin/blocklist
DELETE /api/admin/blocklist/:flagId
```

**Add Request Body**:
```json
{
  "field": "phone_number",
  "value": "5551234567",
  "reason": "DNC request"
}
```

---

### Enable/Disable Blocklist

```
PUT /api/admin/blocklist/enabled
```

**Request Body**:
```json
{
  "enabled": false
}
```

---

### Get Blocked Attempts

```
GET /api/admin/blocklist/attempts/today
GET /api/admin/blocklist/attempts/:date
GET /api/admin/blocklist/statistics?start=YYYY-MM-DD&end=YYYY-MM-DD
```

---

## Admin API - Reports

### Webhook Logs

```
GET /api/admin/webhook-logs/today
GET /api/admin/webhook-logs/:date
GET /api/admin/webhook-logs/search/phone/:phoneNumber
GET /api/admin/webhook-logs/search/lead/:leadId
```

**Purpose**: Monitor webhook activity, troubleshoot issues

---

### Reconciliation Reports

```
POST /api/admin/reconciliation/generate/:date
POST /api/admin/reconciliation/generate-today
GET  /api/admin/reconciliation/:date
GET  /api/admin/reconciliation/list/all
```

**Purpose**: Daily reconciliation between systems

---

### Daily Reports

```
POST /api/admin/daily-report/generate/:date
POST /api/admin/daily-report/generate-today
GET  /api/admin/daily-report/:date
```

**Purpose**: Comprehensive daily performance reports

---

## Authentication

All admin endpoints require authentication via:

### Option 1: Header (Recommended)

```bash
curl -H "x-api-key: awh_admin_2024_secure_key_change_in_production" \
  http://localhost:3000/api/admin/health
```

### Option 2: Query Parameter

```bash
curl "http://localhost:3000/api/admin/health?api_key=awh_admin_2024_secure_key_change_in_production"
```

### Unauthorized Response (401)

```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid API key"
}
```

---

## Error Handling

### Common Error Responses

**400 Bad Request**:
```json
{
  "success": false,
  "error": "Invalid payload: phone_number is required"
}
```

**401 Unauthorized**:
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid API key"
}
```

**404 Not Found**:
```json
{
  "error": "Not Found",
  "path": "/api/admin/invalid-endpoint"
}
```

**500 Internal Server Error**:
```json
{
  "error": "Internal Server Error",
  "message": "Failed to process request"
}
```

---

## Rate Limiting

- **Default Interval**: 2 minutes between calls to same number
- **Max Daily Attempts**: 8 attempts per lead
- **Configurable**: Via `/api/admin/calls/protection/config`

---

## Best Practices

1. **Authentication**: Always use header-based API key for security
2. **Error Handling**: Check `success` field in all responses
3. **Monitoring**: Use `/api/admin/health` for regular monitoring
4. **Testing**: Use test mode endpoints in development
5. **Logging**: Review webhook logs regularly
6. **Reconciliation**: Run daily reconciliation reports
7. **Cleanup**: Regularly clear completed calls cache
8. **Blocklist**: Monitor blocklist statistics for TCPA compliance

---

## Quick Troubleshooting

### Stuck Calls
1. Check: `GET /api/admin/calls/active`
2. Remove: `DELETE /api/admin/calls/:call_id`
3. Clear: `POST /api/admin/cache/clear`

### Failed Convoso Updates
1. Check logs: `GET /api/admin/webhook-logs/today`
2. Check blocklist: `GET /api/admin/blocklist`
3. Verify config: `GET /api/admin/config`

### Redial Issues
1. Check status: `GET /api/admin/redial-queue/status`
2. Check records: `GET /api/admin/redial-queue/records`
3. Process manually: `POST /api/admin/redial-queue/process`

### SMS Issues
1. Check logs: `GET /api/admin/webhook-logs/search/phone/:phone`
2. Check blocklist: `GET /api/admin/blocklist`
3. Reset tracker (test only): `POST /api/admin/test/reset-sms-tracker`

---

**For detailed implementation, see source code in `/src/routes/`**

**Last Updated**: January 13, 2026
**Version**: 1.0.0
**Total Endpoints**: 80+
