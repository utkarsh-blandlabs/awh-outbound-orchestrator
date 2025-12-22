#!/bin/bash

# ============================================================================
# Version Update Script
# ============================================================================
# Updates version.json with current timestamp on deployment
# Usage: ./update-version.sh

set -e

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

# Get current timestamp in EST (UTC-5)
# Convert UTC to EST by subtracting 5 hours
TIMESTAMP=$(TZ='America/New_York' date +"%Y-%m-%dT%H:%M:%S.000 EST")

# Get environment (default: production)
ENVIRONMENT="${NODE_ENV:-production}"

# Update version.json
cat > version.json << EOF
{
  "version": "$VERSION",
  "deployedAt": "$TIMESTAMP",
  "environment": "$ENVIRONMENT",
  "note": "This file is auto-generated. Update deployedAt on each deployment."
}
EOF

echo "✅ Updated version.json:"
echo "   Version: $VERSION"
echo "   Deployed At: $TIMESTAMP (EST)"
echo "   Environment: $ENVIRONMENT"
