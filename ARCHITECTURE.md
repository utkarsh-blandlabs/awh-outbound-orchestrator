# AWH Outbound Orchestrator - Architecture

## Modular Stage-Based Orchestration

The orchestrator now uses a **stage-based architecture** for better debugging and error tracking.

### Orchestration Stages

Each webhook triggers the following stages in sequence:

```
INIT → CONVOSO_LEAD → BLAND_CALL → CONVOSO_LOG → BLAND_TRANSCRIPT → CONVOSO_UPDATE → COMPLETE
```

#### Stage 1: CONVOSO_LEAD (📋)
- **Purpose**: Get or create lead in Convoso CRM
- **API**: `POST /v1/leads/insert`
- **Critical**: Yes - orchestration stops if this fails
- **Duration**: ~1 second

#### Stage 2: BLAND_CALL (📞)
- **Purpose**: Initiate outbound call via Bland AI
- **API**: `POST /v1/calls`
- **Critical**: Yes - orchestration stops if this fails
- **Duration**: ~1 second
- **Returns**: `call_id` for tracking

#### Stage 3: CONVOSO_LOG (📝)
- **Purpose**: Log call initiation in Convoso
- **API**: N/A (currently a no-op)
- **Critical**: No - failure logged as warning, orchestration continues
- **Duration**: ~0ms

#### Stage 4: BLAND_TRANSCRIPT (⏳)
- **Purpose**: Poll Bland for call completion and transcript
- **API**: `GET /v1/calls/{call_id}`
- **Critical**: Yes - orchestration stops if this fails
- **Duration**: Variable (1-10 minutes depending on call length)
- **Polling**: Every 5 seconds, max 120 attempts (10 minutes)

#### Stage 5: CONVOSO_UPDATE (🔀)
- **Purpose**: Update Convoso lead with call outcome and transcript
- **API**: `POST /v1/log/update`
- **Critical**: No - failure logged as warning, but call is complete
- **Duration**: ~1 second

### Error Tracking

Each stage now reports:
- ✓ **Success**: Stage completed successfully
- ✗ **Failure**: Stage failed with error details
- ⚠️ **Warning**: Non-critical stage failed, but orchestration continues

### Log Output Example

```
🚀 Starting AWH outbound orchestration
📋 Stage: CONVOSO_LEAD - Starting
✓ Stage: CONVOSO_LEAD - Completed (duration: 1234ms)
📞 Stage: BLAND_CALL - Starting
✓ Stage: BLAND_CALL - Completed (duration: 567ms)
📝 Stage: CONVOSO_LOG - Starting
✓ Stage: CONVOSO_LOG - Completed (duration: 0ms)
⏳ Stage: BLAND_TRANSCRIPT - Starting
✓ Stage: BLAND_TRANSCRIPT - Completed (duration: 180234ms)
🔀 Stage: CONVOSO_UPDATE - Starting
✓ Stage: CONVOSO_UPDATE - Completed (duration: 1100ms)
✅ AWH orchestration completed successfully
```

### Error Log Example

If a stage fails, you'll see exactly where:

```
📞 Stage: BLAND_CALL - Starting
✗ Stage: BLAND_CALL - Failed (duration: 500ms)
   error: "Invalid 'from' - you might not own this number"
❌ AWH orchestration failed
   failed_at_stage: BLAND_CALL
   error: "Stage BLAND_CALL failed: Invalid 'from' - you might not own this number"
```

## File Structure

```
src/
├── logic/
│   └── awhOrchestrator.ts    # Modular stage-based orchestration
├── services/
│   ├── blandService.ts       # Bland AI API client
│   └── convosoService.ts     # Convoso CRM API client
├── routes/
│   └── awhWebhook.ts         # Webhook endpoint handler
├── types/
│   └── awh.ts                # TypeScript interfaces
└── utils/
    ├── logger.ts             # Structured logging
    └── retry.ts              # Exponential backoff retry logic
```

## Benefits of Modular Architecture

1. **Clear Error Tracking**: Know exactly which stage failed
2. **Performance Monitoring**: Track duration of each stage
3. **Easy Debugging**: Logs show stage-by-stage progress
4. **Graceful Degradation**: Non-critical stages can fail without stopping the flow
5. **Independent Testing**: Each stage can be tested in isolation
6. **Easy Maintenance**: Stages are separate functions, easy to modify

## Adding New Stages

To add a new stage:

1. Add to `OrchestrationStage` enum
2. Create a stage function (e.g., `async function myNewStage()`)
3. Add emoji to `getStageEmoji()`
4. Insert in `handleAwhOutbound()` using `executeStage()`

Example:
```typescript
const myResult = await executeStage(
  OrchestrationStage.MY_NEW_STAGE,
  () => myNewStage(data),
  requestId
);
```

## Monitoring

Each log entry includes:
- `request_id`: Unique ID for this webhook request
- `stage`: Current orchestration stage
- `duration_ms`: Time taken for each stage
- `failed_at_stage`: Which stage caused orchestration to fail (if any)
