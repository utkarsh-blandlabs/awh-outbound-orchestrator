#!/bin/bash

# ============================================================================
# Configuration Restore Script
# Restores configurations from backup
# ============================================================================

BACKUP_DIR="config-backups"

# Check if timestamp provided
if [ -z "$1" ]; then
  echo "❌ Error: No backup timestamp provided"
  echo ""
  echo "Usage: ./restore-configs.sh TIMESTAMP"
  echo ""
  echo "Available backups:"
  ls -1 "${BACKUP_DIR}" 2>/dev/null | grep "backup_" | sed 's/backup_/  /'
  exit 1
fi

TIMESTAMP="$1"
BACKUP_PATH="${BACKUP_DIR}/backup_${TIMESTAMP}"

if [ ! -d "${BACKUP_PATH}" ]; then
  echo "❌ Error: Backup not found at ${BACKUP_PATH}"
  echo ""
  echo "Available backups:"
  ls -1 "${BACKUP_DIR}" 2>/dev/null | grep "backup_" | sed 's/backup_/  /'
  exit 1
fi

echo "📦 Restoring configurations from backup..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Backup: ${TIMESTAMP}"
echo "Path: ${BACKUP_PATH}"
echo ""

# Show manifest if exists
if [ -f "${BACKUP_PATH}/MANIFEST.txt" ]; then
  cat "${BACKUP_PATH}/MANIFEST.txt"
  echo ""
fi

# Confirm before restore
read -p "⚠️  This will overwrite current configs. Continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Restore cancelled"
  exit 0
fi

# Restore data directory
if [ -d "${BACKUP_PATH}/data" ]; then
  echo "✅ Restoring data/ directory..."
  cp -r "${BACKUP_PATH}/data" .
else
  echo "⚠️  No data/ directory in backup"
fi

# Restore .env file
if [ -f "${BACKUP_PATH}/.env" ]; then
  echo "✅ Restoring .env file..."
  cp "${BACKUP_PATH}/.env" .
else
  echo "⚠️  No .env file in backup"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Restore completed!"
echo ""
echo "Restored configurations:"
echo "  - Holiday blackout dates"
echo "  - Call protection rules"
echo "  - Redial queue settings"
echo "  - Answering machine tracker config"
echo "  - All recent data files"
echo ""
echo "⚠️  Remember to restart the service:"
echo "  pm2 restart awh-orchestrator"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
