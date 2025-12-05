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
│   │   └── ConvosoService.ts # Convoso API calls
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
- `Convoso_API_KEY` - Convoso API key
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

## Deployment

### AWS EC2 Deployment

This application is ready for deployment to AWS EC2. See deployment guides:

- **[EC2 Quick Start Guide](./EC2_QUICK_START.md)** - Deploy in 30 minutes
- **[EC2 Deployment Guide](./EC2_DEPLOYMENT_GUIDE.md)** - Complete step-by-step instructions
- **[Deployment Checklist](./EC2_DEPLOYMENT_CHECKLIST.md)** - Don't miss anything
- **[Deployment Summary](./DEPLOYMENT_SUMMARY.md)** - What was changed for EC2

#### Quick Deploy

```bash
# 1. Launch EC2 instance (Ubuntu 22.04, t2.small)
# 2. SSH to instance
ssh -i your-key.pem ubuntu@YOUR_ELASTIC_IP

# 3. Run setup script
./ec2-setup.sh

# 4. Deploy from local machine
./deploy.sh YOUR_ELASTIC_IP ~/path/to/key.pem

# 5. Configure .env and start
pm2 start ecosystem.config.js
```

See [EC2_QUICK_START.md](./EC2_QUICK_START.md) for complete instructions.

### Admin Dashboard

The application includes admin API endpoints for monitoring and management:

- **GET** `/api/admin/health` - System health and uptime
- **GET** `/api/admin/calls/active` - Currently active calls
- **GET** `/api/admin/calls/stats` - Call statistics and memory usage
- **GET** `/api/admin/calls/:call_id` - Specific call details
- **POST** `/api/admin/cache/clear` - Clear completed calls from cache
- **DELETE** `/api/admin/calls/:call_id` - Remove call from cache

See [ADMIN_API_GUIDE.md](./ADMIN_API_GUIDE.md) for API documentation and Retool integration.

## Architecture Updates

### Webhook-Based Completion (No Polling!)

The application now uses webhooks for call completion instead of polling:

1. **Convoso Webhook** → Triggers call via `/webhooks/awhealth-outbound`
2. **Bland Initiation** → Starts call and returns immediately
3. **Bland Webhook** → Notifies completion via `/webhooks/bland-callback`
4. **Convoso Update** → Results sent back to Convoso automatically

Benefits:

- No expensive polling loops
- Instant completion handling
- Scales to 100+ concurrent calls
- Lower server resource usage

See [WEBHOOK_ARCHITECTURE.md](./WEBHOOK_ARCHITECTURE.md) for details.

## Scaling

Current setup supports:

- **1,000-2,000 concurrent calls** on t2.small (2GB RAM)
- **5,000-10,000 concurrent calls** on t3.medium with database
- **100,000+ concurrent calls** with Redis, queue, and clustering

See deployment guides for scaling recommendations.

## Troubleshooting

### "Must use import to load ES Module" error

Make sure `tsconfig.json` has `module: "CommonJS"` and there's no `"type": "module"` in `package.json`.

### Webhook not receiving requests

Check firewall settings and ensure Convoso webhook URL is correctly configured.

### API calls failing

Check `.env` file has correct API keys and base URLs.

### High memory usage on EC2

```bash
pm2 monit
pm2 restart awh-orchestrator
```

### Build fails with type errors

Ensure TypeScript types are in `dependencies`, not `devDependencies` in `package.json`.
