# AWH Outbound Orchestrator - API Documentation

Complete API reference for all available endpoints.

---

## Table of Contents

1. [Public Endpoints](#public-endpoints)
2. [Webhook Endpoints](#webhook-endpoints)
3. [Admin API Endpoints](#admin-api-endpoints)
4. [Authentication](#authentication)

---

## Public Endpoints

### Health Check

Check if the service is running and healthy.

**Endpoint:** `GET /health`

**Authentication:** None

**Response:**
```json
{
  "status": "ok",
  "service": "awh-outbound-orchestrator",
  "timestamp": "2025-12-12T10:30:00.000Z",
  "architecture": "async"
}
```

**Example:**
```bash
curl http://localhost:3000/health
```

---

## Webhook Endpoints

### 1. Convoso Webhook (Initiate Outbound Call)

Receives webhooks from Convoso when a lead fills out a web form. Initiates a Bland AI outbound call.

**Endpoint:** `POST /webhooks/awhealth-outbound`

**Authentication:** None (webhook from Convoso)

**Request Body:**
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "phone_number": "5551234567",
  "state": "CA",
  "lead_id": "12345",
  "list_id": "16529",
  "email": "john@example.com",
  "address1": "123 Main St",
  "city": "Los Angeles",
  "postal_code": "90001",
  "date_of_birth": "1980-01-15",
  "age": "44"
}
```

**Required Fields:**
- `phone_number` (string) - Lead's phone number
- `lead_id` (string) - Convoso lead ID
- `list_id` (string) - Convoso list ID (dynamic per lead)

**Optional Fields:**
- `first_name` (string) - Default: "Unknown"
- `last_name` (string) - Default: "Lead"
- `state` (string)
- `email` (string)
- `address1` (string)
- `city` (string)
- `postal_code` (string)
- `date_of_birth` (string)
- `age` (string)

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Webhook received, processing in background",
  "request_id": "req_1702345678_abc123"
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Invalid payload: phone_number is required, lead_id is required, list_id is required",
  "request_id": "req_1702345678_abc123"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/webhooks/awhealth-outbound \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Doe",
    "phone_number": "5551234567",
    "state": "CA",
    "lead_id": "12345",
    "list_id": "16529"
  }'
```

---

### 2. Bland Webhook (Call Completion)

Receives webhooks from Bland AI when an outbound call completes. Updates Convoso with call results.

**Endpoint:** `POST /webhooks/bland-callback`

**Authentication:** None (webhook from Bland AI)

**Request Body:**
Bland sends their standard webhook payload with call results, transcript, and variables.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Webhook received",
  "requestId": "bland_1702345678_xyz789"
}
```

**Example:**
This endpoint is called automatically by Bland AI. Configure in Bland dashboard:
```
Webhook URL: https://your-domain.com/webhooks/bland-callback
```

---

### 3. Callback Webhook (Zapier Replacement)

Alternative webhook endpoint for triggering callbacks.

**Endpoint:** `POST /webhooks/call-back`

**Authentication:** None

**Details:** See [callbackWebhook.ts](src/routes/callbackWebhook.ts) for implementation.

---

## Admin API Endpoints

All admin endpoints require authentication via API key.

### Authentication

**Method 1: Header**
```bash
curl -H "X-API-Key: your-admin-api-key" \
  http://localhost:3000/api/admin/health
```

**Method 2: Query Parameter**
```bash
curl "http://localhost:3000/api/admin/health?api_key=your-admin-api-key"
```

**Setup:**
Set the `ADMIN_API_KEY` environment variable in your `.env` file:
```bash
ADMIN_API_KEY=awh_admin_2024_secure_key_change_in_production
```

---

### Admin - System Health

Get comprehensive system health status including memory, uptime, and rate limits.

**Endpoint:** `GET /api/admin/health`

**Authentication:** Required (API Key)

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-12T10:30:00.000Z",
  "status": "healthy",
  "uptime_seconds": 86400,
  "uptime_formatted": "24h 0m",
  "memory": {
    "rss_mb": 125.45,
    "heap_used_mb": 89.32,
    "heap_total_mb": 120.5
  },
  "calls": {
    "total": 150,
    "pending": 5,
    "completed": 140,
    "failed": 5
  },
  "rate_limit": {
    "current_rate": "3/5 calls/sec",
    "utilization": "60%",
    "unique_numbers": 142,
    "config": {
      "enabled": true,
      "maxCallsPerSecond": 5,
      "sameNumberIntervalMs": 10000
    }
  },
  "node_version": "v20.10.0",
  "platform": "linux"
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/health
```

---

### Admin - Active Calls

Get all currently active/pending calls.

**Endpoint:** `GET /api/admin/calls/active`

**Authentication:** Required (API Key)

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-12T10:30:00.000Z",
  "count": 3,
  "calls": [
    {
      "call_id": "bland_abc123",
      "request_id": "req_1702345678_abc123",
      "lead_id": "12345",
      "phone_number": "+15551234567",
      "first_name": "John",
      "last_name": "Doe",
      "created_at": 1702345678000,
      "status": "pending",
      "error": null,
      "duration_ms": 45000,
      "age_minutes": 0.75,
      "created_at_iso": "2025-12-12T10:27:58.000Z",
      "customer_name": "John Doe",
      "is_stale": false
    }
  ]
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/calls/active
```

---

### Admin - Call Statistics

Get statistics about calls in the cache.

**Endpoint:** `GET /api/admin/calls/stats`

**Authentication:** Required (API Key)

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-12T10:30:00.000Z",
  "stats": {
    "total": 150,
    "pending": 5,
    "completed": 140,
    "failed": 5,
    "cache_size_mb": 89.32,
    "memory_usage": {
      "rss_mb": 125.45,
      "heap_used_mb": 89.32,
      "heap_total_mb": 120.5
    }
  }
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/calls/stats
```

---

### Admin - Get Specific Call

Get details for a specific call by call_id.

**Endpoint:** `GET /api/admin/calls/:call_id`

**Authentication:** Required (API Key)

**Path Parameters:**
- `call_id` (string) - Bland call ID

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-12T10:30:00.000Z",
  "call": {
    "call_id": "bland_abc123",
    "request_id": "req_1702345678_abc123",
    "lead_id": "12345",
    "list_id": "16529",
    "phone_number": "+15551234567",
    "first_name": "John",
    "last_name": "Doe",
    "created_at": 1702345678000,
    "status": "completed",
    "error": null,
    "duration_ms": 120000,
    "age_minutes": 2.0,
    "created_at_iso": "2025-12-12T10:28:00.000Z",
    "customer_name": "John Doe",
    "is_stale": false
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "Call not found",
  "call_id": "bland_xyz789"
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/calls/bland_abc123
```

---

### Admin - Clear Cache

Manually trigger cleanup of old calls from cache.

**Endpoint:** `POST /api/admin/cache/clear`

**Authentication:** Required (API Key)

**Response:**
```json
{
  "success": true,
  "message": "Cache cleared successfully",
  "before": {
    "total": 150,
    "pending": 5,
    "completed": 140,
    "failed": 5
  },
  "after": {
    "total": 10,
    "pending": 5,
    "completed": 5,
    "failed": 0
  },
  "cleared": 140
}
```

**Example:**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/cache/clear
```

---

### Admin - Delete Specific Call

Manually remove a specific call from cache.

**Endpoint:** `DELETE /api/admin/calls/:call_id`

**Authentication:** Required (API Key)

**Path Parameters:**
- `call_id` (string) - Bland call ID to remove

**Response:**
```json
{
  "success": true,
  "message": "Call removed from cache",
  "call_id": "bland_abc123"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "Call not found",
  "call_id": "bland_xyz789"
}
```

**Example:**
```bash
curl -X DELETE \
  -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/calls/bland_abc123
```

---

### Admin - Statistics: Today

Get call statistics for today.

**Endpoint:** `GET /api/admin/statistics/today`

**Authentication:** Required (API Key)

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-12T10:30:00.000Z",
  "statistics": {
    "date": "2025-12-12",
    "total_calls": 150,
    "completed_calls": 140,
    "failed_calls": 10,
    "answered_calls": 120,
    "transferred_calls": 45,
    "voicemail_calls": 30,
    "no_answer_calls": 20,
    "busy_calls": 5,
    "not_interested_calls": 25,
    "callback_requested_calls": 10,
    "connectivity_rate": 80.0,
    "transfer_rate": 37.5,
    "success_rate": 93.33
  }
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/statistics/today
```

---

### Admin - Statistics: By Date

Get call statistics for a specific date.

**Endpoint:** `GET /api/admin/statistics/date/:date`

**Authentication:** Required (API Key)

**Path Parameters:**
- `date` (string) - Date in YYYY-MM-DD format (e.g., "2025-12-12")

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-12T10:30:00.000Z",
  "date": "2025-12-10",
  "statistics": {
    "date": "2025-12-10",
    "total_calls": 200,
    "completed_calls": 190,
    "failed_calls": 10,
    "answered_calls": 160,
    "transferred_calls": 60,
    "voicemail_calls": 40,
    "no_answer_calls": 30,
    "busy_calls": 8,
    "not_interested_calls": 30,
    "callback_requested_calls": 12,
    "connectivity_rate": 80.0,
    "transfer_rate": 37.5,
    "success_rate": 95.0
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Invalid date format. Use YYYY-MM-DD"
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/statistics/date/2025-12-10
```

---

### Admin - Statistics: Date Range

Get call statistics for a date range.

**Endpoint:** `GET /api/admin/statistics/range`

**Authentication:** Required (API Key)

**Query Parameters:**
- `start_date` (string, required) - Start date in YYYY-MM-DD format
- `end_date` (string, required) - End date in YYYY-MM-DD format

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-12T10:30:00.000Z",
  "start_date": "2025-12-01",
  "end_date": "2025-12-10",
  "days": 10,
  "statistics": [
    {
      "date": "2025-12-01",
      "total_calls": 150,
      "completed_calls": 145,
      "failed_calls": 5,
      "answered_calls": 120,
      "transferred_calls": 45,
      "voicemail_calls": 25,
      "no_answer_calls": 20,
      "busy_calls": 5,
      "not_interested_calls": 20,
      "callback_requested_calls": 8,
      "connectivity_rate": 80.0,
      "transfer_rate": 37.5,
      "success_rate": 96.67
    }
    // ... more days
  ]
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Missing required parameters: start_date and end_date"
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:3000/api/admin/statistics/range?start_date=2025-12-01&end_date=2025-12-10"
```

---

### Admin - Statistics: All-Time

Get aggregated statistics across all dates.

**Endpoint:** `GET /api/admin/statistics/all-time`

**Authentication:** Required (API Key)

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-12T10:30:00.000Z",
  "statistics": {
    "date": "all-time",
    "total_calls": 5000,
    "completed_calls": 4800,
    "failed_calls": 200,
    "answered_calls": 4000,
    "transferred_calls": 1500,
    "voicemail_calls": 800,
    "no_answer_calls": 600,
    "busy_calls": 150,
    "not_interested_calls": 900,
    "callback_requested_calls": 300,
    "connectivity_rate": 80.0,
    "transfer_rate": 37.5,
    "success_rate": 96.0,
    "total_days": 30
  }
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/admin/statistics/all-time
```

---

## What the Orchestrator Stores

The orchestrator stores call state information **in memory** using the `CallStateManager`. Here's what's stored for each call:

### Stored Data (PendingCall Interface)

```typescript
interface PendingCall {
  call_id: string;          // Bland call ID
  request_id: string;       // Internal request tracking ID
  lead_id: string;          // Convoso lead ID (dynamic from webhook)
  list_id: string;          // Convoso list ID (dynamic from webhook) ✅ NEW
  phone_number: string;     // Lead's phone number
  first_name: string;       // Lead's first name
  last_name: string;        // Lead's last name
  created_at: number;       // Timestamp when call was initiated
  status: "pending" | "completed" | "failed";
  error?: string;           // Error message if call failed
}
```

### Storage Duration

- **Pending calls**: Stored until webhook received or 90 minutes (configurable)
- **Completed calls**: Retained for 90 minutes for dashboard visibility (configurable)
- **Failed calls**: Retained for 90 minutes for debugging (configurable)
- **Statistics**: Permanently stored in JSON files (date-wise) in `data/statistics/`

### Configuration

Cache retention is configurable via environment variables:
```bash
CACHE_COMPLETED_RETENTION_MINUTES=90    # How long to keep completed calls
CACHE_PENDING_MAX_AGE_MINUTES=90        # Max age before call marked as stale
CACHE_CLEANUP_INTERVAL_MINUTES=10       # How often to run cleanup
```

---

## Error Responses

All endpoints follow a consistent error format:

**401 Unauthorized (Admin endpoints only):**
```json
{
  "success": false,
  "error": "Unauthorized - Invalid API key"
}
```

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Invalid payload: phone_number is required"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "Call not found",
  "call_id": "bland_xyz789"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Internal Server Error",
  "message": "Detailed error message"
}
```

---

## Rate Limiting

The orchestrator includes built-in rate limiting for Bland API calls:

- **Default**: 5 calls per second
- **Same number protection**: 10 second interval between calls to same number
- **Configurable** via environment variables

Rate limit stats available in `/api/admin/health` endpoint.

---

## Retool Integration

All admin endpoints are designed to work seamlessly with Retool dashboards. Use the API key authentication method with Retool's REST API resource.

**Example Retool Setup:**
1. Create REST API resource
2. Base URL: `http://your-server:3000`
3. Add header: `X-API-Key: your-admin-api-key`
4. Use endpoints as documented above

---

## Support

For issues or questions:
- GitHub Issues: [github.com/your-repo/issues](https://github.com/anthropics/claude-code/issues)
- Internal team contact: Delaine (PM), Jeff (AWH Contact)

---

*Last Updated: 2025-12-12*
