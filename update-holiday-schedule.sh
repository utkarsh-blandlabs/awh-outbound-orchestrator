#!/bin/bash

# ============================================================================
# Holiday Schedule Update Script
# Updates scheduler configuration with blackout dates for holidays
# ============================================================================

# Set API endpoint and key
API_URL="${API_URL:-http://localhost:3000}"
API_KEY="${ADMIN_API_KEY:-24xj5nKkOsD0SNmWNVDRgdcn99x4eCfL}"

# Holiday blackout dates (YYYY-MM-DD format)
# Dec 24-25: Christmas Eve and Christmas Day
# Dec 31 - Jan 1: New Year's Eve and New Year's Day
BLACKOUT_DATES='["2024-12-24", "2024-12-25", "2024-12-31", "2025-01-01"]'

echo "🎄 Updating Holiday Schedule Configuration..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Blackout Dates:"
echo "  📅 Dec 24, 2024 - Christmas Eve"
echo "  📅 Dec 25, 2024 - Christmas Day"
echo "  📅 Dec 31, 2024 - New Year's Eve"
echo "  📅 Jan 1, 2025 - New Year's Day"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Build request body
REQUEST_BODY=$(cat <<EOF
{
  "enabled": true,
  "callbacksEnabled": true,
  "timezone": "America/New_York",
  "schedule": {
    "days": [1, 2, 3, 4, 5],
    "startTime": "09:00",
    "endTime": "17:00"
  },
  "blackoutDates": ${BLACKOUT_DATES}
}
EOF
)

# Make API request
RESPONSE=$(curl -s -X PUT \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "${REQUEST_BODY}" \
  "${API_URL}/api/admin/scheduler/config")

# Check if request was successful
if [ $? -eq 0 ]; then
  echo "✅ Holiday schedule updated successfully!"
  echo ""
  echo "Updated Configuration:"
  echo "${RESPONSE}" | jq '.'
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✨ System will automatically:"
  echo "  • Be OFF on blackout dates (holidays)"
  echo "  • Queue incoming leads during blackout periods"
  echo "  • Resume normal operation on working days"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo "❌ Failed to update holiday schedule"
  echo "Response: ${RESPONSE}"
  exit 1
fi
