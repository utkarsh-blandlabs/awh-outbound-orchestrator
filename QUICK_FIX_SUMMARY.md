# Quick Fix Summary - Query Parameter Authentication

## Problem
Chrome URLs with `?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL` were returning:
```json
{"success": false, "error": "Unauthorized - Invalid API key"}
```

## Root Cause
The authentication middleware was checking for:
- Header: `X-API-Key` ✅
- Query param: `api_key` ✅
- Query param: `key` ❌ (was NOT supported)

You were using `?key=...` which wasn't recognized.

## Fix Applied
Updated [adminRoutes.ts:23](src/routes/adminRoutes.ts#L23) to accept **all three** authentication methods:
```typescript
const apiKey = req.headers["x-api-key"] || req.query["api_key"] || req.query["key"];
```

## Testing Results ✅
Tested locally and confirmed working:

### Status Endpoint:
```bash
curl "http://localhost:3000/api/admin/redial-queue/status?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"
```
**Response:**
```json
{
  "success": true,
  "status": {
    "running": true,
    "enabled": true,
    "max_attempts": 8  ← Updated from 4!
  }
}
```

### Config Endpoint:
```bash
curl "http://localhost:3000/api/admin/redial-queue/config?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL"
```
**Response:**
```json
{
  "success": true,
  "config": {
    "progressive_intervals": [0, 0, 5, 10, 30, 60, 120],  ← New!
    "max_redial_attempts": 8  ← Updated from 4!
  }
}
```

## What to Deploy

### Files Changed:
1. ✅ `src/routes/adminRoutes.ts` - Fixed authentication
2. ✅ `src/services/redialQueueService.ts` - Progressive intervals
3. ✅ `.env` - Updated config values

### Build Status:
✅ `npm run build` - Successful (no errors)

---

## Deployment to EC2

### Option 1: Quick Deploy (Copy-Paste)
SSH into your server and run:

```bash
cd /path/to/awh-outbound-orchestrator
git pull origin main
npm run build
pm2 restart all
```

### Option 2: Step-by-Step
See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed instructions.

---

## Testing After Deployment

Once deployed, test these URLs in Chrome (replace `client.blandlabs.ai` with your domain):

### 1. ✅ Check Status
```
http://client.blandlabs.ai/api/admin/redial-queue/status?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```
**Expected:** `"max_attempts": 8`

### 2. ✅ Check Config
```
http://client.blandlabs.ai/api/admin/redial-queue/config?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```
**Expected:** `"progressive_intervals": [0, 0, 5, 10, 30, 60, 120]`

### 3. ✅ View All Records
```
http://client.blandlabs.ai/api/admin/redial-queue/records?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### 4. ✅ View Statistics
```
http://client.blandlabs.ai/api/admin/redial-queue/stats?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### 5. ✅ View Pending Only
```
http://client.blandlabs.ai/api/admin/redial-queue/records?status=pending&key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

### 6. ✅ View Ready to Dial
```
http://client.blandlabs.ai/api/admin/redial-queue/records?ready=true&key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL
```

---

## Alternative: Use api_key Parameter
Both work now:
- `?key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL` ✅
- `?api_key=24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL` ✅

---

## Summary of All Changes

| Component | Old Value | New Value | Status |
|-----------|-----------|-----------|--------|
| **Authentication** | Only `?api_key=...` | Also accepts `?key=...` | ✅ Fixed |
| **Max Attempts** | 4 | 8 | ✅ Updated |
| **Intervals** | Fixed 30 min | Progressive [0,0,5,10,30,60,120] | ✅ Updated |
| **Build** | N/A | No errors | ✅ Success |

---

**Status: Ready for Deployment!** 🚀

The Chrome URLs will work immediately after deploying to your EC2 server.
