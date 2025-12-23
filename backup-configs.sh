#!/bin/bash

# ============================================================================
# Configuration Backup Script
# Backs up all runtime configurations before deployment
# ============================================================================

BACKUP_DIR="config-backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_PATH="${BACKUP_DIR}/backup_${TIMESTAMP}"

echo "📦 Backing up configurations..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create backup directory
mkdir -p "${BACKUP_PATH}"

# Backup data directory (configs + recent data)
if [ -d "data" ]; then
  echo "✅ Backing up data/ directory..."
  cp -r data "${BACKUP_PATH}/"
else
  echo "⚠️  No data/ directory found"
fi

# Backup .env file
if [ -f ".env" ]; then
  echo "✅ Backing up .env file..."
  cp .env "${BACKUP_PATH}/"
else
  echo "⚠️  No .env file found"
fi

# Create backup manifest
cat > "${BACKUP_PATH}/MANIFEST.txt" << EOF
Backup Created: ${TIMESTAMP}
Backup Location: ${BACKUP_PATH}

Contents:
- data/ directory (all configs and data files)
- .env file (environment variables)

To restore:
  ./restore-configs.sh ${TIMESTAMP}

Configuration Files Included:
- data/scheduler-config.json (Holiday schedule, blackout dates)
- data/call-protection-config.json (Protection rules)
- data/redial-queue-config.json (Redial settings)
- data/am-tracker-config.json (AM tracker config)

Data Files Included:
- data/daily-calls/*.json (Call history)
- data/statistics/*.json (Statistics)
- data/redial-queue/*.json (Queue records)
- data/am-tracker/*.json (AM records)
- data/request-queue.json (Queued requests)
EOF

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Backup completed!"
echo "📁 Location: ${BACKUP_PATH}"
echo ""
echo "Backed up files:"
ls -lh "${BACKUP_PATH}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Keep only last 10 backups
echo "🧹 Cleaning old backups (keeping last 10)..."
cd "${BACKUP_DIR}" 2>/dev/null && ls -t | tail -n +11 | xargs -r rm -rf
cd - > /dev/null

echo "✅ Backup complete: ${BACKUP_PATH}"
