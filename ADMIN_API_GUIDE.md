# Admin API Guide for Retool

## Overview

The admin API provides endpoints for monitoring and managing active calls. Use these endpoints in your Retool dashboard.

---

## Authentication

All admin endpoints require an API key passed via header or query parameter.

### Set API Key in `.env`:
```bash
ADMIN_API_KEY=your_secure_random_key_here
```

### Pass API Key in Requests:

**Option 1: Header (Recommended)**
```
X-API-Key: your_secure_random_key_here
```

**Option 2: Query Parameter**
```
?api_key=your_secure_random_key_here
```

---

## Endpoints

### 1. **GET /api/admin/calls/active**

Returns all active/pending calls.

**URL:**
```
https://awh-outbound-orchestrator.onrender.com/api/admin/calls/active
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-04T10:30:45.123Z",
  "count": 3,
  "calls": [
    {
      "call_id": "cf513580-64f2-4f55-9df4-68efc66b48a8",
      "request_id": "req_1764798354934_w1vo1ex",
      "lead_id": "test_lead_12345",
      "phone_number": "+14439405017",
      "first_name": "Delaine",
      "last_name": "Bueno",
      "created_at": 1733309154934,
      "status": "pending",
      "error": null,
      "duration_ms": 45230,
      "age_minutes": 0.75,
      "created_at_iso": "2025-12-04T10:29:14.934Z",
      "customer_name": "Delaine Bueno",
      "is_stale": false
    }
  ]
}
```

**Retool Configuration:**
```javascript
// Resource: REST API
// Method: GET
// URL: https://awh-outbound-orchestrator.onrender.com/api/admin/calls/active
// Headers: { "X-API-Key": "{{ secrets.ADMIN_API_KEY }}" }

// Transformer:
return {
  data: data.calls.map(call => ({
    ...call,
    duration_formatted: `${(call.duration_ms / 1000 / 60).toFixed(1)}m`,
    created_at_relative: moment(call.created_at_iso).fromNow(),
  }))
};
```

---

### 2. **GET /api/admin/calls/stats**

Returns cache statistics.

**URL:**
```
https://awh-outbound-orchestrator.onrender.com/api/admin/calls/stats
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-04T10:30:45.123Z",
  "stats": {
    "total": 15,
    "pending": 10,
    "completed": 3,
    "failed": 2,
    "cache_size_mb": 2.45,
    "memory_usage": {
      "rss_mb": 125.34,
      "heap_used_mb": 89.23,
      "heap_total_mb": 112.45
    }
  }
}
```

**Retool Usage:**
Use this for stat cards at the top of your dashboard.

---

### 3. **GET /api/admin/calls/:call_id**

Returns details for a specific call.

**URL:**
```
https://awh-outbound-orchestrator.onrender.com/api/admin/calls/cf513580-64f2-4f55-9df4-68efc66b48a8
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-04T10:30:45.123Z",
  "call": {
    "call_id": "cf513580-64f2-4f55-9df4-68efc66b48a8",
    "request_id": "req_1764798354934_w1vo1ex",
    "lead_id": "test_lead_12345",
    "phone_number": "+14439405017",
    "first_name": "Delaine",
    "last_name": "Bueno",
    "created_at": 1733309154934,
    "status": "pending",
    "error": null,
    "duration_ms": 45230,
    "age_minutes": 0.75,
    "created_at_iso": "2025-12-04T10:29:14.934Z",
    "customer_name": "Delaine Bueno",
    "is_stale": false
  }
}
```

**Retool Usage:**
Call this when user clicks on a call in the table to show details modal.

---

### 4. **GET /api/admin/health**

Returns system health and uptime.

**URL:**
```
https://awh-outbound-orchestrator.onrender.com/api/admin/health
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-12-04T10:30:45.123Z",
  "status": "healthy",
  "uptime_seconds": 86400,
  "uptime_formatted": "24h 0m",
  "memory": {
    "rss_mb": 125.34,
    "heap_used_mb": 89.23,
    "heap_total_mb": 112.45
  },
  "calls": {
    "total": 15,
    "pending": 10,
    "completed": 3,
    "failed": 2
  },
  "node_version": "v20.10.0",
  "platform": "linux"
}
```

**Retool Usage:**
Use for system health panel in dashboard.

---

### 5. **POST /api/admin/cache/clear**

Manually clears completed/failed calls from cache.

**URL:**
```
https://awh-outbound-orchestrator.onrender.com/api/admin/cache/clear
```

**Method:** POST

**Headers:**
```json
{
  "X-API-Key": "your_api_key",
  "X-User": "admin@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Cache cleared successfully",
  "before": {
    "total": 15,
    "pending": 10,
    "completed": 3,
    "failed": 2
  },
  "after": {
    "total": 10,
    "pending": 10,
    "completed": 0,
    "failed": 0
  },
  "cleared": 5
}
```

**Retool Usage:**
Add a button that triggers this endpoint.

---

### 6. **DELETE /api/admin/calls/:call_id**

Manually remove a specific call from cache.

**URL:**
```
https://awh-outbound-orchestrator.onrender.com/api/admin/calls/cf513580-64f2-4f55-9df4-68efc66b48a8
```

**Method:** DELETE

**Response:**
```json
{
  "success": true,
  "message": "Call removed from cache",
  "call_id": "cf513580-64f2-4f55-9df4-68efc66b48a8"
}
```

**Retool Usage:**
Add a "Remove" button in the actions column of the table.

---

## Retool Setup Example

### Active Calls Table Query

```javascript
// Query Name: getActiveCalls
// Type: REST API
// Method: GET
// URL: https://awh-outbound-orchestrator.onrender.com/api/admin/calls/active

// Headers
{
  "X-API-Key": "{{ secrets.ADMIN_API_KEY }}"
}

// Transformer
return {
  data: data.calls.map(call => ({
    call_id: call.call_id,
    customer: `${call.first_name} ${call.last_name}`,
    phone: call.phone_number,
    lead_id: call.lead_id,
    status: call.status,
    duration: `${(call.duration_ms / 1000 / 60).toFixed(1)}m`,
    started: moment(call.created_at_iso).fromNow(),
    is_stale: call.is_stale,
    status_color: call.status === 'pending' ? 'blue' :
                  call.status === 'completed' ? 'green' : 'red'
  }))
};
```

### Stats Cards Query

```javascript
// Query Name: getStats
// Type: REST API
// Method: GET
// URL: https://awh-outbound-orchestrator.onrender.com/api/admin/calls/stats

// Headers
{
  "X-API-Key": "{{ secrets.ADMIN_API_KEY }}"
}

// Use directly in stat cards:
{{ getStats.data.stats.pending }}
{{ getStats.data.stats.completed }}
{{ getStats.data.stats.failed }}
{{ getStats.data.stats.total }}
```

### Auto-Refresh

Set query to run every 5 seconds:
- Click query → Settings → Run this query on a schedule → Every 5 seconds

---

## Testing Locally

### 1. Start Server
```bash
npm run dev
```

### 2. Test Endpoints

**Get Active Calls:**
```bash
curl -H "X-API-Key: your_secure_random_key_here" \
  http://localhost:3000/api/admin/calls/active
```

**Get Stats:**
```bash
curl -H "X-API-Key: your_secure_random_key_here" \
  http://localhost:3000/api/admin/calls/stats
```

**Get Health:**
```bash
curl -H "X-API-Key: your_secure_random_key_here" \
  http://localhost:3000/api/admin/health
```

**Clear Cache:**
```bash
curl -X POST \
  -H "X-API-Key: your_secure_random_key_here" \
  -H "X-User: admin@example.com" \
  http://localhost:3000/api/admin/cache/clear
```

---

## Security Notes

1. **Never commit API keys to Git** - Use Retool secrets or environment variables
2. **Use HTTPS in production** - HTTP is only for local testing
3. **Rotate API keys regularly** - Change `ADMIN_API_KEY` periodically
4. **Add IP whitelist** - Consider restricting admin endpoints to specific IPs in production

---

## Next Steps

1. Add `ADMIN_API_KEY` to your `.env` file
2. Deploy to Render with the new environment variable
3. Set up Retool resources pointing to your deployed URL
4. Create tables and stats using the queries above
5. Test with real calls!

---

## Need More Endpoints?

Let me know if you need additional endpoints for:
- Historical call data (requires database)
- Analytics aggregations
- Configuration management
- Logs viewer
