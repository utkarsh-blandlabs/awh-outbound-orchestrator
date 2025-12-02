# AWH Orchestrator - Logging Guide

## Log Levels

Set `LOG_LEVEL` in your `.env` file:

- `error` - Only errors
- `warn` - Warnings and errors
- `info` - General info, warnings, and errors (default)
- `debug` - Everything including detailed API responses

## Debug Logging for API Responses

When `LOG_LEVEL=debug`, you'll see complete API responses from both Bland AI and Convoso.

### What Gets Logged in Debug Mode

#### 1. **Bland AI - Call Initiation**
```
📞 Bland API - Call Initiation Response
{
  "full_response": { /* Complete Bland API response */ },
  "call_id": "3348a8ed-1085-4b30-b265-83cbff7f27cc",
  "status": "success"
}
```

#### 2. **Bland AI - Full Transcript (RAW)**
```
📝 Bland API - Full Transcript Response (RAW)
{
  "full_response": {
    "call_id": "...",
    "status": "completed",
    "completed": true,
    "answered_by": "human" | "voicemail" | "no-answer" | "busy",
    "call_ended_by": "...",
    "concatenated_transcript": "Full conversation text...",
    "summary": "AI-generated summary...",
    "call_length": 123.45,
    "warm_transfer_call": { /* if transferred */ },
    "variables": { /* custom extracted data */ },
    "error_message": null
  }
}
```

#### 3. **Bland AI - Outcome Detection Debug**
```
Raw Bland transcript response
{
  "call_id": "...",
  "status": "completed",
  "completed": true,
  "answered_by": "human",
  "call_ended_by": "...",
  "warm_transfer": null,
  "error_message": null
}
```

#### 4. **Convoso - Lead Insert Response**
```
📋 Convoso API - Lead Insert Response
{
  "full_response": { /* Complete Convoso response */ },
  "lead_id": "test_lead_12345"
}
```

#### 5. **Convoso - Call Log Update Response**
```
🔀 Convoso API - Call Log Update Response
{
  "full_response": { /* Complete Convoso response */ },
  "lead_id": "test_lead_12345",
  "outcome": "TRANSFERRED"
}
```

## How to Enable Debug Logging

### Option 1: Update `.env` file
```bash
LOG_LEVEL=debug
```

Then restart your server:
```bash
npm run dev
```

### Option 2: Temporary (one-time)
```bash
LOG_LEVEL=debug npm run dev
```

## Typical Log Flow (Debug Mode)

```
🚀 Starting AWH outbound orchestration
  └─ request_id: req_1234567890_abcdef
  └─ phone: +16284444907
  └─ name: John Doe

📋 Stage: CONVOSO_LEAD - Starting
  └─ Inserting/updating Convoso lead
  └─ 📋 Convoso API - Lead Insert Response { full_response: {...} }
  └─ ✓ Lead inserted/updated successfully
  └─ ✓ Stage: CONVOSO_LEAD - Completed (duration: 1234ms)

📞 Stage: BLAND_CALL - Starting
  └─ Sending outbound call to Bland
  └─ 📞 Bland API - Call Initiation Response { full_response: {...} }
  └─ ✓ Bland call initiated successfully
  └─ ✓ Stage: BLAND_CALL - Completed (duration: 567ms)

📝 Stage: CONVOSO_LOG - Starting
  └─ Call logging now handled by updateCallLog
  └─ ✓ Stage: CONVOSO_LOG - Completed (duration: 1ms)

⏳ Stage: BLAND_TRANSCRIPT - Starting
  └─ Fetching transcript from Bland
  └─ [Polling every 5 seconds...]
  └─ 📝 Bland API - Full Transcript Response (RAW) { full_response: {...} }
  └─ Raw Bland transcript response { status: "completed", answered_by: "human", ... }
  └─ ✓ Transcript retrieved successfully
  └─ ✓ Stage: BLAND_TRANSCRIPT - Completed (duration: 127293ms)

🔀 Stage: CONVOSO_UPDATE - Starting
  └─ Updating Convoso call log
  └─ 🔀 Convoso API - Call Log Update Response { full_response: {...} }
  └─ ✓ Call log updated successfully
  └─ ✓ Stage: CONVOSO_UPDATE - Completed (duration: 1633ms)

✅ AWH orchestration completed successfully
  └─ Total duration: 131219ms
  └─ outcome: TRANSFERRED
```

## Important Fields in Bland Transcript

Look for these fields to understand call outcomes:

- `answered_by`: "human" | "voicemail" | "no-answer" | "busy"
- `status`: "completed" | "failed" | "in-progress"
- `completed`: true | false
- `warm_transfer_call`: Present if call was transferred
- `variables`: Custom data extracted during the call
  - `plan_type`: "Individual" | "Family"
  - `member_count`: Number
  - `zip`: ZIP code
  - `state`: State
  - `callback_requested`: true | false
- `concatenated_transcript`: Full conversation text
- `summary`: AI-generated summary of the call
- `call_length`: Duration in seconds

## Filtering Logs

### View only API responses
```bash
npm run dev | grep "API -"
```

### View only errors
```bash
npm run dev | grep "ERROR"
```

### View specific stage
```bash
npm run dev | grep "BLAND_CALL"
```

## Production Logging

For production, use `LOG_LEVEL=info` to reduce log volume:

```bash
# .env
LOG_LEVEL=info
```

This will log:
- ✅ Stage completions
- ❌ Errors
- ⚠️ Warnings
- ℹ️ Key events

But NOT:
- 🔍 Debug details
- 📊 Full API responses
- 🔎 Polling attempts
