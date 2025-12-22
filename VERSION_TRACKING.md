# Version Tracking System

## Overview

The version tracking system provides visibility into:
- ✅ Current running version number
- ✅ Deployment timestamp (when was this version deployed)
- ✅ Environment (production/development)
- ✅ Uptime (how long has the service been running)

This information is available in the `/health` endpoint for monitoring and debugging.

---

## How It Works

### 1. Version Service ([src/services/versionService.ts](src/services/versionService.ts))

The `VersionService` singleton:
- Reads version from `package.json`
- Reads deployment timestamp from `version.json`
- Tracks uptime from service start
- Provides version info to health endpoint

**Auto-starts on application startup** - no manual initialization needed.

### 2. Version File ([version.json](version.json))

```json
{
  "version": "1.0.0",
  "deployedAt": "2025-12-22T15:38:03.000 EST",
  "environment": "production",
  "note": "This file is auto-generated. Update deployedAt on each deployment."
}
```

**Important:**
- `version` - Comes from package.json
- `deployedAt` - Updated on each deployment with current **EST timestamp**
- `environment` - production/development (from NODE_ENV)
- This file is **auto-created** on first run if missing

### 3. Health Endpoint

**URL:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "service": "awh-outbound-orchestrator",
  "version": "1.0.0",
  "deployedAt": "2025-12-22T20:34:32.000Z",
  "environment": "production",
  "uptime": 3600,
  "timestamp": "2025-12-22T21:34:32.000Z",
  "architecture": "async"
}
```

**Fields:**
- `version` - Version number from package.json
- `deployedAt` - When this version was deployed (UTC)
- `environment` - production/development
- `uptime` - Seconds since service started
- `timestamp` - Current UTC timestamp

---

## Deployment Workflow

### On Local Development

Just run the app - version.json will be auto-created:

```bash
npm run dev
```

### On Production Deployment

**Step 1:** Update version.json before deployment

```bash
./update-version.sh
```

This updates `version.json` with:
- Current version from package.json
- Current UTC timestamp
- Current environment (from NODE_ENV)

**Step 2:** Build and deploy

```bash
# Build
npm run build

# Restart PM2
pm2 restart all
```

**Step 3:** Verify deployment

```bash
# Check health endpoint
curl http://localhost:3000/health

# Should show:
# - version: "1.0.0"
# - deployedAt: "2025-12-22T20:34:32.000Z" (current timestamp)
# - uptime: 0 (just started)
```

---

## Complete Deployment Commands

### On EC2 Server

```bash
# SSH into server
ssh -i /path/to/your-key.pem ubuntu@client.blandlabs.ai

# Navigate to project
cd /path/to/awh-outbound-orchestrator

# Pull latest code
git pull origin main

# Update version timestamp
./update-version.sh

# Build project
npm run build

# Restart PM2
pm2 restart all

# Verify deployment
curl http://localhost:3000/health | jq
```

**Expected output:**
```json
{
  "status": "ok",
  "service": "awh-outbound-orchestrator",
  "version": "1.0.0",
  "deployedAt": "2025-12-22T20:34:32.000Z",  ← Shows deployment time
  "environment": "production",
  "uptime": 5,  ← Seconds since restart
  "timestamp": "2025-12-22T20:34:37.000Z",
  "architecture": "async"
}
```

---

## Updating Version Number

To increment the version (e.g., 1.0.0 → 1.1.0):

**Step 1:** Update package.json

```bash
# Edit package.json manually or use npm version
npm version patch  # 1.0.0 → 1.0.1
npm version minor  # 1.0.0 → 1.1.0
npm version major  # 1.0.0 → 2.0.0
```

**Step 2:** Update version.json

```bash
./update-version.sh
```

**Step 3:** Commit changes

```bash
git add package.json version.json
git commit -m "Bump version to 1.1.0"
git push
```

**Step 4:** Deploy to production (see above)

---

## Monitoring

### Check Current Version

```bash
# Local
curl http://localhost:3000/health | jq '.version'

# Production
curl https://client.blandlabs.ai/health | jq '.version'
```

### Check Deployment Time

```bash
# When was this version deployed?
curl http://localhost:3000/health | jq '.deployedAt'
```

### Check Uptime

```bash
# How long has service been running?
curl http://localhost:3000/health | jq '.uptime'

# Example: 3600 seconds = 1 hour
```

---

## Troubleshooting

### Issue: version.json Missing After Deployment

**Cause:** File not committed to git

**Fix:**
```bash
# Run update script to create it
./update-version.sh

# Commit it
git add version.json
git commit -m "Add version.json"
```

### Issue: deployedAt Showing Old Timestamp

**Cause:** version.json not updated before deployment

**Fix:**
```bash
# Update version.json
./update-version.sh

# Restart service
pm2 restart all
```

### Issue: Version Shows "unknown"

**Cause:** package.json not found or invalid

**Fix:**
```bash
# Verify package.json exists
cat package.json | jq '.version'

# Should output: "1.0.0"
```

---

## API Integration (For Retool/Monitoring)

The health endpoint is **publicly accessible** (no auth required) for monitoring:

```javascript
// Fetch version info
const response = await fetch('https://client.blandlabs.ai/health');
const data = await response.json();

console.log(`Version: ${data.version}`);
console.log(`Deployed: ${data.deployedAt}`);
console.log(`Uptime: ${data.uptime} seconds`);
```

**Use cases:**
- **Monitoring dashboards** - Display current version and uptime
- **Automated deployments** - Verify deployment succeeded by checking deployedAt
- **Alerting** - Alert if uptime resets unexpectedly (service crashed)
- **Debugging** - Know which version is running when investigating issues

---

## Files in This System

1. **[src/services/versionService.ts](src/services/versionService.ts)** - Version tracking service
2. **[version.json](version.json)** - Deployment timestamp and version info
3. **[update-version.sh](update-version.sh)** - Script to update version.json on deployment
4. **[package.json](package.json)** - Source of version number
5. **[src/index.ts](src/index.ts)** - Health endpoint integration

---

## Summary

**What you get:**
- ✅ Version number visible in `/health` endpoint
- ✅ Deployment timestamp tracked automatically
- ✅ Uptime monitoring included
- ✅ Easy to update on each deployment
- ✅ No manual configuration needed

**How to use:**
1. Run `./update-version.sh` before deployment
2. Build and restart service
3. Check `/health` to verify version info

**Result:** Full visibility into what version is running and when it was deployed! 🚀
