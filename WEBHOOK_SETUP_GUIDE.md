# Webhook Setup Guide

This guide will help you set up the webhook-based architecture for local testing and production deployment.

---

## Prerequisites

- Node.js 18+ installed
- Bland AI API key
- Convoso API credentials
- (For local testing) ngrok installed

---

## Step 1: Update Environment Variables

Edit your `.env` file:

```bash
# Set your webhook URL
# IMPORTANT: This must be a publicly accessible HTTPS URL

# For local testing with ngrok:
BLAND_WEBHOOK_URL=https://YOUR_NGROK_ID.ngrok.io/webhooks/bland-callback

# For production (e.g., Render):
BLAND_WEBHOOK_URL=https://your-app.onrender.com/webhooks/bland-callback
```

---

## Step 2: Local Testing with ngrok

### Install ngrok (if not already installed)

**macOS:**
```bash
brew install ngrok
```

**Other platforms:**
Download from https://ngrok.com/download

### Start ngrok

```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding  https://abc123def456.ngrok.io -> http://localhost:3000
```

### Update .env with ngrok URL

Copy the HTTPS URL from ngrok and update `.env`:

```bash
BLAND_WEBHOOK_URL=https://abc123def456.ngrok.io/webhooks/bland-callback
```

### Start your server

```bash
npm run dev
```

### Test it!

1. Send a test webhook to `/webhooks/awhealth-outbound`:
   ```bash
   curl -X POST http://localhost:3000/webhooks/awhealth-outbound \
     -H "Content-Type: application/json" \
     -d '{
       "first_name": "Test",
       "last_name": "User",
       "phone_number": "+15551234567",
       "state": "CA",
       "lead_id": "test_123",
       "list_id": "16529"
     }'
   ```

2. Watch the logs - you should see:
   ```
   📥 Received AWH webhook
   📞 Stage: BLAND_CALL - Starting
   ✅ Call initiated successfully, waiting for Bland webhook
   🔔 Stage: WEBHOOK_REGISTERED - Completed
   ```

3. When Bland completes the call, it will POST to your ngrok URL
4. Your local server will receive the webhook and process it!

---

## Step 3: Production Deployment

### Option A: Render.com

1. Push your code to GitHub

2. Create a new Web Service on Render:
   - Connect your GitHub repo
   - Build command: `npm install && npm run build`
   - Start command: `npm start`

3. Add environment variables in Render dashboard:
   ```
   BLAND_API_KEY=your_key_here
   BLAND_PATHWAY_ID=0258dd7c-e952-43ca-806e-23e1c6c7334b
   CONVOSO_AUTH_TOKEN=your_token_here
   BLAND_WEBHOOK_URL=https://your-app.onrender.com/webhooks/bland-callback
   ... (all other env vars from .env)
   ```

4. Deploy!

5. Your app will be live at: `https://your-app.onrender.com`

### Option B: Heroku

1. Install Heroku CLI and login

2. Create app:
   ```bash
   heroku create awh-outbound-orchestrator
   ```

3. Set environment variables:
   ```bash
   heroku config:set BLAND_API_KEY=your_key
   heroku config:set BLAND_PATHWAY_ID=0258dd7c-...
   heroku config:set CONVOSO_AUTH_TOKEN=your_token
   heroku config:set BLAND_WEBHOOK_URL=https://awh-outbound-orchestrator.herokuapp.com/webhooks/bland-callback
   ```

4. Deploy:
   ```bash
   git push heroku main
   ```

5. Your app will be live at: `https://awh-outbound-orchestrator.herokuapp.com`

---

## Step 4: Configure Convoso Webhook

In your Convoso dashboard, set up a webhook to trigger on lead creation:

**Webhook URL:**
```
https://your-app.onrender.com/webhooks/awhealth-outbound
```

**Method:** POST

**Payload:** Include all lead fields (first_name, last_name, phone_number, etc.)

---

## Step 5: Verify It's Working

### Check Health Endpoint

```bash
curl https://your-app.onrender.com/health
```

Should return:
```json
{
  "status": "ok",
  "service": "awh-outbound-orchestrator",
  "architecture": "async"
}
```

### Test Full Flow

1. Create a test lead in Convoso
2. Convoso sends webhook to your app
3. Your app initiates Bland call
4. Bland makes the call
5. When call completes, Bland sends webhook back to your app
6. Your app updates Convoso with results

### Monitor Logs

**On Render:**
- Go to your service dashboard
- Click "Logs" tab
- Watch real-time logs

**Locally:**
- All logs appear in your terminal
- Use `LOG_LEVEL=debug` for detailed logs

---

## Troubleshooting

### "Webhook never arrives from Bland"

**Check:**
1. Is `BLAND_WEBHOOK_URL` set correctly in `.env`?
2. Is the URL publicly accessible (not localhost)?
3. Is the URL HTTPS (not HTTP)?
4. Check Bland dashboard for webhook delivery failures

**Fix:**
- Verify webhook URL is correct
- For ngrok: make sure ngrok is still running
- For production: make sure app is deployed and accessible

### "No pending call found for this call_id"

**Cause:** Webhook arrived but call state not registered

**Fix:**
- Check logs around call initiation
- Verify `CallStateManager.addPendingCall()` was called
- May be a timing issue (very rare)

### "401 Unauthorized from Bland"

**Cause:** Invalid or missing `BLAND_API_KEY`

**Fix:**
1. Check `.env` file has correct API key
2. Verify no extra spaces or quotes
3. Get fresh API key from Bland dashboard if needed

### "Failed to update Convoso"

**Cause:** Convoso API error

**Fix:**
- Check `CONVOSO_AUTH_TOKEN` is correct
- Verify `lead_id` exists in Convoso
- Check Convoso API status

---

## Architecture Diagram

```
┌─────────────┐
│   Convoso   │
│   (CRM)     │
└──────┬──────┘
       │ 1. Webhook (new lead)
       ▼
┌─────────────────────────┐
│  Your Server            │
│  ┌──────────────────┐   │
│  │ POST /webhooks/  │   │
│  │ awhealth-outbound│   │
│  └────────┬─────────┘   │
│           │              │
│           │ 2. Initiate call
│           │    with webhook URL
│           ▼              │
│  ┌──────────────────┐   │
│  │  CallStateManager│   │
│  │  (track pending) │   │
│  └──────────────────┘   │
└───────────────┬─────────┘
                │
                ▼
        ┌───────────────┐
        │   Bland AI    │
        │  (makes call) │
        └───────┬───────┘
                │
                │ 3. Call customer
                │    (1-30 minutes)
                │
                │ 4. Webhook (call complete)
                ▼
┌─────────────────────────┐
│  Your Server            │
│  ┌──────────────────┐   │
│  │ POST /webhooks/  │   │
│  │ bland-callback   │   │
│  └────────┬─────────┘   │
│           │              │
│           │ 5. Update Convoso
│           ▼              │
│  ┌──────────────────┐   │
│  │  Convoso API     │   │
│  │  (update log)    │   │
│  └──────────────────┘   │
└─────────────────────────┘
```

---

## Next Steps

Once webhooks are working:

1. ✅ Remove or comment out polling logic completely
2. ✅ Monitor memory usage (should be much lower)
3. ✅ Test with multiple concurrent calls
4. ✅ Set up proper monitoring/alerting
5. ✅ Consider moving to Redis for persistent state (optional)

---

## Need Help?

- Check logs: `LOG_LEVEL=debug npm run dev`
- Read full architecture: [WEBHOOK_ARCHITECTURE.md](WEBHOOK_ARCHITECTURE.md)
- Test individual components with curl
- Check Bland AI docs: https://docs.bland.ai/api-reference/post-call-webhooks
