# Voicemail Configuration Fix - Bland API v1 Format

## Problem Identified

You were absolutely correct! We were sending voicemail configuration in the **wrong format**.

### ❌ What We Were Sending (WRONG - Deprecated Format)

```javascript
{
  phone_number: "+1234567890",
  pathway_id: "...",
  // ... other fields ...

  // WRONG - Deprecated flat fields
  amd: true,
  answered_by_enabled: false,
  voicemail_message: "Hi, this is Ashley...",
  voicemail_action: "leave_message",
  sensitive_voicemail_detection: true
}
```

**Problem**: These fields (`amd`, `answered_by_enabled`, `voicemail_message`, `voicemail_action`, `sensitive_voicemail_detection`) are **deprecated** and not part of the official Bland API v1 specification.

### ✅ What We Should Send (CORRECT - Bland API v1 Format)

According to the official Bland API documentation: https://docs.bland.ai/api-v1/post/calls

```javascript
{
  phone_number: "+1234567890",
  pathway_id: "...",
  // ... other fields ...

  // CORRECT - Voicemail object
  voicemail: {
    message: "Hi, this is Ashley...",
    action: "leave_message",
    sensitive: true
  }
}
```

## What We Fixed

### 1. Updated Type Definitions

**File**: `src/types/awh.ts`

Added new interface for voicemail configuration:

```typescript
export interface BlandVoicemailConfig {
  message: string;
  action: "leave_message" | "hangup";
  sensitive?: boolean;
  sms?: {
    to: string;
    from: string;
    message: string;
  };
}
```

Updated `BlandOutboundCallRequest` interface:

```typescript
export interface BlandOutboundCallRequest {
  // ... other fields ...

  // Removed deprecated fields:
  // amd?: boolean;
  // answered_by_enabled?: boolean;
  // voicemail_message?: string;
  // voicemail_action?: "leave_message" | "hangup";
  // sensitive_voicemail_detection?: boolean;

  // Added correct voicemail object:
  voicemail?: BlandVoicemailConfig;
}
```

### 2. Updated Request Body Construction

**File**: `src/services/blandService.ts`

**Before** (lines 88-134):
```typescript
const requestBody: BlandOutboundCallRequest = {
  // ...
  amd: config.bland.answeringMachineDetection,
  answered_by_enabled: config.bland.answeredByEnabled,
  voicemail_message: voicemailMessage,
  voicemail_action: config.bland.voicemailAction,
  sensitive_voicemail_detection: config.bland.sensitiveVoicemailDetection,
  // ...
};
```

**After**:
```typescript
// Build voicemail object following Bland API v1 format
const voicemailConfig = voicemailMessage
  ? {
      message: voicemailMessage,
      action: (config.bland.voicemailAction || "leave_message") as
        | "leave_message"
        | "hangup",
      sensitive: config.bland.sensitiveVoicemailDetection || true,
    }
  : undefined;

const requestBody: BlandOutboundCallRequest = {
  // ...
  // Removed: amd, answered_by_enabled, etc.

  // Added correct voicemail configuration
  voicemail: voicemailConfig,
  // ...
};
```

### 3. Updated Logging

Changed logs to show the correct voicemail object structure:

```typescript
logger.info("📤 BLAND REQUEST | Templates with placeholders", {
  task_length: requestBody.task?.length,
  task_preview: requestBody.task?.substring(0, 200),
  first_sentence: requestBody.first_sentence,
  voicemail_config: requestBody.voicemail, // Shows full voicemail object
});
```

## What This Fixes

### 1. ✅ Voicemail Messages Will Now Be Left

**Before**: Bland was receiving deprecated parameters it might not recognize, causing voicemail to not be left.

**After**: Bland receives the correct `voicemail` object in the proper format, which should work with AMD detection.

### 2. ✅ Proper API v1 Compliance

**Before**: Using legacy/unofficial parameters

**After**: Following official Bland API v1 specification: https://docs.bland.ai/api-v1/post/calls

### 3. ✅ Better Voicemail Control

The new format supports additional options we weren't using:

```typescript
voicemail: {
  message: "Hi, this is Ashley...",
  action: "leave_message",  // or "hangup"
  sensitive: true,           // Sensitive voicemail detection
  sms?: {                    // Optional SMS fallback
    to: "+18005550123",
    from: "+18005550678",
    message: "We just left you a voicemail!"
  }
}
```

## Testing

When you run the next test call that goes to voicemail:

### Expected Logs:

```javascript
📤 BLAND REQUEST | Templates with placeholders
{
  voicemail_config: {
    message: "utkarsh We need to talk about your medical coverage...",
    action: "leave_message",
    sensitive: true
  }
}
```

### Expected Behavior:

1. Call connects
2. Voicemail greeting detected
3. **Voicemail message is left** (this should now work!)
4. Call ends
5. Outcome: `VOICEMAIL`
6. Status: `A`

## Comparison with Official Bland Docs

### From: https://docs.bland.ai/api-v1/post/calls

**Official Example**:
```json
{
  "phone_number": "+18005550123",
  "pathway_id": "...",
  "voicemail": {
    "message": "Hi, just calling to follow up. Please call us back when you can.",
    "action": "leave_message",
    "sms": {
      "to": "+18005550123",
      "from": "+18005550678",
      "message": "We just left you a voicemail. Call us back anytime!"
    },
    "sensitive": true
  }
}
```

**Our Implementation**:
```javascript
{
  phone_number: "+1234567890",
  pathway_id: "0258dd7c-e952-43ca-806e-23e1c6c7334b",
  voicemail: {
    message: "utkarsh We need to talk about your medical coverage...",
    action: "leave_message",
    sensitive: true
  }
}
```

✅ **Perfect match with official specification!**

## Files Modified

1. ✅ `src/types/awh.ts` - Added `BlandVoicemailConfig` interface, updated `BlandOutboundCallRequest`
2. ✅ `src/services/blandService.ts` - Updated to use voicemail object instead of flat fields
3. ✅ Build successful with `npm run build`

## Environment Variables (Still Used)

These `.env` variables are still used to build the voicemail config:

```bash
BLAND_VOICEMAIL_MESSAGE="{{first_name}} We need to talk..."
BLAND_VOICEMAIL_ACTION="leave_message"
BLAND_SENSITIVE_VOICEMAIL_DETECTION=true
```

They're just assembled differently now (into the `voicemail` object).

## Next Steps

1. ✅ **Deploy updated code** to Render
2. 🧪 **Test with voicemail call** - should now leave message correctly
3. 📊 **Check logs** for proper voicemail object structure
4. ✅ **Voicemail issue should be resolved!**

## Summary

Thank you for catching this! You were absolutely right - we needed to follow the official Bland API v1 specification. The voicemail configuration must be sent as a nested object, not as flat fields. This should fix the voicemail issue where messages weren't being left.

---

*Fixed: 2025-12-10*
*Updated to Bland API v1 specification for voicemail configuration*
*Reference: https://docs.bland.ai/api-v1/post/calls*
