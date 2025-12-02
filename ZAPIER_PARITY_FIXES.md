# Zapier Parity Fixes - Configuration Corrections

## Issues Found and Fixed

After comparing our implementation with your actual Zapier configuration, I found **5 critical differences** that have now been corrected.

---

## 1. ❌ Pathway ID Mismatch (CRITICAL)

### Problem:
We were using the **wrong pathway**, which would cause completely different call behavior!

**Zapier Configuration:**
```
pathway_id: 0258dd7c-e952-43ca-806e-23e1c6c7334b
```

**Our Old .env:**
```
BLAND_PATHWAY_ID=1354408f-59b2-46d8-94b7-250f92d24b51  ❌ WRONG!
```

### Fix:
Updated `.env` to use the **correct pathway ID from Zapier**:
```bash
BLAND_PATHWAY_ID=0258dd7c-e952-43ca-806e-23e1c6c7334b  ✅ CORRECT
```

---

## 2. ❌ Phone Number Format Mismatch

### Problem:
Phone numbers had different formatting than Zapier (+ prefix vs no prefix).

**Zapier Configuration:**
```
from: 15619565858           (no + prefix)
transfer_phone_number: 2173866023  (no + prefix)
```

**Our Old .env:**
```
BLAND_FROM=                 (empty!)
BLAND_TRANSFER_PHONE_NUMBER=+12173866023  (had + prefix)
```

### Fix:
Updated phone numbers to **match Zapier format exactly**:
```bash
BLAND_FROM=15619565858
BLAND_TRANSFER_PHONE_NUMBER=2173866023
```

---

## 3. ❌ Missing Field: `answered_by_enabled`

### Problem:
Zapier sends `answered_by_enabled: false` but we weren't sending this field at all.

**Zapier Configuration:**
```
answered_by_enabled: false
```

**Our Implementation:**
- ❌ Field was completely missing

### Fix:
1. Added to `.env`:
```bash
BLAND_ANSWERED_BY_ENABLED=false
```

2. Added to `config.ts`:
```typescript
answeredByEnabled: process.env["BLAND_ANSWERED_BY_ENABLED"] === "true",
```

3. Added to request body in `blandService.ts`:
```typescript
answered_by_enabled: config.bland.answeredByEnabled,
```

4. Updated TypeScript interface in `types/awh.ts`:
```typescript
answered_by_enabled?: boolean;
```

---

## 4. ❌ Voicemail Message Not Personalized

### Problem:
Zapier personalizes the voicemail message with the customer's first name, but we weren't doing that!

**Zapier Example:**
```
voicemail_message: "Jeff We need to talk about your medical coverage..."
```
Notice it says "Jeff" - personalized with first name!

**Our Old .env:**
```
BLAND_VOICEMAIL_MESSAGE="We need to talk about your medical coverage..."
```
No personalization!

### Fix:
1. Updated `.env` to include `{{first_name}}` placeholder:
```bash
BLAND_VOICEMAIL_MESSAGE="{{first_name}} We need to talk about your medical coverage. It's Ashley from the enrollment center. Five. Six. One. Nine. Five. Six. Five. Eight. Five. Eight. Call me now."
```

2. Updated `blandService.ts` to replace the placeholder:
```typescript
// Personalize voicemail message with first name (like Zapier)
const voicemailMessage = config.bland.voicemailMessage
  ? config.bland.voicemailMessage
      .replace(/\{\{first_name\}\}/g, payload.firstName)
      .replace(/\{\{last_name\}\}/g, payload.lastName)
  : "";
```

**Example result:**
- For customer "John Doe"
- Voicemail: "**John** We need to talk about your medical coverage..."

---

## 5. ⚠️ Missing Field: `sensitive_voicemail_detection`

### Problem:
We had it in `.env` but weren't sending it to Bland API.

**Zapier Configuration:**
```
sensitive_voicemail_detection: true
```

**Our Implementation:**
- ✅ Was in `.env`
- ✅ Was in `config.ts`
- ❌ Was NOT being sent to Bland API

### Fix:
Added to request body in `blandService.ts`:
```typescript
sensitive_voicemail_detection: config.bland.sensitiveVoicemailDetection,
```

Updated TypeScript interface:
```typescript
sensitive_voicemail_detection?: boolean;
```

---

## Summary of Changes

### Files Modified:

1. **`.env`**
   - ✅ Fixed `BLAND_PATHWAY_ID` to match Zapier
   - ✅ Fixed `BLAND_FROM` to match Zapier format (no + prefix)
   - ✅ Fixed `BLAND_TRANSFER_PHONE_NUMBER` to match Zapier format
   - ✅ Added `BLAND_ANSWERED_BY_ENABLED=false`
   - ✅ Added `{{first_name}}` to `BLAND_VOICEMAIL_MESSAGE`

2. **`src/config.ts`**
   - ✅ Added `answeredByEnabled` configuration

3. **`src/services/blandService.ts`**
   - ✅ Added voicemail message personalization logic
   - ✅ Added `answered_by_enabled` to request body
   - ✅ Added `sensitive_voicemail_detection` to request body
   - ✅ Removed `language: "eng"` (Zapier doesn't send it)

4. **`src/types/awh.ts`**
   - ✅ Added `answered_by_enabled?: boolean;`
   - ✅ Added `sensitive_voicemail_detection?: boolean;`

---

## Request Body Comparison

### Before (Old):
```json
{
  "phone_number": "+16284444907",
  "pathway_id": "1354408f-59b2-46d8-94b7-250f92d24b51",  ❌ Wrong pathway
  "task": "You are Ashley, calling John Doe...",
  "transfer_phone_number": "+12173866023",  ❌ Wrong format
  "voice": "e54a409c-daa9-4ee6-a954-2d81dec3476b",
  "max_duration": 30,
  "amd": true,
  "wait_for_greeting": false,
  "block_interruptions": false,
  "record": true,
  "first_sentence": "Hi there! Is this John Doe?",
  "voicemail_message": "We need to talk...",  ❌ Not personalized
  "voicemail_action": "leave_message",
  "language": "eng",  ❌ Zapier doesn't send this
  "wait": false
}
```

### After (Fixed):
```json
{
  "phone_number": "+16284444907",
  "pathway_id": "0258dd7c-e952-43ca-806e-23e1c6c7334b",  ✅ Correct pathway
  "task": "You are Ashley, calling John Doe...",
  "from": "15619565858",  ✅ Matches Zapier
  "transfer_phone_number": "2173866023",  ✅ Matches Zapier
  "voice": "e54a409c-daa9-4ee6-a954-2d81dec3476b",
  "max_duration": 30,
  "amd": true,
  "answered_by_enabled": false,  ✅ NEW - matches Zapier
  "wait_for_greeting": false,
  "block_interruptions": false,
  "record": true,
  "first_sentence": "Hi there! Is this John Doe?",
  "voicemail_message": "John We need to talk...",  ✅ Personalized!
  "voicemail_action": "leave_message",
  "sensitive_voicemail_detection": true,  ✅ NEW - matches Zapier
  "wait": false
}
```

---

## Testing

To verify these changes work correctly, test with:

```bash
curl -X POST http://localhost:3000/webhooks/awhealth-outbound \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Doe",
    "phone_number": "+16284444907",
    "state": "CA",
    "lead_id": "test_lead_12345",
    "list_id": "16529",
    "status": "NEW"
  }'
```

**Expected behavior:**
1. Uses **correct pathway** (0258dd7c-e952-43ca-806e-23e1c6c7334b)
2. Caller ID shows as **15619565858**
3. Transfer goes to **2173866023**
4. Voicemail message says "**John** We need to talk..."
5. All fields match Zapier exactly

---

## Important Notes

### Q: Why was the pathway ID different?

**A:** This is likely from testing with different pathways. The pathway ID determines:
- Which conversation flow to use
- Which nodes to execute
- What questions Ashley asks
- How objections are handled

Using the **wrong pathway** could cause:
- ❌ Different script/conversation
- ❌ Wrong questions being asked
- ❌ Unexpected call behavior
- ❌ Inconsistent results vs Zapier

### Q: Why does phone number format matter?

**A:** Bland API might handle these differently:
- `+12173866023` vs `2173866023`
- Some carriers require exact format
- Zapier uses no + prefix, so we should too

### Q: What does `answered_by_enabled` do?

**A:** This field controls whether Bland should detect who answered the call:
- `false` = Don't detect (Zapier setting)
- `true` = Detect if human/voicemail/IVR answered

Since Zapier sets it to `false` and already has AMD (answering machine detection) enabled, this field might be redundant or deprecated.

---

## Summary

✅ **All 5 differences have been fixed**
✅ **Configuration now matches Zapier exactly**
✅ **Build completed successfully**
✅ **Ready for testing**

The orchestrator now sends the **exact same request** to Bland AI as your Zapier automation does!
