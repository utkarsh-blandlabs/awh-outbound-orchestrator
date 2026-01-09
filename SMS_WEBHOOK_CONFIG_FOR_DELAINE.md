# SMS Webhook Configuration for Bland.ai - Instructions for Delaine

**Date**: January 8, 2026
**Purpose**: Configure Bland.ai to send SMS replies to our webhook for TCPA compliance (DNC/STOP handling)

---

## 🎯 What Needs to Be Configured

Bland.ai needs to send **all incoming SMS replies** to our webhook endpoint so we can automatically handle:
- ✅ DNC/STOP requests (TCPA compliance)
- ✅ Callback requests ("YES", "CALL ME")
- ✅ Negative responses ("NOT INTERESTED")

---

## 📍 Webhook URL to Configure

### Production Webhook URL:
```
https://client.blandlabs.ai/webhooks/sms-reply
```

### Method:
`POST`

### Phone Number to Configure:
`+15619565858` (Ashley's number used for SMS)

---

## 🔧 Configuration Method

### Option 1: Via Bland.ai Dashboard (Recommended)
1. Log in to [Bland.ai Dashboard](https://app.bland.ai)
2. Go to **Phone Numbers** or **SMS Settings**
3. Find phone number: `+15619565858`
4. Look for **"SMS Webhook"** or **"Inbound SMS Webhook"** setting
5. Enter webhook URL: `https://client.blandlabs.ai/webhooks/sms-reply`
6. Save configuration

### Option 2: Via Bland.ai API
Use this API call to configure the webhook:

```bash
curl -X POST "https://api.bland.ai/v1/sms/webhook/update" \
  -H "authorization: org_95373169f2f2d97cf5ab62908020adb131837e7dcb3028a2c8ab25b3fc19b998b470089f04526d06512069" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+15619565858",
    "webhook": "https://client.blandlabs.ai/webhooks/sms-reply"
  }'
```

**Expected Response:**
```json
{
  "status": "success"
}
```

---

## 📦 Expected Payload Format

When customers reply to SMS, Bland.ai should send a POST request to our webhook with this format:

```json
{
  "from": "+12173866023",
  "to": "+15619565858",
  "body": "STOP",
  "sms_id": "sms_abc123",
  "timestamp": "2026-01-08T12:00:00Z"
}
```

### Field Descriptions:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Customer's phone number (E.164 format) |
| `to` | string | Yes | Our number that received the SMS (+15619565858) |
| `body` | string | Yes | SMS message content from customer |
| `sms_id` | string | No | Bland.ai SMS message ID |
| `timestamp` | string | No | ISO 8601 timestamp |

---

## ✅ What Our Webhook Does Automatically

### 1. DNC/STOP Handling (TCPA Compliance)
**Triggers on keywords**: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REMOVE, OPT OUT, DO NOT CALL, DO NOT TEXT, DNC

**Automatic Actions**:
- ✅ Add to permanent blocklist (no more calls or SMS)
- ✅ Remove from SMS queue immediately
- ✅ Mark as completed in redial queue (stops all future calls)
- ✅ Log for Convoso DNC update

### 2. Callback Request Handling
**Triggers on keywords**: CALL ME, CALLBACK, YES, YES PLEASE, INTERESTED, MORE INFO

**Automatic Actions**:
- ✅ Look up lead in Convoso
- ✅ Schedule callback in redial queue (5 min if business hours, 1 hour otherwise)
- ✅ Set high priority for callback
- ✅ Log for team notification

### 3. Negative Response Handling
**Triggers on keywords**: NO, NOT INTERESTED, NO THANKS, NOT NOW, MAYBE LATER

**Automatic Actions**:
- ✅ Remove from SMS queue (stops SMS but allows calls)
- ✅ Log for Convoso update

---

## 🧪 Testing the Webhook

### Step 1: Verify Webhook is Accessible
```bash
curl -X POST "https://client.blandlabs.ai/webhooks/sms-reply" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+12173866023",
    "to": "+15619565858",
    "body": "TEST"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "requestId": "...",
  "replyType": "UNKNOWN",
  "actionTaken": ""
}
```

### Step 2: Test DNC Keyword
```bash
curl -X POST "https://client.blandlabs.ai/webhooks/sms-reply" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+12173866023",
    "to": "+15619565858",
    "body": "STOP"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "requestId": "...",
  "replyType": "OPT_OUT",
  "actionTaken": "DNC: Blocklist, Convoso DNC, SMS removed, Redial stopped"
}
```

### Step 3: Send Real SMS and Reply
1. Send test SMS to a phone number: `(628) 444-4907`
2. Reply "STOP" from that phone
3. Check logs to verify webhook received the reply:
   ```bash
   pm2 logs awh-orchestrator | grep "DNC request received"
   ```

---

## 🔍 Verifying Configuration

### Check if Webhook is Configured (API Method):
```bash
curl -X GET "https://api.bland.ai/v1/sms/numbers" \
  -H "authorization: org_95373169f2f2d97cf5ab62908020adb131837e7dcb3028a2c8ab25b3fc19b998b470089f04526d06512069"
```

Look for `+15619565858` in the response and verify the webhook URL is set.

### Check Server Logs After Configuration:
```bash
# Monitor incoming SMS replies
pm2 logs awh-orchestrator | grep "SMS webhook received"
pm2 logs awh-orchestrator | grep "DNC request received"
pm2 logs awh-orchestrator | grep "Callback request received"
```

---

## ⚠️ Important Notes

### Enterprise Plan Required
- SMS functionality (including webhooks) is **only available on Enterprise plans**
- Contact Bland.ai support if SMS features are not accessible

### Phone Number Verification
- Ensure `+15619565858` is **verified for SMS** in Bland.ai dashboard
- The number must be owned by your account

### Webhook Security
- Our webhook is **publicly accessible** (no authentication currently)
- Bland.ai will POST directly to: `https://client.blandlabs.ai/webhooks/sms-reply`
- Future enhancement: Add webhook signature verification for security

### Rate Limiting
- No rate limiting currently on webhook endpoint
- Bland.ai typically sends one webhook call per SMS reply

---

## 🆘 Troubleshooting

### If Webhook Doesn't Receive SMS Replies:

1. **Verify webhook is configured in Bland.ai**:
   - Check dashboard under phone number settings
   - Use API to verify webhook URL is set

2. **Check webhook is accessible**:
   ```bash
   curl https://client.blandlabs.ai/webhooks/sms-reply
   ```
   Should return 404 (endpoint exists but requires POST with data)

3. **Check server logs**:
   ```bash
   pm2 logs awh-orchestrator | grep "SMS webhook"
   ```

4. **Test with manual POST**:
   Use the curl commands above to simulate Bland.ai webhook

5. **Contact Bland.ai Support**:
   - Verify SMS webhook feature is enabled for your account
   - Ask for webhook payload format documentation
   - Check if there are any delivery failures

---

## 📞 Contact for Help

**Technical Issues (Server/Webhook)**:
- Check logs: `pm2 logs awh-orchestrator`
- Restart: `pm2 restart awh-orchestrator`

**Bland.ai Configuration Issues**:
- Contact Bland.ai support: support@bland.ai
- Reference: SMS webhook configuration for number `+15619565858`
- Request: Webhook payload format documentation

---

## 📋 Summary for Delaine

**Action Required**: Configure SMS webhook in Bland.ai dashboard

1. **Phone Number**: `+15619565858`
2. **Webhook URL**: `https://client.blandlabs.ai/webhooks/sms-reply`
3. **Method**: `POST`
4. **Purpose**: Automatic DNC/STOP handling and callback scheduling

**After Configuration**:
- Test by sending SMS to test number and replying "STOP"
- Verify webhook receives the reply in server logs
- Confirm DNC blocklist is updated automatically

**Questions?** Contact the development team or check server logs for webhook activity.

---

## 🔗 References

- [Bland.ai SMS Webhook API](https://docs.bland.ai/api-v1/post/sms-webhook-update)
- [Bland.ai SMS Tutorial](https://docs.bland.ai/tutorials/sms)
- Production Webhook: https://client.blandlabs.ai/webhooks/sms-reply
