#!/bin/bash

echo "Testing Bland.ai SMS API endpoints..."
echo ""

# Test 1: /v1/sms
echo "Test 1: POST /v1/sms"
curl -X POST "https://api.bland.ai/v1/sms" \
  -H "authorization: org_95373169f2f2d97cf5ab62908020adb131837e7dcb3028a2c8ab25b3fc19b998b470089f04526d06512069" \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+16284444907","message":"TEST","from":"+15619565858"}' \
  2>&1 | head -10

echo ""
echo "---"
echo ""

# Test 2: /v1/conversations/sms
echo "Test 2: POST /v1/conversations/sms"
curl -X POST "https://api.bland.ai/v1/conversations/sms" \
  -H "authorization: org_95373169f2f2d97cf5ab62908020adb131837e7dcb3028a2c8ab25b3fc19b998b470089f04526d06512069" \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+16284444907","message":"TEST","from":"+15619565858"}' \
  2>&1 | head -10

echo ""
echo "---"
echo ""

# Test 3: /v1/send-sms
echo "Test 3: POST /v1/send-sms"
curl -X POST "https://api.bland.ai/v1/send-sms" \
  -H "authorization: org_95373169f2f2d97cf5ab62908020adb131837e7dcb3028a2c8ab25b3fc19b998b470089f04526d06512069" \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+16284444907","message":"TEST","from":"+15619565858"}' \
  2>&1 | head -10
