# AWH Outbound Orchestrator

Node.js/Express service that replaces Zapier for American Way Health's outbound call automation flow.

## Purpose

This service orchestrates outbound calls for AWH by:
1. Receiving webhooks from Convoso when leads fill out web forms
2. Triggering Bland AI outbound calls (Ashley agent)
3. Logging calls in Convoso
4. Fetching transcripts from Bland
5. Updating Convoso leads with call outcomes

**Why?** The existing Zapier flow costs tens of thousands of dollars per month in task executions. This custom orchestrator eliminates those costs while maintaining the same functionality.

##  Architecture

### Current Zapier Flow (Being Replaced)
```
Web Form → Convoso → Zapier Catch Hook →
  → Bland (Send Call) →
  → Convoso (Log Call) →
  → Bland (Get Transcript) →
  → Path A/B/C Logic →
  → Convoso (Update Lead)
```

### New Node.js Flow
```
Web Form → Convoso → Node.js Webhook →
  → Bland (Send Call) →
  → Convoso (Log Call) →
  → Bland (Get Transcript) →
  → Path A/B/C Logic →
  → Convoso (Update Lead)
```

##  Project Structure

```
awh-outbound-orchestrator/
├── src/
│   ├── index.ts              # Express app entry point
│   ├── config.ts             # Environment configuration
│   ├── routes/
│   │   └── awhWebhook.ts     # POST /webhooks/awhealth-outbound
│   ├── services/
│   │   ├── blandService.ts   # Bland AI API calls
│   │   └── convosoService.ts # Convoso API calls
│   ├── logic/
│   │   └── awhOrchestrator.ts # Main orchestration flow
│   ├── types/
│   │   └── awh.ts            # TypeScript type definitions
│   └── utils/
│       ├── logger.ts         # Structured logging
│       └── retry.ts          # Retry with exponential backoff
├── .env.example              # Environment variables template
├── package.json
├── tsconfig.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js >= 18.x
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

4. Update `.env` with your actual API keys and configuration

### Running the Service

**Development mode (with hot reload):**
```bash
npm run dev
```

**Production build:**
```bash
npm run build
npm start
```

### Testing the Webhook

```bash
curl -X POST http://localhost:3000/webhooks/awhealth-outbound \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Doe",
    "phone": "5551234567",
    "state": "CA"
  }'
```

## Configuration

All configuration is done via environment variables. See `.env.example` for all available options.

### Key Variables

- `BLAND_API_KEY` - Bland AI API key
- `BLAND_PATHWAY_ID` - Ashley agent pathway ID
- `CONVOSO_API_KEY` - Convoso API key
- `PORT` - Server port (default: 3000)

## API Endpoints

### `GET /health`
Health check endpoint

**Response:**
```json
{
  "status": "ok",
  "service": "awh-outbound-orchestrator",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### `POST /webhooks/awhealth-outbound`
Main webhook endpoint that receives Convoso webhooks

**Request Body:**
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "phone": "5551234567",
  "state": "CA",
  "lead_id": "optional_existing_lead_id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook received, processing in background",
  "request_id": "req_1234567890_abcdef"
}
```

## Orchestration Flow

1. **Webhook Received** - Validate payload
2. **Get/Create Lead** - Find or create lead in Convoso
3. **Initiate Call** - Trigger Bland outbound call
4. **Log Call** - Create call log entry in Convoso
5. **Poll Transcript** - Wait for call to complete and fetch transcript
6. **Apply Path Logic** - Determine Path A/B/C based on outcome
7. **Update Lead** - Update Convoso lead with outcome and transcript

## Current Status

### Implemented
- Full project structure
- TypeScript configuration (CommonJS)
- Express server with webhook endpoint
- Service layer structure (Bland, Convoso)
- Orchestrator logic flow
- Retry mechanism with exponential backoff
- Structured logging
- Error handling

### Pending Implementation

The following are **stubbed** and need real API details:

1. **Bland API endpoints**
   - POST endpoint for sending outbound calls
   - GET endpoint for fetching transcripts
   - Exact request/response formats

2. **Convoso API endpoints**
   - GET/POST endpoints for lead management
   - POST endpoint for call logging
   - PUT/PATCH endpoint for lead updates
   - Disposition codes and status values

3. **Path A/B/C Logic**
   - Exact conditions for each path
   - Mapping rules based on transcript

### TODO

- [ ] Get actual Convoso webhook payload format from Jeff
- [ ] Get Bland API endpoint details from Jeff
- [ ] Get Convoso API endpoint details from Jeff
- [ ] Implement real Path A/B/C logic
- [ ] Replace stubs with real HTTP calls
- [ ] Test with AWH sandbox leads
- [ ] Add monitoring/alerting
- [ ] Set up deployment (Docker, etc.)

## Development Notes

### TypeScript Configuration

This project uses **CommonJS** modules (not ESM) to avoid compatibility issues with ts-node-dev.

Key tsconfig settings:
- `module: "CommonJS"`
- `moduleResolution: "Node"`
- `esModuleInterop: true`

 

### Retry Logic

All external API calls use exponential backoff retry:
- Max attempts: 3 (configurable)
- Initial delay: 1 second
- Max delay: 10 seconds
- Only retries on network errors or 5xx responses

## Team

- **Owner:** Utkarsh Jaiswal
- **CEO:** Josh Collin
- **PM/Lead:** Delaine
- **AWH Contact:** Jeff

## Timeline

- **Mon-Tue:** Gather API details from Delaine/Jeff
- **Tue-Wed:** Implement real API calls
- **Wed-Thu:** Build full orchestrator logic
- **Thu:** End-to-end testing with dummy data
- **Fri:** Test with AWH sandbox leads

## Troubleshooting

### "Must use import to load ES Module" error
Make sure `tsconfig.json` has `module: "CommonJS"` and there's no `"type": "module"` in `package.json`.

### Webhook not receiving requests
Check firewall settings and ensure Convoso webhook URL is correctly configured.

### API calls failing

Check `.env` file has correct API keys and base URLs.
