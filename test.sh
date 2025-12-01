#!/bin/bash

# ============================================================================
# Test Script for AWH Outbound Orchestrator
# ============================================================================
# This script tests the webhook endpoint with sample data

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${1:-http://localhost:3000}"

echo ""
echo "======================================"
echo "AWH Orchestrator Test Script"
echo "======================================"
echo ""
echo -e "${BLUE}Testing server at: ${BASE_URL}${NC}"
echo ""

# Test 1: Health check
echo -e "${YELLOW}Test 1: Health Check${NC}"
echo "GET ${BASE_URL}/health"
curl -s -X GET "${BASE_URL}/health" | jq '.'
echo ""
echo ""

# Test 2: Webhook with full payload (Actual Convoso format from Jeff)
echo -e "${YELLOW}Test 2: Webhook with Full Payload (Actual Convoso Format)${NC}"
echo "POST ${BASE_URL}/webhooks/awhealth-outbound"
curl -s -X POST "${BASE_URL}/webhooks/awhealth-outbound" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Steven",
    "last_name": "Tester",
    "phone_number": "9548173961",
    "state": "FL",
    "city": "West Palm Beach",
    "postal_code": "33311",
    "date_of_birth": "January 1, 2001, 12:00 am",
    "age": "25",
    "lead_id": "8763211",
    "list_id": "16529",
    "status": "NEW"
  }' | jq '.'
echo ""
echo ""

# Test 3: Webhook with minimal required fields
echo -e "${YELLOW}Test 3: Webhook with Minimal Required Fields${NC}"
echo "POST ${BASE_URL}/webhooks/awhealth-outbound"
curl -s -X POST "${BASE_URL}/webhooks/awhealth-outbound" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jane",
    "last_name": "Smith",
    "phone_number": "5559876543",
    "state": "NY",
    "lead_id": "test_123",
    "list_id": "16529"
  }' | jq '.'
echo ""
echo ""

# Test 4: Invalid payload (missing required fields)
echo -e "${YELLOW}Test 4: Invalid Payload (Should Fail)${NC}"
echo "POST ${BASE_URL}/webhooks/awhealth-outbound"
curl -s -X POST "${BASE_URL}/webhooks/awhealth-outbound" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Bob",
    "last_name": "Jones"
  }' | jq '.'
echo ""
echo ""

echo -e "${GREEN}✓ Tests complete!${NC}"
echo ""
echo "Check the server logs to see the orchestration flow"
echo ""